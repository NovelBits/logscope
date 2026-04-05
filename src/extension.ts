import * as vscode from "vscode";
import { execFile } from "child_process";
import { NrfutilRttTransport, discoverDevices, resolveSystemPython } from "./transport/nrfutil-rtt";
import type { DiscoveredDevice } from "./transport/nrfutil-rtt";
import { UartTransport, discoverSerialPorts } from "./transport/uart-serial";
import { ZephyrLogParser } from "./parser/zephyr-log";
import { Nrf5LogParser } from "./parser/nrf5-log";
import { RawLogParser } from "./parser/raw-log";
import type { Parser } from "./parser/types";
import { HciParser } from "./parser/hci-parser";
import { RingBuffer } from "./model/ring-buffer";
import { Session, exportAsText, exportAsJsonLines } from "./model/session";
import { exportAsBtsnoop } from "./model/btsnoop-export";
import { LogScopePanel } from "./ui/webview-provider";
import { StatusBar } from "./ui/status-bar";
import { LogScopeSidebarProvider } from "./ui/sidebar-provider";
import type { Transport } from "./transport/types";
import { TransportError, classifyError } from "./errors";
import type { LogScopeError, ErrorAction } from "./errors";
import { telemetry } from "./telemetry";
import { WatchMatcher } from "./watch-matcher";
import type { WatchPatternConfig } from "./watch-matcher";

// ── Module-level state ──────────────────────────────────────────
let transport: Transport | null = null;
let session: Session | null = null;
let ringBuffer: RingBuffer | null = null;
let activeParser: Parser = new ZephyrLogParser();
const hciParser = new HciParser();
const watchMatcher = new WatchMatcher();
let panel: LogScopePanel | null = null;
let statusBar: StatusBar | null = null;
let statusInterval: ReturnType<typeof setInterval> | null = null;
let lineBuffer = "";
const sidebarProvider = new LogScopeSidebarProvider();
let userDisconnecting = false;
let lastDiscoveredDevices: DiscoveredDevice[] = [];
let hciPacketCount = 0;
let errorCount = 0;

// ── Helpers ─────────────────────────────────────────────────────

function getConfig() {
  const cfg = vscode.workspace.getConfiguration("logscope");
  return {
    maxEntries: cfg.get<number>("maxEntries", 100_000),
    jlinkDevice: cfg.get<string>("jlink.device", "Cortex-M33"),
    nrfutilPath: cfg.get<string>("nrfutil.path", "nrfutil"),
    rttPollInterval: cfg.get<number>("rtt.pollInterval", 50),
    rttSearchRanges: cfg.get<string>("jlink.rttSearchRanges", "0x20000000 0x80000"),
    logWrap: cfg.get<boolean>("logWrap", false),
    timeFormat: cfg.get<string>("timeFormat", "24h"),
  };
}

/** Save a logscope setting — uses workspace scope when a folder is open, global otherwise. */
async function saveSetting(key: string, value: unknown): Promise<void> {
  const cfg = vscode.workspace.getConfiguration("logscope");
  const target = vscode.workspace.workspaceFolders
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
  await cfg.update(key, value, target);
}

function loadWatchPatterns(): void {
  const cfg = vscode.workspace.getConfiguration("logscope");
  const patterns = cfg.get<WatchPatternConfig[]>("watchPatterns", []);
  watchMatcher.loadPatterns(patterns);
}

let bootDetected = false;

function handleChunk(chunk: Buffer): void {
  if (!ringBuffer || !session) return;

  lineBuffer += chunk.toString("utf-8");
  // Replace cursor positioning/screen control ANSI codes with newlines so they
  // act as line breaks (e.g. \033[7;12H, \033[2J, \033[?25l). Color codes
  // (\033[...m) are left intact for the parser to strip.
  // eslint-disable-next-line no-control-regex
  lineBuffer = lineBuffer.replace(/\x1b\[[\d;]*[HJK]|\x1b\[\?\d+[hl]/g, "\n");
  const segments = lineBuffer.split(/\r?\n|\r/);
  lineBuffer = segments.pop() ?? "";

  if (segments.length === 0) return;

  const completeText = segments.join("\n") + "\n";
  if (completeText.includes("*** Booting")) {
    if (bootDetected) {
      panel?.sendReset();
    }
    bootDetected = true;
  }

  const now = Date.now();
  const entries = activeParser.parse(completeText);

  for (const entry of entries) {
    entry.receivedAt = now;
    watchMatcher.match(entry);
    ringBuffer.push(entry);
    session.addEntry(entry);
    if (entry.severity === "err") errorCount++;
  }

  if (entries.length > 0 && panel) {
    panel.addEntries(entries);
    const modules = Array.from(session.modules);
    panel.updateModules(modules);
  }
}

function wireTransportEvents(t: Transport): void {
  t.on("data", (chunk: Buffer) => handleChunk(chunk));

  t.on("hci", (chunk: Buffer) => {
    if (!ringBuffer || !session) return;
    const now = Date.now();
    const entries = hciParser.parse(chunk);
    for (const entry of entries) {
      entry.receivedAt = now;
      watchMatcher.match(entry);
      ringBuffer.push(entry);
      session.addEntry(entry);
      hciPacketCount++;
    }
    if (entries.length > 0 && panel) {
      panel.addEntries(entries);
      const modules = Array.from(session.modules);
      panel.updateModules(modules);
    }
  });

  t.on("reset", () => {
    panel?.sendReset();
  });

  t.on("disconnected", (info?: { reason?: string; message?: string }) => {
    if (!userDisconnecting) {
      if (info?.reason) {
        // Show structured error card (no reconnect bar — reconnecting won't help)
        const error = classifyError(
          info.message || "Connection lost",
          undefined,
          sidebarProvider.currentDevice,
        );
        panel?.sendConnectError(error);
        panel?.sendDisconnected(false); // false = don't show reconnect bar
      } else {
        panel?.sendDisconnected(true); // true = show reconnect bar
      }
      sidebarProvider.updateState({ connected: false, connecting: false });
    }
    statusBar?.update(false, ringBuffer?.size ?? 0, ringBuffer?.evictedCount ?? 0);
    panel?.updateStatus(false, ringBuffer?.size ?? 0, ringBuffer?.evictedCount ?? 0);
  });

  t.on("error", (err: Error) => {
    console.error("[LogScope] Transport error:", err.message);
  });
}

function startStatusUpdates(): void {
  stopStatusUpdates();
  statusInterval = setInterval(() => {
    const connected = transport?.connected ?? false;
    const count = ringBuffer?.size ?? 0;
    const evicted = ringBuffer?.evictedCount ?? 0;

    panel?.updateStatus(connected, count, evicted);
    statusBar?.update(connected, count, evicted);
    sidebarProvider.updateState({ entryCount: count, hciPacketCount, errorCount, watchCounters: watchMatcher.getCounters() });
  }, 500);
}

function stopStatusUpdates(): void {
  if (statusInterval) {
    clearInterval(statusInterval);
    statusInterval = null;
  }
}

function disconnectAll(): void {
  if (transport?.connected && session) {
    const parserMode = vscode.workspace.getConfiguration("logscope").get<string>("parser", "zephyr");
    telemetry.trackSessionEnd({
      transport: sidebarProvider.currentTransport,
      parserMode: parserMode ?? "zephyr",
      entryCount: ringBuffer?.size ?? 0,
      hciPacketCount,
      errorCount,
      evictedCount: ringBuffer?.evictedCount ?? 0,
    });
  }
  if (transport?.connected) {
    transport.disconnect();
  }
  transport = null;
  lineBuffer = "";
  stopStatusUpdates();
  statusBar?.update(false, ringBuffer?.size ?? 0, ringBuffer?.evictedCount ?? 0);
  panel?.updateStatus(false, ringBuffer?.size ?? 0, ringBuffer?.evictedCount ?? 0);
}

function handleErrorAction(action: ErrorAction): void {
  switch (action.command) {
    case "rescan":
      vscode.commands.executeCommand("logscope.connect");
      break;
    case "reconnect":
    case "retry":
      vscode.commands.executeCommand("logscope.reconnect");
      break;
    case "resetDevice":
      resetAndReconnect(action.args?.[0] as string);
      break;
    case "downloadPython":
      vscode.env.openExternal(vscode.Uri.parse("https://www.python.org/downloads/"));
      break;
  }
}

async function resetAndReconnect(serialNumber?: string): Promise<void> {
  if (!serialNumber) return;
  execFile("nrfutil", ["device", "reset", "--serial-number", serialNumber], (err) => {
    if (err) {
      vscode.window.showWarningMessage(`LogScope: Could not reset device \u2014 ${err.message}`);
      return;
    }
    setTimeout(() => doConnect(), 2000);
  });
}

// ── Connect helpers ─────────────────────────────────────────────

async function connectRtt(device: string, pollInterval: number, serialNumber?: string): Promise<void> {
  const cfg = getConfig();
  ringBuffer = new RingBuffer(cfg.maxEntries);
  session = new Session("device", "rtt");
  lineBuffer = "";

  const MAX_RETRIES = 2;
  const RETRY_DELAY_MS = 2000;
  let lastErr: Error | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      console.log(`[LogScope] RTT connect retry ${attempt}/${MAX_RETRIES} after ${RETRY_DELAY_MS}ms...`);
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
    }

    const rttTransport = new NrfutilRttTransport({
      device,
      serialNumber,
      pollIntervalMs: pollInterval,
      nrfutilPath: cfg.nrfutilPath,
      rttSearchRanges: cfg.rttSearchRanges,
    });
    transport = rttTransport;
    wireTransportEvents(rttTransport);

    try {
      await rttTransport.connect();
      startStatusUpdates();
      return;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      rttTransport.disconnect();
      // Don't retry for NO_RTT (exit code 2) — firmware doesn't have RTT,
      // retrying won't help
      if (lastErr instanceof TransportError && lastErr.exitCode === 2) {
        break;
      }
    }
  }

  throw lastErr ?? new Error("RTT connection failed");
}

async function connectUart(portPath: string, baudRate: number): Promise<void> {
  const cfg = getConfig();
  ringBuffer = new RingBuffer(cfg.maxEntries);
  session = new Session("device", "uart");
  lineBuffer = "";

  const uartTransport = new UartTransport({ port: portPath, baudRate });
  transport = uartTransport;
  wireTransportEvents(uartTransport);
  await uartTransport.connect();
  startStatusUpdates();
}

// ── Connect using current sidebar state ─────────────────────────

let connectInFlight = false;

async function connectAndShowUart(device: string, baudRate: number, parserMode: string): Promise<void> {
  await connectUart(device, baudRate);
  await saveSetting("uart.lastPort", device);
  await saveSetting("transport", "uart");

  const cfg = getConfig();
  panel?.show(cfg.logWrap, cfg.timeFormat);
  // Fix #1: delay sendConnected to let webview load (show() uses 100ms for init)
  setTimeout(() => panel?.sendConnected("Serial UART", device, parserMode), 150);
  sidebarProvider.updateState({
    connected: true, connecting: false,
    connectedTransport: "Serial UART", connectedAddress: device,
  });
}

async function connectAndShowRtt(device: string, parserMode: string): Promise<void> {
  const cfg = getConfig();
  const pollInterval = cfg.rttPollInterval;
  // Use the user's jlink.device setting if they changed it from the default.
  // Otherwise, use "auto" to let the helper auto-detect the target chip.
  const jlinkDevice = cfg.jlinkDevice !== "Cortex-M33" ? cfg.jlinkDevice : "auto";
  await connectRtt(jlinkDevice, pollInterval, device);
  const rttTransport = transport as NrfutilRttTransport;
  const displayName = rttTransport.detectedDevice || "Connected";
  await saveSetting("lastDevice", device);
  await saveSetting("transport", "rtt");

  panel?.show(cfg.logWrap, cfg.timeFormat);
  setTimeout(() => panel?.sendConnected("J-Link RTT", displayName, parserMode), 150);
  sidebarProvider.updateState({
    connected: true, connecting: false,
    connectedTransport: "J-Link RTT", connectedAddress: displayName,
  });
}

async function doConnect(): Promise<void> {
  if (connectInFlight) return; // Fix #6: prevent concurrent connects

  const transportType = sidebarProvider.currentTransport;
  const device = sidebarProvider.currentDevice;
  const baudRate = sidebarProvider.currentBaudRate;

  if (!device) {
    vscode.window.showWarningMessage("LogScope: No device selected.");
    return;
  }

  connectInFlight = true;
  try {
    const parserMode = vscode.workspace.getConfiguration("logscope").get<string>("parser", "zephyr");
    switch (parserMode) {
      case "nrf5":
        activeParser = new Nrf5LogParser();
        break;
      case "raw":
        activeParser = new RawLogParser();
        break;
      default:
        activeParser = new ZephyrLogParser();
        break;
    }

    // Disconnect existing connection before switching
    if (transport?.connected) {
      userDisconnecting = true;
      disconnectAll();
      panel?.sendDisconnected(false);
      // Keep userDisconnecting=true until after the new connection succeeds
      // (reset in the success path below, not on a timer)
    }

    bootDetected = true; // Assume device has already booted — any boot banner seen is a reset
    hciPacketCount = 0;
    errorCount = 0;
    watchMatcher.resetCounters();
    panel?.clear(); // Clear previous session's logs from the webview

    // Always show the panel when connecting — it shows connecting state and error cards
    const cfgConnect = getConfig();
    panel?.show(cfgConnect.logWrap, cfgConnect.timeFormat);
    sidebarProvider.updateState({ connecting: true });
    panel?.sendConnecting();

    if (transportType === "uart") {
      await connectAndShowUart(device, baudRate, parserMode);
    } else {
      await connectAndShowRtt(device, parserMode);
    }
    // Connection succeeded — reset disconnect flag and clear any error state
    userDisconnecting = false;
    telemetry.trackSessionStart(
      sidebarProvider.currentTransport as "rtt" | "uart",
      parserMode,
    );
  } catch (err) {
    // Clean up failed connection
    userDisconnecting = false;
    disconnectAll();
    sidebarProvider.updateState({ connecting: false, connected: false });

    const message = err instanceof Error ? err.message : String(err);
    const exitCode = err instanceof TransportError ? err.exitCode : undefined;
    const serialNumber = sidebarProvider.currentDevice;
    const error = classifyError(message, exitCode, serialNumber);
    telemetry.trackConnectFailed(error.code, sidebarProvider.currentTransport);

    // Webview error card (panel is already visible from the connect attempt)
    panel?.sendConnectError(error);

    // Reset before awaiting toast so Retry/Reconnect can call doConnect() again
    connectInFlight = false;

    // Toast notification — skip for errors where the webview card is sufficient
    const skipToast = error.code === "UART_DISCONNECTED" || error.code === "PROBE_UNPLUGGED" || error.code === "NO_RTT";
    if (!skipToast) {
      const picked = await vscode.window.showErrorMessage(
        `LogScope: ${error.headline}`,
        ...error.actions.map(a => a.label),
      );
      if (picked) {
        const action = error.actions.find(a => a.label === picked);
        if (action) handleErrorAction(action);
      }
    }
  } finally {
    connectInFlight = false;
  }
}

// ── Guided connect flow (QuickPick sequence with back navigation) ─

/** Sentinel thrown when user clicks the Back button */
class BackError extends Error { constructor() { super("back"); } }

/** Show a QuickPick step with optional back button. Rejects with BackError on back. */
function showStepQuickPick<T extends vscode.QuickPickItem>(
  items: T[],
  options: { placeholder: string; step?: number; totalSteps?: number; showBack?: boolean; title?: string },
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const qp = vscode.window.createQuickPick<T>();
    qp.placeholder = options.placeholder;
    qp.items = items;
    qp.matchOnDescription = true;
    if (options.title) qp.title = options.title;
    if (options.step) qp.step = options.step;
    if (options.totalSteps) qp.totalSteps = options.totalSteps;
    if (options.showBack) {
      qp.buttons = [vscode.QuickInputButtons.Back];
    }

    qp.onDidAccept(() => {
      const selected = qp.selectedItems[0];
      qp.dispose();
      if (selected) resolve(selected);
    });
    qp.onDidTriggerButton((btn) => {
      if (btn === vscode.QuickInputButtons.Back) {
        qp.dispose();
        reject(new BackError());
      }
    });
    qp.onDidHide(() => {
      qp.dispose();
      // Resolve with nothing — caller treats undefined as cancel
    });
    qp.show();
  });
}

async function guidedConnect(): Promise<void> {
  let step = 1;
  let transportValue: "rtt" | "uart" = "rtt";
  let parserValue: "zephyr" | "nrf5" | "raw" = "zephyr";
  let port: { path: string; manufacturer?: string } | undefined;

  while (step > 0) {
    try {
      switch (step) {
        case 1: {
          // Pick transport
          const pick = await showStepQuickPick(
            [
              { label: "$(circuit-board) J-Link RTT", description: "Real-Time Transfer via J-Link probe", value: "rtt" as const },
              { label: "$(plug) Serial UART", description: "USB CDC ACM or UART bridge", value: "uart" as const },
            ] as (vscode.QuickPickItem & { value: "rtt" | "uart" })[],
            { placeholder: "Select transport", step: 1, totalSteps: transportValue === "uart" ? 4 : 3, title: "Connect Device" },
          );
          if (!pick) { telemetry.trackConnectFlowAbandoned("transport"); return; }
          transportValue = (pick as { value: "rtt" | "uart" }).value;
          step = 2;
          break;
        }

        case 2: {
          // Pick parser
          const totalSteps = transportValue === "uart" ? 4 : 3;
          const pick = await showStepQuickPick(
            [
              { label: "$(file-code) Zephyr", description: "Zephyr RTOS — LOG_INF, LOG_ERR, LOG_WRN macros", value: "zephyr" as const },
              { label: "$(file-code) nRF5 SDK", description: "nRF5 SDK — NRF_LOG_INFO, NRF_LOG_ERROR macros", value: "nrf5" as const },
              { label: "$(file-code) Raw", description: "Any firmware — displays output as-is, no parsing", value: "raw" as const },
            ] as (vscode.QuickPickItem & { value: "zephyr" | "nrf5" | "raw" })[],
            { placeholder: "Select log format", step: 2, totalSteps, showBack: true, title: "Connect Device" },
          );
          if (!pick) { telemetry.trackConnectFlowAbandoned("parser"); return; }
          parserValue = (pick as { value: "zephyr" | "nrf5" | "raw" }).value;
          await saveSetting("parser", parserValue);
          sidebarProvider.updateState({ parser: parserValue });
          step = 3;
          break;
        }

        case 3: {
          // Pick device/port
          const totalSteps = transportValue === "uart" ? 4 : 3;
          if (transportValue === "uart") {
            const result = await pickSerialPort(true);
            if (!result) { telemetry.trackConnectFlowAbandoned("device"); return; }
            port = result;
            step = 4; // go to baud rate
          } else {
            const device = await pickJlinkDevice(true);
            if (!device) { telemetry.trackConnectFlowAbandoned("device"); return; }
            sidebarProvider.updateState({
              transport: "rtt",
              selectedDevice: String(device.serial),
              selectedDeviceLabel: deviceLabel(device),
            });
            await doConnect();
            return;
          }
          break;
        }

        case 4: {
          // Pick baud rate (UART only)
          const baudRate = await pickBaudRate(true);
          if (!baudRate) { telemetry.trackConnectFlowAbandoned("baudRate"); return; }
          sidebarProvider.updateState({
            transport: "uart",
            selectedDevice: port!.path,
            selectedDeviceLabel: port!.label,
            baudRate,
          });
          await doConnect();
          return;
        }
      }
    } catch (err) {
      if (err instanceof BackError) {
        step--;
      } else {
        throw err;
      }
    }
  }
}

function deviceLabel(dev: { serial: number; targetName?: string }): string {
  const name = dev.targetName || "Unknown device";
  return `${name} (SN: ${dev.serial})`;
}

// ── Individual QuickPick helpers (reused by guided flow + change settings)

async function pickSerialPort(showBack = false): Promise<{ path: string; label: string } | undefined> {
  const qp = vscode.window.createQuickPick<vscode.QuickPickItem & { _path?: string; _label?: string; _rescan?: boolean }>();
  qp.placeholder = "Select serial port...";
  qp.title = "Connect Device";
  qp.busy = true;
  qp.items = [{ label: "Scanning..." }];
  if (showBack) {
    qp.buttons = [vscode.QuickInputButtons.Back];
    qp.step = 2;
    qp.totalSteps = 3;
  }
  qp.show();

  const scanPorts = async () => {
    qp.busy = true;
    qp.items = [{ label: "Scanning..." }];
    const ports = await discoverSerialPorts();
    if (ports.length === 0) {
      const error = classifyError("No serial ports found");
      panel?.sendConnectError(error);
      qp.items = [{ label: "No serial ports found" }, { label: "$(refresh) Rescan", _rescan: true }];
      qp.busy = false;
      return;
    }
    qp.items = [
      ...ports.map(p => {
        // Primary label: "J-Link (Port 1)" or just "J-Link" or path basename
        const basename = p.path.split("/").pop() || p.path.split("\\").pop() || p.path;
        const name = p.description || basename;
        const primaryLabel = p.portNumber ? `${name} (Port ${p.portNumber})` : name;
        // Detail line: "CDC — SN 001057721387 — COM3"
        const details: string[] = [];
        if (p.manufacturer) details.push(p.manufacturer);
        if (p.serialNumber) details.push(`SN: ${p.serialNumber}`);
        details.push(p.path);
        return {
          label: primaryLabel,
          description: details.join(" — "),
          _path: p.path,
          _label: primaryLabel,
        };
      }),
      { label: "$(refresh) Rescan", _rescan: true },
    ];
    qp.busy = false;
  };

  return new Promise<{ path: string; label: string } | undefined>((resolve, reject) => {
    let resolved = false;
    qp.onDidAccept(async () => {
      const selected = qp.selectedItems[0] as { _path?: string; _label?: string; _rescan?: boolean };
      if (!selected) return;
      if (selected._rescan) {
        await scanPorts();
        return;
      }
      resolved = true;
      qp.dispose();
      resolve({ path: selected._path!, label: selected._label || selected._path! });
    });
    qp.onDidTriggerButton((btn) => {
      if (btn === vscode.QuickInputButtons.Back) {
        resolved = true;
        qp.dispose();
        reject(new BackError());
      }
    });
    qp.onDidHide(() => {
      qp.dispose();
      if (!resolved) resolve(undefined);
    });

    // Start scanning AFTER event handlers are registered so Back works during scan
    scanPorts();
  });
}

async function pickJlinkDevice(showBack = false): Promise<(DiscoveredDevice & { targetName?: string }) | undefined> {
  const qp = vscode.window.createQuickPick<vscode.QuickPickItem & { _serial?: number; _rescan?: boolean }>();
  qp.placeholder = "Select J-Link device...";
  qp.title = "Connect Device";
  qp.busy = true;
  qp.items = [{ label: "Scanning..." }];
  if (showBack) {
    qp.buttons = [vscode.QuickInputButtons.Back];
    qp.step = 2;
    qp.totalSteps = 2;
  }
  qp.show();

  const scanDevices = async () => {
    qp.busy = true;
    qp.items = [{ label: "Scanning..." }];
    const devices = await discoverDevices();
    lastDiscoveredDevices = devices;
    if (devices.length === 0) {
      qp.items = [{ label: "No J-Link devices found" }, { label: "$(refresh) Rescan", _rescan: true }];
      qp.busy = false;
      return;
    }
    qp.items = [
      ...devices.map(d => ({
        label: deviceLabel(d as DiscoveredDevice & { targetName?: string }),
        _serial: d.serial,
      })),
      { label: "$(refresh) Rescan", _rescan: true },
    ];
    qp.busy = false;
  };

  return new Promise<(DiscoveredDevice & { targetName?: string }) | undefined>((resolve, reject) => {
    let resolved = false;
    qp.onDidAccept(async () => {
      const selected = qp.selectedItems[0] as { _serial?: number; _rescan?: boolean };
      if (!selected) return;
      if (selected._rescan) {
        await scanDevices();
        return;
      }
      resolved = true;
      qp.dispose();
      const device = lastDiscoveredDevices.find(d => d.serial === selected._serial);
      resolve(device as (DiscoveredDevice & { targetName?: string }) | undefined);
    });
    qp.onDidTriggerButton((btn) => {
      if (btn === vscode.QuickInputButtons.Back) {
        resolved = true;
        qp.dispose();
        reject(new BackError());
      }
    });
    qp.onDidHide(() => {
      qp.dispose();
      if (!resolved) resolve(undefined);
    });

    // Start scanning AFTER event handlers are registered so Back works during scan
    scanDevices();
  });
}

async function pickBaudRate(showBack = false): Promise<number | undefined> {
  const rates = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600, 1000000];
  const currentRate = sidebarProvider.currentBaudRate;
  const items = rates.map(r => ({
    label: r.toLocaleString(),
    value: r,
    description: r === currentRate ? "(current)" : "",
  }));

  if (!showBack) {
    const pick = await vscode.window.showQuickPick(items, { placeHolder: "Select baud rate" });
    if (!pick) return undefined;
    return (pick as { value: number }).value;
  }

  // With back button support
  const pick = await showStepQuickPick(
    items as (vscode.QuickPickItem & { value: number })[],
    { placeholder: "Select baud rate", step: 3, totalSteps: 3, showBack: true },
  );
  if (!pick) return undefined;
  return (pick as { value: number }).value;
}

// ── Change settings flow ────────────────────────────────────────

async function changeTransport(): Promise<void> {
  const transportPick = await showStepQuickPick(
    [
      { label: "J-Link RTT", value: "rtt" as const, description: "Real-Time Transfer via J-Link probe" },
      { label: "Serial UART", value: "uart" as const, description: "USB CDC ACM or UART bridge" },
    ] as (vscode.QuickPickItem & { value: "rtt" | "uart" })[],
    { placeholder: "Select transport", title: "Connection Settings", showBack: true },
  );
  if (!transportPick) return;
  const newTransport = (transportPick as { value: "rtt" | "uart" }).value;
  sidebarProvider.updateState({
    transport: newTransport,
    selectedDevice: "",
    selectedDeviceLabel: "",
  });
  await saveSetting("transport", newTransport);
  // After changing transport, prompt to pick a device
  if (newTransport === "uart") {
    const port = await pickSerialPort(true);
    if (port) {
      sidebarProvider.updateState({ selectedDevice: port.path, selectedDeviceLabel: port.label });
      await saveSetting("uart.lastPort", port.path);
    }
  } else {
    const device = await pickJlinkDevice(true);
    if (device) {
      sidebarProvider.updateState({
        selectedDevice: String(device.serial),
        selectedDeviceLabel: `${device.targetName || "Unknown"} (SN: ${device.serial})`,
      });
      await saveSetting("lastDevice", String(device.serial));
    }
  }
}

async function changeDevice(): Promise<void> {
  if (sidebarProvider.currentTransport === "uart") {
    const port = await pickSerialPort(true);
    if (port) {
      sidebarProvider.updateState({ selectedDevice: port.path, selectedDeviceLabel: port.label });
      await saveSetting("uart.lastPort", port.path);
    }
  } else {
    const device = await pickJlinkDevice(true);
    if (device) {
      sidebarProvider.updateState({
        selectedDevice: String(device.serial),
        selectedDeviceLabel: `${device.targetName || "Unknown"} (SN: ${device.serial})`,
      });
      await saveSetting("lastDevice", String(device.serial));
    }
  }
}

async function changeBaudRate(): Promise<void> {
  const rate = await pickBaudRate(true);
  if (rate) {
    sidebarProvider.updateState({ baudRate: rate });
    await saveSetting("uart.baudRate", rate);
  }
}

async function changeParser(currentParser: string): Promise<void> {
  const modes = ["zephyr", "nrf5", "raw"] as const;
  const labels: Record<string, string> = { zephyr: "Zephyr", nrf5: "nRF5 SDK", raw: "Raw" };
  const descriptions: Record<string, string> = {
    zephyr: "Zephyr RTOS log format",
    nrf5: "nRF5 SDK NRF_LOG format",
    raw: "Display lines as-is with no parsing",
  };
  const parserPick = await showStepQuickPick(
    modes.map(m => ({
      label: labels[m],
      value: m,
      description: m === currentParser ? "(current)" : descriptions[m],
    })) as (vscode.QuickPickItem & { value: string })[],
    { placeholder: "Select log parser", title: "Connection Settings", showBack: true },
  );
  if (!parserPick) return;
  const selected = (parserPick as { value: string }).value;
  if (selected === currentParser) return;
  telemetry.trackParserChange(currentParser, selected);
  await saveSetting("parser", selected);
  sidebarProvider.updateState({ parser: selected as "zephyr" | "nrf5" | "raw" });

  // If connected, offer to reconnect so the new parser takes effect
  if (transport?.connected) {
    const parserLabels: Record<string, string> = { zephyr: "Zephyr", nrf5: "nRF5 SDK", raw: "Raw" };
    const answer = await vscode.window.showInformationMessage(
      `Parser changed to ${parserLabels[selected]}. Reconnect to apply?`,
      "Reconnect",
      "Later",
    );
    if (answer === "Reconnect") {
      userDisconnecting = true;
      disconnectAll();
      panel?.sendDisconnected(false);
      sidebarProvider.updateState({ connected: false, connecting: false });
      setTimeout(() => { userDisconnecting = false; }, 100);
      await doConnect();
    }
  }
}

async function changeSettings(): Promise<void> {
  // Loop so back buttons return to the settings menu
  while (true) {
    const transportLabel = sidebarProvider.currentTransport === "rtt" ? "J-Link RTT" : "Serial UART";
    const devLabel = sidebarProvider.currentDeviceLabel || sidebarProvider.currentDevice || "None";

    const parserLabels: Record<string, string> = { zephyr: "Zephyr", nrf5: "nRF5 SDK", raw: "Raw" };
    const currentParser = vscode.workspace.getConfiguration("logscope").get<string>("parser", "zephyr");

    const items: (vscode.QuickPickItem & { _key: string })[] = [
      { label: "$(circuit-board) Transport", description: transportLabel, _key: "transport" },
      { label: "$(device-desktop) Device", description: devLabel, _key: "device" },
    ];

    if (sidebarProvider.currentTransport === "uart") {
      items.push({ label: "$(dashboard) Baud Rate", description: String(sidebarProvider.currentBaudRate), _key: "baudRate" });
    }

    items.push({ label: "$(file-code) Parser", description: parserLabels[currentParser] || "Zephyr", _key: "parser" });

    const pick = await showStepQuickPick(
      items as (vscode.QuickPickItem & { _key: string })[],
      { placeholder: "Change connection setting", title: "Connection Settings" },
    );
    if (!pick) return;

    const key = (pick as { _key: string })._key;

    try {
      switch (key) {
        case "transport":
          await changeTransport();
          return;
        case "device":
          await changeDevice();
          return;
        case "baudRate":
          await changeBaudRate();
          return;
        case "parser":
          await changeParser(currentParser);
          return;
      }
    } catch (err) {
      if (err instanceof BackError) {
        continue; // Back to settings menu
      }
      throw err;
    }
  }
}

// ── Export helper ────────────────────────────────────────────────

async function doExport(): Promise<void> {
  if (!ringBuffer || ringBuffer.size === 0) {
    vscode.window.showWarningMessage("LogScope: Nothing to export — no log entries captured yet.");
    return;
  }
  const format = await vscode.window.showQuickPick(
    [
      { label: "Text (.log)", value: "text", description: "All log entries as plain text" },
      { label: "JSON Lines (.jsonl)", value: "jsonl", description: "All log entries as JSON" },
      { label: "Wireshark (.btsnoop)", value: "btsnoop", description: "HCI packets only — opens in Wireshark" },
    ],
    { placeHolder: "Select export format" }
  );
  if (!format) return;

  const formatValue = (format as { label: string; value: string }).value;
  const entries = ringBuffer.getAll();

  if (formatValue === "btsnoop") {
    const hciCount = entries.filter(e => e.source === "hci" && e.raw && e.metadata?.opcode).length;
    if (hciCount === 0) {
      vscode.window.showWarningMessage("LogScope: No HCI packets captured. To export btsnoop, enable the Bluetooth LE monitor (bt_monitor) in your firmware and connect via J-Link RTT.");
      return;
    }
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(`logscope-${new Date().toISOString().slice(0,19).replaceAll(/[T:]/g, "-")}.btsnoop`),
      filters: { "btsnoop files": ["btsnoop"], "All files": ["*"] },
    });
    if (!uri) return;
    const startTime = session?.startTime ?? new Date();
    const btsnoopData = exportAsBtsnoop(entries, startTime);
    await vscode.workspace.fs.writeFile(uri, btsnoopData);
    telemetry.trackExport("btsnoop", hciCount);
    vscode.window.showInformationMessage(`LogScope: Exported ${hciCount} HCI packets to ${uri.fsPath} — open with Wireshark`);
  } else {
    const ext = formatValue === "jsonl" ? "jsonl" : "log";
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(`logscope-${new Date().toISOString().slice(0,19).replaceAll(/[T:]/g, "-")}.${ext}`),
      filters: { "Log files": [ext] },
    });
    if (!uri) return;
    const content = formatValue === "jsonl" ? exportAsJsonLines(entries) : exportAsText(entries);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf-8"));
    telemetry.trackExport(formatValue as "text" | "jsonl", entries.length);
    vscode.window.showInformationMessage(`LogScope: Exported ${entries.length} entries to ${uri.fsPath}`);
  }
}

// ── Activation ──────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext) {
  panel = new LogScopePanel(context.extensionUri);
  statusBar = new StatusBar();

  // Register sidebar TreeView
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("logscope.sidebar", sidebarProvider)
  );

  // Initialize sidebar state from settings (sets context keys)
  sidebarProvider.initFromSettings();

  loadWatchPatterns();

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration("logscope.watchPatterns")) {
        loadWatchPatterns();
        sidebarProvider.updateState({ watchCounters: watchMatcher.getCounters() });
      }
    }),
  );

  // Initialize telemetry
  telemetry.init(context);
  telemetry.trackActivation(context.extension.packageJSON.version);

  // Check for Python on activation (non-blocking)
  const PYTHON_WARNING_DISMISSED = "logscope.pythonWarningDismissed";
  if (!context.globalState.get<boolean>(PYTHON_WARNING_DISMISSED)) {
    try {
      resolveSystemPython();
    } catch {
      vscode.window.showWarningMessage(
        "LogScope requires Python 3 for device discovery and communication. Install Python and reload VS Code.",
        "Download Python",
        "Dismiss",
      ).then(selection => {
        if (selection === "Download Python") {
          vscode.env.openExternal(vscode.Uri.parse("https://www.python.org/downloads/"));
        } else if (selection === "Dismiss") {
          context.globalState.update(PYTHON_WARNING_DISMISSED, true);
        }
      });
    }
  }

  // Handle messages from WebView (viewer-only messages)
  panel.setMessageHandler(async (msg) => {
    switch (msg.type) {
      case "triggerConnect": {
        await doConnect();
        break;
      }

      case "disconnect": {
        userDisconnecting = true;
        disconnectAll();
        panel?.sendDisconnected(false);
        sidebarProvider.updateState({ connected: false, connecting: false });
        setTimeout(() => { userDisconnecting = false; }, 100);
        break;
      }

      case "export": {
        await doExport();
        break;
      }

      case "updateSetting": {
        const key = (msg.key as string).replace("logscope.", "");
        await saveSetting(key, msg.value);
        break;
      }

      case "clear": {
        ringBuffer?.clear();
        watchMatcher.resetCounters();
        panel?.clear();
        break;
      }

      case "openExternal": {
        const url = msg.url as string;
        if (url) {
          vscode.env.openExternal(vscode.Uri.parse(url));
        }
        break;
      }

      case "errorAction": {
        const action: ErrorAction = {
          label: "",
          command: msg.action as string,
          args: msg.args as unknown[],
        };
        handleErrorAction(action);
        break;
      }
    }
  });

  // ── Commands ──────────────────────────────────────────────

  const openCmd = vscode.commands.registerCommand("logscope.open", () => {
    const cfg = getConfig();
    panel?.show(cfg.logWrap, cfg.timeFormat);
    // If connected, send state to the (possibly fresh) webview
    if (transport?.connected) {
      const currentParser = vscode.workspace.getConfiguration("logscope").get<string>("parser", "zephyr");
      setTimeout(() => {
        panel?.sendConnected(
          sidebarProvider.connectedTransportLabel,
          sidebarProvider.connectedAddress,
          currentParser,
        );
      }, 150);
    }
  });

  const connectCmd = vscode.commands.registerCommand("logscope.connect", async () => {
    await guidedConnect();
  });

  const reconnectCmd = vscode.commands.registerCommand("logscope.reconnect", async () => {
    await doConnect();
  });

  const disconnectCmd = vscode.commands.registerCommand("logscope.disconnect", () => {
    if (!transport?.connected) return;
    userDisconnecting = true;
    disconnectAll();
    panel?.sendDisconnected(false);
    sidebarProvider.updateState({ connected: false, connecting: false });
    setTimeout(() => { userDisconnecting = false; }, 100);
  });

  const exportCmd = vscode.commands.registerCommand("logscope.export", async () => {
    await doExport();
  });

  const changeSettingsCmd = vscode.commands.registerCommand("logscope.changeSettings", async () => {
    await changeSettings();
  });

  const openWalkthroughCmd = vscode.commands.registerCommand("logscope.openWalkthrough", () => {
    vscode.commands.executeCommand(
      "workbench.action.openWalkthrough",
      "novelbits.novelbits-logscope#logscope.getStarted",
      true,
    );
  });

  const cycleParserCmd = vscode.commands.registerCommand("logscope.cycleParser", async () => {
    const cfg = vscode.workspace.getConfiguration("logscope");
    const current = cfg.get<string>("parser", "zephyr");
    await changeParser(current);
  });

  const addWatchPatternCmd = vscode.commands.registerCommand("logscope.addWatchPattern", async () => {
    const name = await vscode.window.showInputBox({
      prompt: "Pattern name",
      placeHolder: "e.g., Retransmission",
    });
    if (!name) return;

    const pattern = await vscode.window.showInputBox({
      prompt: "Text to match",
      placeHolder: "e.g., retransmit",
    });
    if (!pattern) return;

    const regexPick = await vscode.window.showQuickPick(
      ["Substring match (default)", "Regular expression"],
      { placeHolder: "Match type" },
    );
    if (!regexPick) return;
    const isRegex = regexPick.startsWith("Regular");

    let module: string | undefined;
    if (session) {
      const moduleItems = ["All modules", ...Array.from(session.modules)];
      const modulePick = await vscode.window.showQuickPick(moduleItems, {
        placeHolder: "Scope to module (optional)",
      });
      if (!modulePick) return;
      if (modulePick !== "All modules") module = modulePick;
    }

    const newPattern: WatchPatternConfig = { name, pattern };
    if (isRegex) newPattern.regex = true;
    if (module) newPattern.module = module;

    const cfg = vscode.workspace.getConfiguration("logscope");
    const existing = cfg.get<WatchPatternConfig[]>("watchPatterns", []);
    await saveSetting("watchPatterns", [...existing, newPattern]);
  });

  const removeWatchPatternCmd = vscode.commands.registerCommand("logscope.removeWatchPattern", async () => {
    const cfg = vscode.workspace.getConfiguration("logscope");
    const patterns = cfg.get<WatchPatternConfig[]>("watchPatterns", []);
    if (patterns.length === 0) {
      vscode.window.showInformationMessage("LogScope: No watch patterns configured.");
      return;
    }

    const pick = await vscode.window.showQuickPick(
      patterns.map(p => ({ label: p.name, description: p.pattern })),
      { placeHolder: "Select pattern to remove" },
    );
    if (!pick) return;

    const updated = patterns.filter(p => p.name !== pick.label);
    await saveSetting("watchPatterns", updated);
  });

  const scrollToWatchCmd = vscode.commands.registerCommand("logscope.scrollToWatchMatch", (patternName: string) => {
    const cfg = getConfig();
    panel?.show(cfg.logWrap, cfg.timeFormat);
    // TODO: panel?.postMessage() will be added in Task 5
  });

  // ── Auto-connect on activation ────────────────────────────

  const devCfg = vscode.workspace.getConfiguration("logscope");
  const autoConnect = devCfg.get<boolean>("autoConnect", false);

  if (autoConnect && sidebarProvider.currentDevice) {
    const attemptAutoConnect = async (attempt: number) => {
      const MAX_RETRIES = 2;
      const RETRY_DELAYS = [500, 2000];
      try {
        await doConnect();
      } catch (err) {
        if (attempt < MAX_RETRIES) {
          console.log(`[LogScope] Auto-connect attempt ${attempt} failed, retrying in ${RETRY_DELAYS[attempt]}ms...`);
          setTimeout(() => attemptAutoConnect(attempt + 1), RETRY_DELAYS[attempt]);
        } else {
          console.log(`[LogScope] Auto-connect failed after ${MAX_RETRIES + 1} attempts`);
          const message = err instanceof Error ? err.message : String(err);
          const exitCode = err instanceof TransportError ? err.exitCode : undefined;
          const error = classifyError(message, exitCode, sidebarProvider.currentDevice);
          panel?.sendConnectError(error);
          // No toast — too intrusive on startup
        }
      }
    };
    attemptAutoConnect(0);
  }

  context.subscriptions.push(
    openCmd, connectCmd, reconnectCmd, disconnectCmd, exportCmd,
    changeSettingsCmd, openWalkthroughCmd, cycleParserCmd,
    addWatchPatternCmd, removeWatchPatternCmd, scrollToWatchCmd,
  );
}

export function deactivate() {
  telemetry.dispose();
  disconnectAll();
  statusBar?.dispose();
  statusBar = null;
}
