import * as vscode from "vscode";
import { NrfutilRttTransport, discoverDevices } from "./transport/nrfutil-rtt";
import type { DiscoveredDevice } from "./transport/nrfutil-rtt";
import { UartTransport, discoverSerialPorts } from "./transport/uart-serial";
import { ZephyrLogParser } from "./parser/zephyr-log";
import { HciParser } from "./parser/hci-parser";
import { RingBuffer } from "./model/ring-buffer";
import { Session, exportAsText, exportAsJsonLines } from "./model/session";
import { exportAsBtsnoop } from "./model/btsnoop-export";
import { LogScopePanel } from "./ui/webview-provider";
import { StatusBar } from "./ui/status-bar";
import { LogScopeSidebarProvider } from "./ui/sidebar-provider";
import { autoDetectRttAddress } from "./rtt-detect";
import type { Transport } from "./transport/types";

// ── Module-level state ──────────────────────────────────────────
let transport: Transport | null = null;
let session: Session | null = null;
let ringBuffer: RingBuffer | null = null;
const parser = new ZephyrLogParser();
const hciParser = new HciParser();
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
    logWrap: cfg.get<boolean>("logWrap", false),
  };
}


let bootDetected = false;

function handleChunk(chunk: Buffer): void {
  if (!ringBuffer || !session) return;

  lineBuffer += chunk.toString("utf-8");
  const segments = lineBuffer.split("\n");
  lineBuffer = segments.pop() ?? "";

  if (segments.length === 0) return;

  const completeText = segments.join("\n") + "\n";
  if (completeText.includes("*** Booting")) {
    if (bootDetected) {
      panel?.sendReset();
    }
    bootDetected = true;
  }

  const entries = parser.parse(completeText);

  for (const entry of entries) {
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
    const entries = hciParser.parse(chunk);
    for (const entry of entries) {
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

  t.on("disconnected", () => {
    if (!userDisconnecting) {
      panel?.sendDisconnected(true);
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
    sidebarProvider.updateState({ entryCount: count, hciPacketCount, errorCount });
  }, 500);
}

function stopStatusUpdates(): void {
  if (statusInterval) {
    clearInterval(statusInterval);
    statusInterval = null;
  }
}

function disconnectAll(): void {
  if (transport?.connected) {
    transport.disconnect();
  }
  transport = null;
  lineBuffer = "";
  stopStatusUpdates();
  statusBar?.update(false, ringBuffer?.size ?? 0, ringBuffer?.evictedCount ?? 0);
  panel?.updateStatus(false, ringBuffer?.size ?? 0, ringBuffer?.evictedCount ?? 0);
}

// ── Connect helpers ─────────────────────────────────────────────

async function connectRtt(device: string, pollInterval: number): Promise<void> {
  const cfg = getConfig();
  ringBuffer = new RingBuffer(cfg.maxEntries);
  session = new Session("device", "rtt");
  lineBuffer = "";

  const rttTransport = new NrfutilRttTransport({
    device,
    pollIntervalMs: pollInterval,
    nrfutilPath: cfg.nrfutilPath,
  });
  transport = rttTransport;
  wireTransportEvents(rttTransport);
  await rttTransport.connect();
  startStatusUpdates();
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
    // Disconnect existing connection before switching
    if (transport?.connected) {
      userDisconnecting = true;
      disconnectAll();
      panel?.sendDisconnected(false);
      setTimeout(() => { userDisconnecting = false; }, 100);
    }

    bootDetected = true; // Assume device has already booted — any boot banner seen is a reset
    hciPacketCount = 0;
    errorCount = 0;

    sidebarProvider.updateState({ connecting: true });
    panel?.sendConnecting();

    if (transportType === "uart") {
      await connectUart(device, baudRate);
      const devCfg = vscode.workspace.getConfiguration("logscope");
      await devCfg.update("uart.lastPort", device, vscode.ConfigurationTarget.Workspace);
      await devCfg.update("transport", "uart", vscode.ConfigurationTarget.Workspace);

      const cfg = getConfig();
      panel?.show(cfg.logWrap);
      // Fix #1: delay sendConnected to let webview load (show() uses 100ms for init)
      setTimeout(() => panel?.sendConnected("Serial UART", device), 150);
      sidebarProvider.updateState({
        connected: true, connecting: false,
        connectedTransport: "Serial UART", connectedAddress: device,
      });
    } else {
      const pollInterval = getConfig().rttPollInterval;
      await connectRtt("auto", pollInterval);
      const rttTransport = transport as NrfutilRttTransport;
      const displayName = rttTransport.detectedDevice || "Connected";
      const devCfg = vscode.workspace.getConfiguration("logscope");
      await devCfg.update("lastDevice", device, vscode.ConfigurationTarget.Workspace);
      await devCfg.update("transport", "rtt", vscode.ConfigurationTarget.Workspace);

      const cfg = getConfig();
      panel?.show(cfg.logWrap);
      setTimeout(() => panel?.sendConnected("J-Link RTT", displayName), 150);
      sidebarProvider.updateState({
        connected: true, connecting: false,
        connectedTransport: "J-Link RTT", connectedAddress: displayName,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`LogScope: Connection failed — ${message}`);
    panel?.sendConnectError(message);
    sidebarProvider.updateState({ connecting: false, connected: false }); // Fix #2
    disconnectAll();
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
  let port: { path: string; manufacturer?: string } | undefined;

  while (step > 0) {
    try {
      switch (step) {
        case 1: {
          // Pick transport
          const totalSteps = 2;
          const pick = await showStepQuickPick(
            [
              { label: "$(circuit-board) J-Link RTT", description: "Real-Time Transfer via J-Link probe", value: "rtt" as const },
              { label: "$(plug) Serial UART", description: "USB CDC ACM or UART bridge", value: "uart" as const },
            ] as (vscode.QuickPickItem & { value: "rtt" | "uart" })[],
            { placeholder: "Select transport", step: 1, totalSteps, title: "Connect Device" },
          );
          if (!pick) return; // cancelled
          transportValue = (pick as { value: "rtt" | "uart" }).value;
          step = 2;
          break;
        }

        case 2: {
          // Pick device/port
          if (transportValue === "uart") {
            const result = await pickSerialPort(true); // true = show back button
            if (!result) return;
            port = result;
            step = 3; // go to baud rate
          } else {
            const device = await pickJlinkDevice(true);
            if (!device) return;
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

        case 3: {
          // Pick baud rate (UART only)
          const baudRate = await pickBaudRate(true);
          if (!baudRate) return;
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
      qp.items = [{ label: "No serial ports found" }];
      qp.busy = false;
      return;
    }
    qp.items = [
      ...ports.map(p => {
        // Primary label: "J-Link (Port 1)" or just "J-Link" or path basename
        const name = p.description || p.path.split("/").pop() || p.path;
        const primaryLabel = p.portNumber ? `${name} (Port ${p.portNumber})` : name;
        // Detail line: "CDC — SN 001057721387 — /dev/cu.usbmodem..."
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

  await scanPorts();

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
      qp.items = [{ label: "No J-Link devices found" }];
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

  await scanDevices();

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

async function changeSettings(): Promise<void> {
  // Loop so back buttons return to the settings menu
  while (true) {
    const transportLabel = sidebarProvider.currentTransport === "rtt" ? "J-Link RTT" : "Serial UART";
    const devLabel = sidebarProvider.currentDeviceLabel || sidebarProvider.currentDevice || "None";

    const items: (vscode.QuickPickItem & { _key: string })[] = [
      { label: "$(circuit-board) Transport", description: transportLabel, _key: "transport" },
      { label: "$(device-desktop) Device", description: devLabel, _key: "device" },
    ];

    if (sidebarProvider.currentTransport === "uart") {
      items.push({ label: "$(dashboard) Baud Rate", description: String(sidebarProvider.currentBaudRate), _key: "baudRate" });
    }

    const pick = await showStepQuickPick(
      items as (vscode.QuickPickItem & { _key: string })[],
      { placeholder: "Change connection setting", title: "Connection Settings" },
    );
    if (!pick) return;

    const key = (pick as { _key: string })._key;

    try {
      switch (key) {
        case "transport": {
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
          const cfg = vscode.workspace.getConfiguration("logscope");
          await cfg.update("transport", newTransport, vscode.ConfigurationTarget.Workspace);
          // After changing transport, prompt to pick a device
          if (newTransport === "uart") {
            const port = await pickSerialPort(true);
            if (port) {
              sidebarProvider.updateState({ selectedDevice: port.path, selectedDeviceLabel: port.label });
              await cfg.update("uart.lastPort", port.path, vscode.ConfigurationTarget.Workspace);
            }
          } else {
            const device = await pickJlinkDevice(true);
            if (device) {
              sidebarProvider.updateState({
                selectedDevice: String(device.serial),
                selectedDeviceLabel: `${device.targetName || "Unknown"} (SN: ${device.serial})`,
              });
              await cfg.update("lastDevice", String(device.serial), vscode.ConfigurationTarget.Workspace);
            }
          }
          return; // Done — setting changed
        }

        case "device": {
          const cfg = vscode.workspace.getConfiguration("logscope");
          if (sidebarProvider.currentTransport === "uart") {
            const port = await pickSerialPort(true);
            if (port) {
              sidebarProvider.updateState({ selectedDevice: port.path, selectedDeviceLabel: port.label });
              await cfg.update("uart.lastPort", port.path, vscode.ConfigurationTarget.Workspace);
            }
          } else {
            const device = await pickJlinkDevice(true);
            if (device) {
              sidebarProvider.updateState({
                selectedDevice: String(device.serial),
                selectedDeviceLabel: `${device.targetName || "Unknown"} (SN: ${device.serial})`,
              });
              await cfg.update("lastDevice", String(device.serial), vscode.ConfigurationTarget.Workspace);
            }
          }
          return;
        }

        case "baudRate": {
          const rate = await pickBaudRate(true);
          if (rate) {
            sidebarProvider.updateState({ baudRate: rate });
            const cfg = vscode.workspace.getConfiguration("logscope");
            await cfg.update("uart.baudRate", rate, vscode.ConfigurationTarget.Workspace);
          }
          return;
        }
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
      vscode.window.showWarningMessage("LogScope: No HCI packets to export. Connect a Bluetooth LE device to generate HCI traffic.");
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
        const cfgSection = vscode.workspace.getConfiguration("logscope");
        const key = (msg.key as string).replace("logscope.", "");
        await cfgSection.update(key, msg.value, vscode.ConfigurationTarget.Workspace);
        break;
      }

      case "clear": {
        ringBuffer?.clear();
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
    }
  });

  // ── Commands ──────────────────────────────────────────────

  const openCmd = vscode.commands.registerCommand("logscope.open", () => {
    const cfg = getConfig();
    panel?.show(cfg.logWrap);
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
        }
      }
    };
    attemptAutoConnect(0);
  }

  context.subscriptions.push(
    openCmd, connectCmd, reconnectCmd, disconnectCmd, exportCmd, changeSettingsCmd, openWalkthroughCmd,
  );
}

export function deactivate() {
  disconnectAll();
  statusBar?.dispose();
  statusBar = null;
}
