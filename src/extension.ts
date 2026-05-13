import * as vscode from "vscode";
import { execFile } from "child_process";
import { NrfutilRttTransport, discoverDevices, resolveSystemPython, ensurePythonEnv, isPythonEnvReady } from "./transport/nrfutil-rtt";
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
import { LicenseManager } from "./license/license-manager";
import { registerLicenseCommands, guardProFeature } from "./license/license-ui";
import { initLogger, log, logError } from "./logger";

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
let licenseManager: LicenseManager;

// ── Helpers ─────────────────────────────────────────────────────

function getConfig() {
  const cfg = vscode.workspace.getConfiguration("logscope");
  return {
    maxEntries: cfg.get<number>("maxEntries", 100_000),
    jlinkDevice: cfg.get<string>("jlink.device", "Cortex-M33"),
    jlinkDeviceOverrides: cfg.get<Record<string, string>>("jlink.deviceOverrides", {}),
    nrfutilPath: cfg.get<string>("nrfutil.path", "nrfutil"),
    rttPollInterval: cfg.get<number>("rtt.pollInterval", 50),
    rttSearchRanges: cfg.get<string>("jlink.rttSearchRanges", "0x20000000 0x80000"),
    rttSilenceThresholdSec: cfg.get<number>("rtt.silenceThreshold", 30),
    rttLegacyMode: cfg.get<boolean>("rtt.legacyMode", false),
    logWrap: cfg.get<boolean>("logWrap", false),
    timeFormat: cfg.get<string>("timeFormat", "24h"),
    columnWidths: cfg.get<Record<string, number>>("columnWidths", {}),
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

let freePatternNotificationShown = false;

function loadWatchPatterns(): void {
  const cfg = vscode.workspace.getConfiguration("logscope");
  const patterns = cfg.get<WatchPatternConfig[]>("watchPatterns", []);

  // License gate: truncate to 3 for free users
  const isPro = licenseManager?.isProFeatureAvailable() ?? false;
  const maxPatterns = isPro ? Infinity : 3;
  const effective = patterns.slice(0, maxPatterns);

  if (patterns.length > maxPatterns && !freePatternNotificationShown) {
    freePatternNotificationShown = true;
    vscode.window.showInformationMessage(
      "LogScope Free supports up to 3 watch patterns. Upgrade to Pro for unlimited.",
      "Enter License Key",
    ).then(choice => {
      if (choice === "Enter License Key") {
        licenseManager.enterLicenseKey();
      }
    });
  }

  watchMatcher.loadPatterns(effective);

  // Surface invalid regex patterns (prevents extension activation crashes and
  // gives the user a clear message instead of silently failing).
  if (watchMatcher.invalidPatterns.length > 0) {
    for (const bad of watchMatcher.invalidPatterns) {
      logError(`Watch pattern "${bad.name}" has invalid regex: ${bad.error}`);
    }
    const names = watchMatcher.invalidPatterns.map(p => p.name).join(", ");
    vscode.window.showWarningMessage(
      `LogScope: Invalid regex in watch pattern(s): ${names}. These patterns were skipped. Check the LogScope output channel for details.`,
    );
  }
}

let bootDetected = false;
// Timestamp of the most recent transport-emitted "reset" event. When the
// helper detects a target reset and re-attaches (full_reconnect or the cheap
// TargetResetError path), it prints "Reconnected OK", the transport emits
// "reset", and we fire sendReset() right away. The buffer-drain that follows
// the re-attach almost always contains the fresh "*** Booting" line, which
// the parser-side detection would ALSO treat as a reset, causing a duplicate
// banner. Suppress the parser-side banner for a short window after the
// transport already signaled the reset.
const TRANSPORT_RESET_DEDUPE_WINDOW_MS = 5000;
let lastTransportResetAt = 0;

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
  // Anchor at line start so a log line that quotes "*** Booting" in its
  // body (e.g., a developer note in the firmware, or a previously-captured
  // boot banner being replayed verbatim) doesn't trigger a false reset
  // detection. Real Zephyr boot banners always sit at the start of a line.
  if (/(^|\n)\*\*\* Booting/.test(completeText)) {
    if (bootDetected) {
      // If the transport just emitted "reset" (helper-detected mid-session
      // reset), it already called sendReset() — suppress the parser-driven
      // duplicate. Older transport-reset signals are stale and ignored.
      if (Date.now() - lastTransportResetAt > TRANSPORT_RESET_DEDUPE_WINDOW_MS) {
        panel?.sendReset();
      }
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
      if (entry.module !== "MON") hciPacketCount++;
    }
    if (entries.length > 0 && panel) {
      panel.addEntries(entries);
      const modules = Array.from(session.modules);
      panel.updateModules(modules);
    }
  });

  t.on("reset", () => {
    panel?.sendReset();
    lastTransportResetAt = Date.now();
  });

  t.on("channelName", (info: { index: number; name: string }) => {
    sidebarProvider.setChannelName(info.index, info.name);
  });

  t.on("disconnected", (info?: { reason?: string; message?: string }) => {
    log(`Transport disconnected${info?.reason ? ` (reason: ${info.reason})` : ""}${info?.message ? ` — ${info.message}` : ""}`);
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
    logError("Transport error", err);
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
    sidebarProvider.updateState({
      entryCount: count,
      hciPacketCount,
      errorCount,
      licenseTier: licenseManager?.getTierName() ?? "Free",
    });
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
  // Disconnect any live OR mid-connect transport. Mid-connect helpers (helper
  // process spawned but RTT_READY not yet seen) must also be killed: otherwise
  // they survive as orphans holding the J-Link probe when the extension host
  // is torn down (e.g., on window reload).
  if (transport) {
    transport.disconnect();
  }
  transport = null;
  lineBuffer = "";
  stopStatusUpdates();
  statusBar?.update(false, ringBuffer?.size ?? 0, ringBuffer?.evictedCount ?? 0);
  panel?.updateStatus(false, ringBuffer?.size ?? 0, ringBuffer?.evictedCount ?? 0);
}

function restorePanelFromSession(): void {
  if (!panel) return;

  // Clear any entries that leaked through during the webview transition.
  // The ring buffer is the source of truth and will be replayed below.
  panel.clear();

  // Re-send the current connection header in case this is a recreated webview.
  if (transport?.connected) {
    const currentParser = vscode.workspace.getConfiguration("logscope").get<string>("parser", "zephyr");
    panel.sendConnected(
      sidebarProvider.connectedTransportLabel,
      sidebarProvider.connectedAddress,
      currentParser,
    );
  }

  const allEntries = ringBuffer?.getAll() ?? [];
  if (allEntries.length > 0) {
    const REPLAY_CHUNK_SIZE = 1000;
    for (let i = 0; i < allEntries.length; i += REPLAY_CHUNK_SIZE) {
      panel.addEntries(allEntries.slice(i, i + REPLAY_CHUNK_SIZE));
    }
  }

  panel.updateModules(session ? Array.from(session.modules) : []);
  panel.updateStatus(transport?.connected ?? false, ringBuffer?.size ?? 0, ringBuffer?.evictedCount ?? 0);
}

function handleErrorAction(action: ErrorAction): void {
  switch (action.command) {
    case "rescan":
      vscode.commands.executeCommand("logscope.rescan");
      break;
    case "reconnect":
    case "retry":
      vscode.commands.executeCommand("logscope.reconnect");
      break;
    case "resetDevice":
      resetAndReconnect(action.args?.[0] as string);
      break;
    case "setJlinkDevice":
      vscode.commands.executeCommand("logscope.changeJlinkDevice");
      break;
    case "downloadPython":
      vscode.env.openExternal(vscode.Uri.parse("https://www.python.org/downloads/"));
      break;
    case "downloadSegger":
      vscode.env.openExternal(vscode.Uri.parse("https://www.segger.com/downloads/jlink"));
      break;
  }
}

async function resetAndReconnect(serialNumber?: string): Promise<void> {
  if (!serialNumber) return;

  const cfg = getConfig();
  const remoteHost = vscode.workspace.getConfiguration("logscope").get<string>("jlink.remoteHost", "");
  const isRemote = !!(remoteHost && sidebarProvider.currentDevice === remoteHost);

  // Resolve the J-Link device name for the target
  let jlinkDevice = "Cortex-M33";
  if (isRemote) {
    jlinkDevice = cfg.jlinkDevice !== "Cortex-M33" ? cfg.jlinkDevice : "Cortex-M33";
  } else if (/^\d+$/.test(serialNumber)) {
    const override = cfg.jlinkDeviceOverrides[serialNumber];
    if (override && override !== "auto") {
      jlinkDevice = override;
    } else if (cfg.jlinkDevice !== "Cortex-M33") {
      jlinkDevice = cfg.jlinkDevice;
    }
  }

  // Build JLinkExe command file for reset
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const cmdFile = path.join(os.tmpdir(), "logscope-reset.jlink");
  fs.writeFileSync(cmdFile, "r\ng\nq\n");

  const args = [
    "-device", jlinkDevice,
    "-if", "SWD",
    "-speed", "4000",
    "-autoconnect", "1",
    "-CommandFile", cmdFile,
  ];

  if (isRemote) {
    args.push("-ip", remoteHost);
  } else if (/^\d+$/.test(serialNumber)) {
    args.push("-USB", serialNumber);
  }

  // Honor logscope.jlink.path if the user has set it. Falls back to plain
  // "JLinkExe" (PATH lookup) if the setting is empty or the path doesn't
  // exist. Without this, users with custom SEGGER installs (e.g., older
  // version pinned for compatibility) saw their reset action silently use
  // a different binary than their connect path.
  const fsForJLink = await import("node:fs");
  const userJlinkPath = vscode.workspace.getConfiguration("logscope").get<string>("jlink.path", "").trim();
  const jlinkBin = userJlinkPath && fsForJLink.existsSync(userJlinkPath) ? userJlinkPath : "JLinkExe";

  log(`Reset device: ${jlinkBin} ${args.join(" ")}`);

  execFile(jlinkBin, args, { timeout: 10_000 }, (err) => {
    try { fs.unlinkSync(cmdFile); } catch { /* ignore */ }
    if (err) {
      logError("Reset device failed", err);
      vscode.window.showWarningMessage(`LogScope: Could not reset device. Check the LogScope output channel for details.`);
      return;
    }
    log("Device reset successful, reconnecting in 2s...");
    setTimeout(() => doConnect(), 2000);
  });
}

// ── Connect helpers ─────────────────────────────────────────────

async function connectRtt(device: string, pollInterval: number, serialNumber?: string): Promise<void> {
  const cfg = getConfig();
  ringBuffer = new RingBuffer(cfg.maxEntries);
  session = new Session("device", "rtt");
  lineBuffer = "";

  log(`RTT connect: device="${device}", serialNumber=${serialNumber ?? "(any)"}, pollInterval=${pollInterval}ms, searchRanges="${cfg.rttSearchRanges}"`);

  const MAX_RETRIES = 2;
  const RETRY_DELAY_MS = 2000;
  let lastErr: Error | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      log(`RTT connect retry ${attempt}/${MAX_RETRIES} after ${RETRY_DELAY_MS}ms...`);
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
    }

    const rttTransport = new NrfutilRttTransport({
      device,
      serialNumber,
      pollIntervalMs: pollInterval,
      nrfutilPath: cfg.nrfutilPath,
      rttSearchRanges: cfg.rttSearchRanges,
      silenceThresholdSec: cfg.rttSilenceThresholdSec,
      legacyMode: cfg.rttLegacyMode,
    });
    transport = rttTransport;
    wireTransportEvents(rttTransport);

    try {
      await rttTransport.connect();
      log(`RTT connected successfully`);
      startStatusUpdates();
      return;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      const exitCode = lastErr instanceof TransportError ? lastErr.exitCode : undefined;
      logError(`RTT connect attempt ${attempt + 1} failed${exitCode !== undefined ? ` (exit code ${exitCode})` : ""}`, lastErr);
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

  // Read frame settings from VS Code config; defaults preserve 8N1 behavior.
  const uartCfg = vscode.workspace.getConfiguration("logscope");
  const dataBits = uartCfg.get<5 | 6 | 7 | 8>("uart.dataBits", 8);
  const stopBits = uartCfg.get<"1" | "1.5" | "2">("uart.stopBits", "1");
  const parity = uartCfg.get<"none" | "odd" | "even" | "mark" | "space">("uart.parity", "none");

  const uartTransport = new UartTransport({ port: portPath, baudRate, dataBits, stopBits, parity });
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
  panel?.show(cfg.logWrap, cfg.timeFormat, cfg.columnWidths);
  panel?.sendConnected("Serial UART", device, parserMode);
  sidebarProvider.updateState({
    connected: true, connecting: false,
    connectedTransport: "Serial UART", connectedAddress: device,
  });
}

async function connectAndShowRtt(device: string, parserMode: string): Promise<void> {
  const cfg = getConfig();
  const pollInterval = cfg.rttPollInterval;

  // Per-probe device override takes priority, then global setting, then auto-detect.
  const probeOverride = cfg.jlinkDeviceOverrides[device];
  let jlinkDevice: string;
  if (probeOverride && probeOverride !== "auto") {
    jlinkDevice = probeOverride;
    log(`Device resolution: probe ${device} has override "${probeOverride}"`);
  } else if (cfg.jlinkDevice !== "Cortex-M33") {
    jlinkDevice = cfg.jlinkDevice;
    log(`Device resolution: using global jlink.device="${cfg.jlinkDevice}"`);
  } else {
    jlinkDevice = "auto";
    log(`Device resolution: auto-detect (no override for probe ${device})`);
  }
  await connectRtt(jlinkDevice, pollInterval, device);
  const rttTransport = transport as NrfutilRttTransport;
  const displayName = rttTransport.detectedDevice || "Connected";
  await saveSetting("lastDevice", device);
  await saveSetting("transport", "rtt");

  panel?.show(cfg.logWrap, cfg.timeFormat, cfg.columnWidths);
  panel?.sendConnected("J-Link RTT", displayName, parserMode);
  sidebarProvider.updateState({
    connected: true, connecting: false,
    connectedTransport: "J-Link RTT", connectedAddress: displayName,
  });
}

async function doConnect(): Promise<void> {
  if (connectInFlight) {
    vscode.window.showInformationMessage("LogScope: Connection already in progress.");
    return;
  }

  const transportType = sidebarProvider.currentTransport;
  const device = sidebarProvider.currentDevice;
  const baudRate = sidebarProvider.currentBaudRate;

  if (!device) {
    vscode.window.showWarningMessage("LogScope: No device selected.");
    return;
  }

  // Pre-flight check for RTT: verify the saved probe is actually connected.
  // This gives a clear error instead of a confusing pylink traceback when the
  // user reconnects after swapping boards or unplugging the previous probe.
  // Skip for remote connections and for UART.
  const savedRemoteHost = vscode.workspace.getConfiguration("logscope").get<string>("jlink.remoteHost", "");
  const isRemote = !!(savedRemoteHost && device === savedRemoteHost);
  if (transportType === "rtt" && !isRemote && /^\d+$/.test(device)) {
    try {
      const { devices: probes } = await discoverDevices();
      const serials = probes.map(p => String(p.serial));
      if (!serials.includes(device)) {
        const error = classifyError(`Probe SN ${device} no longer connected`, undefined, device);
        panel?.show(getConfig().logWrap, getConfig().timeFormat, getConfig().columnWidths);
        panel?.sendConnectError(error);
        sidebarProvider.updateState({ connected: false, connecting: false });
        return;
      }
    } catch {
      // Discovery failed; let the normal connect flow handle it
    }
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
    panel?.show(cfgConnect.logWrap, cfgConnect.timeFormat, cfgConnect.columnWidths);
    sidebarProvider.updateState({ connecting: true });
    statusBar?.setConnecting();
    panel?.sendConnecting();

    // Pre-flight: ensure Python environment is ready (can take 30-60s on first use)
    const requiredPackages = transportType === "uart" ? ["pyserial"] : ["pylink-square"];
    if (!isPythonEnvReady(requiredPackages)) {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "LogScope: Setting up Python environment (one-time setup)...", cancellable: false },
        async () => { await ensurePythonEnv(requiredPackages); },
      );
    }

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "LogScope: Connecting to device...", cancellable: true },
      async (_progress, token) => {
        const cancelPromise = new Promise<never>((_resolve, reject) => {
          token.onCancellationRequested(() => {
            reject(new Error("Connection cancelled by user"));
          });
        });
        await Promise.race([
          transportType === "uart"
            ? connectAndShowUart(device, baudRate, parserMode ?? "zephyr")
            : connectAndShowRtt(device, parserMode ?? "zephyr"),
          cancelPromise,
        ]);
      },
    );
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

    // User cancelled via the progress notification — clean up silently
    if (message === "Connection cancelled by user") {
      panel?.sendDisconnected(false);
      return;
    }

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

// ── Rescan: discover devices using current transport, connect if found ──

async function rescanAndConnect(): Promise<void> {
  const transportType = sidebarProvider.currentTransport;

  if (transportType === "uart") {
    const ports = await discoverSerialPorts();
    if (ports.length === 0) {
      const error = classifyError("No serial ports found");
      panel?.sendConnectError(error);
      return;
    }
    if (ports.length === 1) {
      const port = ports[0];
      const basename = port.path.split("/").pop() || port.path.split("\\").pop() || port.path;
      const name = port.description || basename;
      const portLabel = port.portNumber ? `${name} (Port ${port.portNumber})` : name;
      sidebarProvider.updateState({ selectedDevice: port.path, selectedDeviceLabel: portLabel });
      await doConnect();
      return;
    }
    // Multiple ports: show the port picker only (no guided wizard)
    const picked = await pickSerialPort();
    if (!picked) return;
    sidebarProvider.updateState({ selectedDevice: picked.path, selectedDeviceLabel: picked.label });
    await doConnect();
  } else {
    const { devices, error: discoverErr } = await discoverDevices();
    lastDiscoveredDevices = devices;
    if (devices.length === 0) {
      // If the helper reported a specific reason (e.g. SEGGER tools missing), surface it.
      // Otherwise fall back to the generic NO_PROBE message.
      const error = discoverErr
        ? classifyError(discoverErr)
        : classifyError("", 3); // exit code 3 = NO_PROBE
      panel?.sendConnectError(error);
      return;
    }
    if (devices.length === 1) {
      const dev = devices[0];
      sidebarProvider.updateState({
        selectedDevice: String(dev.serial),
        selectedDeviceLabel: deviceLabel(dev),
      });
      await doConnect();
      return;
    }
    // Multiple devices: show the device picker only (no guided wizard)
    const picked = await pickJlinkDevice();
    if (!picked) return;
    sidebarProvider.updateState({
      selectedDevice: String(picked.serial),
      selectedDeviceLabel: deviceLabel(picked),
    });
    await doConnect();
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
      // Items marked with _hint are advisory text, not actionable. Ignore
      // acceptance so the picker stays open rather than abandoning the wizard
      // when a user clicks the hint by accident.
      if (selected && (selected as { _hint?: boolean })._hint) {
        qp.selectedItems = [];
        return;
      }
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
  log("Guided connect flow started");
  let step = 1;
  let transportValue: "rtt" | "uart" = "rtt";
  let parserValue: "zephyr" | "nrf5" | "raw" = "zephyr";
  let port: { path: string; manufacturer?: string } | undefined;

  while (step > 0) {
    try {
      switch (step) {
        case 1: {
          // Pick transport. Separator + advisory item below help users who
          // don't know which transport their firmware uses.
          const pick = await showStepQuickPick(
            [
              { label: "$(circuit-board) J-Link RTT", description: "Real-Time Transfer via J-Link probe", value: "rtt" as const },
              { label: "$(plug) Serial UART", description: "USB CDC ACM or UART bridge", value: "uart" as const },
              { label: "Tip", kind: vscode.QuickPickItemKind.Separator },
              { label: "$(lightbulb) Pick RTT for Zephyr/SEGGER RTT firmware", description: "Pick UART for USB CDC or any serial console", _hint: true },
            ] as (vscode.QuickPickItem & { value?: "rtt" | "uart" })[],
            { placeholder: "Select transport", step: 1, totalSteps: 4, title: "Connect Device" },
          );
          if (!pick || (pick as { value?: "rtt" | "uart" }).value === undefined) { telemetry.trackConnectFlowAbandoned("transport"); return; }
          transportValue = (pick as { value: "rtt" | "uart" }).value;
          step = 2;
          break;
        }

        case 2: {
          // Pick parser. The hint clarifies when "Raw" is the right choice
          // (most users don't realize their firmware might log in a custom
          // format that none of our parsers will handle correctly).
          const pick = await showStepQuickPick(
            [
              { label: "$(zap) Zephyr", description: "Zephyr RTOS — LOG_INF, LOG_ERR, LOG_WRN macros", value: "zephyr" as const },
              { label: "$(package) nRF5 SDK", description: "nRF5 SDK — NRF_LOG_INFO, NRF_LOG_ERROR macros", value: "nrf5" as const },
              { label: "$(terminal) Raw", description: "Any firmware — displays output as-is, no parsing", value: "raw" as const },
              { label: "Tip", kind: vscode.QuickPickItemKind.Separator },
              { label: "$(lightbulb) Pick Raw for custom log formats", description: "e.g., printf, MCUboot recovery, vendor-specific formats", _hint: true },
            ] as (vscode.QuickPickItem & { value?: "zephyr" | "nrf5" | "raw" })[],
            { placeholder: "Select log format", step: 2, totalSteps: 4, showBack: true, title: "Connect Device" },
          );
          if (!pick || (pick as { value?: "zephyr" | "nrf5" | "raw" }).value === undefined) { telemetry.trackConnectFlowAbandoned("parser"); return; }
          parserValue = (pick as { value: "zephyr" | "nrf5" | "raw" }).value;
          await saveSetting("parser", parserValue);
          sidebarProvider.updateState({ parser: parserValue });
          step = 3;
          break;
        }

        case 3: {
          // Pick device/port
          if (transportValue === "uart") {
            const result = await pickSerialPort(true, 3, 4);
            if (!result) { telemetry.trackConnectFlowAbandoned("device"); return; }
            port = result;
            step = 4; // go to baud rate
          } else {
            const device = await pickJlinkDevice(true, 3, 4);
            if (!device) { telemetry.trackConnectFlowAbandoned("device"); return; }
            sidebarProvider.updateState({
              transport: "rtt",
              selectedDevice: String(device.serial),
              selectedDeviceLabel: deviceLabel(device),
            });

            // Show J-Link target device picker (auto-detect is default, skip with Enter)
            const probeSerial = String(device.serial);
            const cfg = getConfig();
            const currentOverride = cfg.jlinkDeviceOverrides[probeSerial];
            const targetItems = [
              { label: "$(check) Auto-detect", description: "Works with most boards", _value: "auto" },
              { label: "Cortex-M4", description: "STM32F4, STM32L4, etc.", _value: "Cortex-M4" },
              { label: "Cortex-M7", description: "STM32H7, STM32F7, etc.", _value: "Cortex-M7" },
              { label: "Cortex-M33", description: "nRF54, STM32L5, STM32U5, etc.", _value: "Cortex-M33" },
              { label: "Cortex-M0+", description: "STM32L0, STM32G0, RP2040, etc.", _value: "Cortex-M0+" },
              { label: "Enter chip name...", description: "Type exact J-Link device name", _value: "__custom__" },
            ];
            // Pre-select current override
            for (const item of targetItems) {
              if ((item as any)._value === currentOverride) {
                item.description = (item.description || "") + "  (current)";
              }
            }
            const targetPick = await showStepQuickPick(
              targetItems as (vscode.QuickPickItem & { _value: string })[],
              { placeholder: "Select target device (Enter for auto-detect)", step: 4, totalSteps: 4, showBack: true, title: "Connect Device" },
            );
            if (!targetPick) { telemetry.trackConnectFlowAbandoned("jlinkDevice"); return; }

            let targetDevice = (targetPick as { _value: string })._value;
            if (targetDevice === "__custom__") {
              const input = await vscode.window.showInputBox({
                prompt: "Enter exact J-Link device name (e.g., STM32F401RE, STM32H743II)",
                placeHolder: "STM32F401RE",
                value: currentOverride || "",
              });
              if (!input) { telemetry.trackConnectFlowAbandoned("jlinkDevice"); return; }
              targetDevice = input.trim();
            }

            // Save per-probe override (or clear it for auto)
            const overrides = { ...cfg.jlinkDeviceOverrides };
            if (targetDevice === "auto") {
              delete overrides[probeSerial];
            } else {
              overrides[probeSerial] = targetDevice;
            }
            await saveSetting("jlink.deviceOverrides", overrides);

            await doConnect();
            return;
          }
          break;
        }

        case 4: {
          // Pick baud rate (UART only)
          const baudRate = await pickBaudRate(true, 4, 4);
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

async function pickSerialPort(showBack = false, step?: number, totalSteps?: number): Promise<{ path: string; label: string } | undefined> {
  const qp = vscode.window.createQuickPick<vscode.QuickPickItem & { _path?: string; _label?: string; _rescan?: boolean }>();
  qp.placeholder = "Select serial port...";
  qp.title = "Connect Device";
  qp.busy = true;
  qp.items = [{ label: "Scanning..." }];
  if (showBack) {
    qp.buttons = [vscode.QuickInputButtons.Back];
    qp.step = step ?? 2;
    qp.totalSteps = totalSteps ?? 3;
  }
  qp.show();

  // Gate against rapid Rescan clicks (see notes in pickJlinkDevice).
  let scanning = false;
  const scanPorts = async () => {
    if (scanning) return;
    scanning = true;
    qp.busy = true;
    qp.items = [{ label: "Scanning..." }];
    try {
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
    } finally {
      scanning = false;
    }
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

async function pickJlinkDevice(showBack = false, step?: number, totalSteps?: number): Promise<(DiscoveredDevice & { targetName?: string }) | undefined> {
  const qp = vscode.window.createQuickPick<vscode.QuickPickItem & { _serial?: number; _rescan?: boolean }>();
  qp.placeholder = "Select J-Link device...";
  qp.title = "Connect Device";
  qp.busy = true;
  qp.items = [{ label: "Scanning..." }];
  if (showBack) {
    qp.buttons = [vscode.QuickInputButtons.Back];
    qp.step = step ?? 2;
    qp.totalSteps = totalSteps ?? 2;
  }
  qp.show();

  // Gate against rapid Rescan clicks: while a scan is in flight, ignore
  // subsequent invocations. Without this, double-clicking Rescan can spawn
  // overlapping helper subprocesses and the picker items can be overwritten
  // out of order.
  let scanning = false;
  const scanDevices = async () => {
    if (scanning) return;
    scanning = true;
    qp.busy = true;
    qp.items = [{ label: "Scanning..." }];
    try {
    const { devices, error: discoverErr } = await discoverDevices();
    lastDiscoveredDevices = devices;
    if (devices.length === 0) {
      // Multi-line detail isn't well-supported in QuickPick; pick the most likely
      // user-actionable hint. If discovery returned a specific error (e.g. SEGGER
      // tools missing), show that. Otherwise the silent-empty case is most often
      // caused by another tool holding the probe.
      const emptyItem: vscode.QuickPickItem = discoverErr
        ? { label: "$(warning) No J-Link devices found", detail: discoverErr }
        : {
          label: "$(warning) No J-Link devices found",
          detail: "Probe held by another tool? Close any RTT/VCOM session in nRF Connect, JLink Commander, or RTT Viewer and rescan.",
        };
      qp.items = [emptyItem, { label: "$(refresh) Rescan", _rescan: true }];
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
    } finally {
      scanning = false;
    }
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

async function pickBaudRate(showBack = false, step?: number, totalSteps?: number): Promise<number | undefined> {
  const rates = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600, 1000000];
  const currentRate = sidebarProvider.currentBaudRate;
  const rateItems = rates.map(r => ({
    label: r.toLocaleString(),
    value: r,
    description: r === currentRate ? "(current)" : "",
  }));

  // Discoverability: 95% of firmware uses 8N1, but the 5% who need 7E1 etc.
  // would never find the data/parity/stop settings if we hid them in Change
  // Settings without a hint. A non-selectable separator at the bottom of the
  // baud rate list is loud enough that users see it without obscuring the
  // primary action (selecting a rate). Placeholder text alone was too subtle.
  const items: (vscode.QuickPickItem & { value?: number })[] = [
    ...rateItems,
    { label: "Tip", kind: vscode.QuickPickItemKind.Separator },
    { label: "$(lightbulb) Need 7E1, 8E1, 8N2, etc.?", description: "Set Data Bits, Stop Bits, Parity in Change Settings", _hint: true },
  ];

  if (!showBack) {
    const pick = await vscode.window.showQuickPick(items, { placeHolder: "Select baud rate" });
    if (!pick || (pick as { value?: number }).value === undefined) return undefined;
    return (pick as { value: number }).value;
  }

  const pick = await showStepQuickPick(
    items as (vscode.QuickPickItem & { value: number })[],
    { placeholder: "Select baud rate", step: step ?? 3, totalSteps: totalSteps ?? 3, showBack: true },
  );
  // The advisory item has no value — treat selecting it as "no choice made"
  // and let the wizard re-prompt rather than crashing on undefined.
  if (!pick || (pick as { value?: number }).value === undefined) return undefined;
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

async function pickFromList<T extends string | number>(
  options: { label: string; value: T }[],
  current: T,
  placeholder: string,
): Promise<T | undefined> {
  const items: (vscode.QuickPickItem & { _value: T })[] = options.map(o => ({
    label: o.label,
    description: o.value === current ? "(current)" : "",
    _value: o.value,
  }));
  const pick = await showStepQuickPick(
    items,
    { placeholder, title: "Connection Settings", showBack: true },
  );
  return pick?._value;
}

async function changeDataBits(): Promise<void> {
  const cfg = vscode.workspace.getConfiguration("logscope");
  const current = cfg.get<number>("uart.dataBits", 8);
  const value = await pickFromList<number>(
    [
      { label: "5", value: 5 },
      { label: "6", value: 6 },
      { label: "7", value: 7 },
      { label: "8 — most modern firmware", value: 8 },
    ],
    current,
    "Select UART data bits",
  );
  if (value !== undefined) await saveSetting("uart.dataBits", value);
}

async function changeStopBits(): Promise<void> {
  const cfg = vscode.workspace.getConfiguration("logscope");
  const current = cfg.get<string>("uart.stopBits", "1");
  const value = await pickFromList<string>(
    [
      { label: "1 — most modern firmware", value: "1" },
      { label: "1.5", value: "1.5" },
      { label: "2", value: "2" },
    ],
    current,
    "Select UART stop bits",
  );
  if (value !== undefined) await saveSetting("uart.stopBits", value);
}

async function changeParity(): Promise<void> {
  const cfg = vscode.workspace.getConfiguration("logscope");
  const current = cfg.get<string>("uart.parity", "none");
  const value = await pickFromList<string>(
    [
      { label: "None — most modern firmware", value: "none" },
      { label: "Even", value: "even" },
      { label: "Odd", value: "odd" },
      { label: "Mark", value: "mark" },
      { label: "Space", value: "space" },
    ],
    current,
    "Select UART parity",
  );
  if (value !== undefined) await saveSetting("uart.parity", value);
}

async function changeJlinkDevice(): Promise<void> {
  const probeSerial = sidebarProvider.currentDevice;
  if (!probeSerial) {
    vscode.window.showWarningMessage("LogScope: No J-Link probe connected.");
    return;
  }

  const cfg = getConfig();
  const currentOverride = cfg.jlinkDeviceOverrides[probeSerial] || "";

  const commonDevices = [
    { label: "Auto-detect", description: "Let J-Link identify the target automatically (recommended for Nordic)", _value: "auto" },
    { label: "Cortex-M4", description: "Generic Cortex-M4 (STM32F4, STM32L4, etc.)", _value: "Cortex-M4" },
    { label: "Cortex-M7", description: "Generic Cortex-M7 (STM32H7, STM32F7, etc.)", _value: "Cortex-M7" },
    { label: "Cortex-M33", description: "Generic Cortex-M33 (nRF54, STM32L5, STM32U5, etc.)", _value: "Cortex-M33" },
    { label: "Cortex-M0+", description: "Generic Cortex-M0+ (STM32L0, STM32G0, RP2040, etc.)", _value: "Cortex-M0+" },
    { label: "Enter chip name...", description: "Type the exact J-Link device name (e.g., STM32F401RE)", _value: "__custom__" },
  ];

  // Mark the current selection
  for (const item of commonDevices) {
    if ((item as any)._value === currentOverride || (!currentOverride && (item as any)._value === "auto")) {
      item.description = (item.description || "") + "  (current)";
    }
  }

  const pick = await showStepQuickPick(
    commonDevices as (vscode.QuickPickItem & { _value: string })[],
    {
      placeholder: `J-Link device for probe ${probeSerial}`,
      title: "J-Link Target Device",
    },
  );
  if (!pick) return;

  let deviceName = (pick as { _value: string })._value;

  if (deviceName === "__custom__") {
    const input = await vscode.window.showInputBox({
      prompt: "Enter the exact J-Link device name (e.g., STM32F401RE, STM32H743II, nRF52840_xxAA)",
      placeHolder: "STM32F401RE",
      value: currentOverride || "",
    });
    if (!input) return;
    deviceName = input.trim();
  }

  // Save to the per-probe overrides map
  const overrides = { ...cfg.jlinkDeviceOverrides };
  if (deviceName === "auto") {
    delete overrides[probeSerial];
  } else {
    overrides[probeSerial] = deviceName;
  }
  await saveSetting("jlink.deviceOverrides", overrides);

  log(`J-Link device for probe ${probeSerial} set to "${deviceName}"`);

  // Offer to reconnect so the new setting takes effect
  if (transport?.connected) {
    const answer = await vscode.window.showInformationMessage(
      `J-Link device set to "${deviceName}". Reconnect to apply?`,
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

async function changeParser(currentParser: string): Promise<void> {
  const modes = ["zephyr", "nrf5", "raw"] as const;
  const labels: Record<string, string> = { zephyr: "$(zap) Zephyr", nrf5: "$(package) nRF5 SDK", raw: "$(terminal) Raw" };
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
      const uartCfg = vscode.workspace.getConfiguration("logscope");
      const dataBits = uartCfg.get<number>("uart.dataBits", 8);
      const stopBits = uartCfg.get<string>("uart.stopBits", "1");
      const parity = uartCfg.get<string>("uart.parity", "none");
      items.push(
        { label: "$(dashboard) Baud Rate", description: String(sidebarProvider.currentBaudRate), _key: "baudRate" },
        { label: "$(symbol-numeric) Data Bits", description: String(dataBits), _key: "dataBits" },
        { label: "$(symbol-operator) Stop Bits", description: stopBits, _key: "stopBits" },
        { label: "$(check-all) Parity", description: parity, _key: "parity" },
      );
    }

    if (sidebarProvider.currentTransport === "rtt") {
      const cfg = getConfig();
      const probeSerial = sidebarProvider.currentDevice;
      const override = cfg.jlinkDeviceOverrides[probeSerial];
      const deviceDesc = override || "Auto-detect";
      items.push({ label: "$(chip) J-Link Device", description: deviceDesc, _key: "jlinkDevice" });
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
        case "dataBits":
          await changeDataBits();
          return;
        case "stopBits":
          await changeStopBits();
          return;
        case "parity":
          await changeParity();
          return;
        case "jlinkDevice":
          await changeJlinkDevice();
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
      { label: "Wireshark (.btsnoop)", value: "btsnoop", description: "HCI packets only — needs firmware with bt_monitor enabled (J-Link RTT)" },
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
  const outputChannel = vscode.window.createOutputChannel("LogScope");
  context.subscriptions.push(outputChannel);
  initLogger(outputChannel);
  log(`LogScope ${context.extension.packageJSON.version} activated on ${process.platform} (${process.arch})`);

  panel = new LogScopePanel(context.extensionUri);
  panel.setReadyHandler(() => {
    restorePanelFromSession();
  });
  statusBar = new StatusBar();
  sidebarProvider.version = context.extension.packageJSON.version;

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
      // Live-propagate display settings to an open webview. Previously these
      // only took effect on the next panel show, so editing settings.json
      // mid-session looked like the change "didn't take" until the user
      // toggled the panel visibility.
      if (e.affectsConfiguration("logscope.timeFormat") || e.affectsConfiguration("logscope.logWrap")) {
        const cfg = getConfig();
        panel?.sendInit(cfg.logWrap, cfg.timeFormat);
      }
    }),
  );

  // Initialize telemetry
  telemetry.init(context);
  telemetry.trackActivation(context.extension.packageJSON.version);

  // Initialize license manager (non-blocking, never blocks startup)
  licenseManager = new LicenseManager(context, "logscope");
  licenseManager.initialize();

  // Register license commands
  registerLicenseCommands(context, licenseManager, "logscope");

  // Check for Python on activation (deferred to avoid blocking activation)
  const PYTHON_WARNING_DISMISSED = "logscope.pythonWarningDismissed";
  if (!context.globalState.get<boolean>(PYTHON_WARNING_DISMISSED)) {
    setTimeout(() => {
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
    }, 1000);
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

      case "saveColumnWidths": {
        // Persist the user-modified column widths so they survive panel
        // disposal, window reload, and tab moves to other windows. The
        // webview only sends keys that deviate from the CSS defaults.
        const widths = msg.widths as Record<string, number> | undefined;
        if (widths && typeof widths === "object") {
          await saveSetting("columnWidths", widths);
        }
        break;
      }

      case "clear": {
        ringBuffer?.clear();
        watchMatcher.resetCounters();
        // Clear stale modules from the session — the entries those modules
        // were derived from were just deleted. Without this, the module
        // dropdown in the toolbar keeps showing modules that no longer have
        // matching entries until the user reconnects.
        session?.modules.clear();
        panel?.updateModules([]);
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
    panel?.show(cfg.logWrap, cfg.timeFormat, cfg.columnWidths);
    // If connected, send state to the (possibly fresh) webview
    if (transport?.connected) {
      const currentParser = vscode.workspace.getConfiguration("logscope").get<string>("parser", "zephyr");
      panel?.sendConnected(
        sidebarProvider.connectedTransportLabel,
        sidebarProvider.connectedAddress,
        currentParser,
      );
    }
  });

  const connectCmd = vscode.commands.registerCommand("logscope.connect", async () => {
    await guidedConnect();
  });

  const reconnectCmd = vscode.commands.registerCommand("logscope.reconnect", async () => {
    await doConnect();
  });

  const rescanCmd = vscode.commands.registerCommand("logscope.rescan", async () => {
    await rescanAndConnect();
  });

  const changeJlinkDeviceCmd = vscode.commands.registerCommand("logscope.changeJlinkDevice", async () => {
    await changeJlinkDevice();
  });

  const disconnectCmd = vscode.commands.registerCommand("logscope.disconnect", () => {
    if (!transport?.connected) return;
    userDisconnecting = true;
    disconnectAll();
    panel?.sendDisconnected(false);
    sidebarProvider.updateState({ connected: false, connecting: false });
    userDisconnecting = false;
  });

  const forgetDeviceCmd = vscode.commands.registerCommand("logscope.forgetDevice", async () => {
    // Confirmation modal: users frequently expect "Forget Device" to delete
    // all their settings (parser, baud rate, watch patterns) when in fact it
    // only clears the saved device/port. Spelling that out before action
    // removes the "did I just lose my config?" worry.
    const choice = await vscode.window.showInformationMessage(
      "Forget the saved device?",
      {
        modal: true,
        detail: "Your parser, baud rate, watch patterns, and other settings are kept. Only the saved probe/port is cleared, so you'll see the full Connect wizard next time.",
      },
      "Forget Device",
    );
    if (choice !== "Forget Device") return;

    // Also drop the per-probe J-Link target override for the device being
    // forgotten — without this, reconnecting to the same probe later
    // silently picks up a stale override the user no longer remembers
    // setting, which can cause confusing "wrong target" errors.
    const lastDevice = sidebarProvider.currentDevice;
    if (lastDevice && /^\d+$/.test(lastDevice)) {
      const cfg = vscode.workspace.getConfiguration("logscope");
      const overrides = { ...cfg.get<Record<string, string>>("jlink.deviceOverrides", {}) };
      if (overrides[lastDevice] !== undefined) {
        delete overrides[lastDevice];
        await saveSetting("jlink.deviceOverrides", overrides);
      }
    }

    await saveSetting("lastDevice", "");
    await saveSetting("uart.lastPort", "");
    sidebarProvider.updateState({
      selectedDevice: "",
      selectedDeviceLabel: "",
      hasLastSession: false,
    });
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

  // ── Watch pattern presets ────────────────────────────────
  const WATCH_PRESETS: WatchPatternConfig[] = [
    { name: "Errors", pattern: "failed|error|fault|CRC|timeout", regex: true, color: "#f44336" },
    { name: "Warnings", pattern: "threshold|exceeded|critical|low|drift", regex: true, color: "#cca700" },
    { name: "Retransmission", pattern: "Retransmission", color: "#ff9800" },
    { name: "BLE State", pattern: "Connected|Disconnected|Advertising", regex: true, color: "#4caf50" },
    { name: "Heartbeat", pattern: "Heartbeat", color: "#2196f3" },
  ];

  const addWatchPatternCmd = vscode.commands.registerCommand("logscope.addWatchPattern", async () => {
    // License gate: free users limited to 3 patterns
    const gateCfg = vscode.workspace.getConfiguration("logscope");
    const existingPatterns = gateCfg.get<WatchPatternConfig[]>("watchPatterns", []);
    if (existingPatterns.length >= 3 && !licenseManager.isProFeatureAvailable()) {
      await guardProFeature(licenseManager, "More than 3 watch patterns", "watch-patterns");
      return;
    }

    // Filter out presets that are already added (by name)
    const existingNames = new Set(existingPatterns.map(p => p.name));
    const availablePresets = WATCH_PRESETS.filter(p => !existingNames.has(p.name));

    // Build QuickPick items: presets first, then custom option
    const items: (vscode.QuickPickItem & { _preset?: WatchPatternConfig; _custom?: boolean })[] = [
      ...availablePresets.map(p => ({
        label: `$(star) ${p.name}`,
        description: p.pattern,
        detail: p.regex ? "Regex match" : "Substring match",
        _preset: p,
      })),
    ];

    if (availablePresets.length > 0) {
      items.push({ label: "", kind: vscode.QuickPickItemKind.Separator } as any);
    }
    items.push({
      label: "$(edit) Custom pattern...",
      description: "Define your own pattern",
      _custom: true,
    });

    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: "Select a watch pattern to add",
    });
    if (!pick) return;

    if ((pick as any)._preset) {
      // Add preset directly
      const preset = (pick as any)._preset as WatchPatternConfig;
      const cfg = vscode.workspace.getConfiguration("logscope");
      const existing = cfg.get<WatchPatternConfig[]>("watchPatterns", []);
      await saveSetting("watchPatterns", [...existing, preset]);
      return;
    }

    // Custom pattern flow
    const name = await vscode.window.showInputBox({
      prompt: "Pattern name",
      placeHolder: "e.g., Connection Timeout",
    });
    if (!name) return;

    const pattern = await vscode.window.showInputBox({
      prompt: "Text to match (use | for OR, e.g., 'error|fault|timeout')",
      placeHolder: "e.g., retransmit",
    });
    if (!pattern) return;

    const regexPick = await vscode.window.showQuickPick(
      [
        { label: "Substring match", description: "Matches if the pattern text appears anywhere in the log message" },
        { label: "Regular expression", description: "Use regex syntax (e.g., error|fault for multiple terms)" },
      ],
      { placeHolder: "Match type" },
    );
    if (!regexPick) return;
    const isRegex = regexPick.label.startsWith("Regular");

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
    panel?.show(cfg.logWrap, cfg.timeFormat, cfg.columnWidths);
    panel?.postMessage({ type: "scrollToWatch", patternName });
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
          log(`Auto-connect attempt ${attempt} failed, retrying in ${RETRY_DELAYS[attempt]}ms...`);
          setTimeout(() => attemptAutoConnect(attempt + 1), RETRY_DELAYS[attempt]);
        } else {
          log(`Auto-connect failed after ${MAX_RETRIES + 1} attempts`);
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
    openCmd, connectCmd, reconnectCmd, rescanCmd, disconnectCmd, forgetDeviceCmd, exportCmd,
    changeSettingsCmd, changeJlinkDeviceCmd, openWalkthroughCmd, cycleParserCmd,
    addWatchPatternCmd, removeWatchPatternCmd, scrollToWatchCmd,
  );
}

export function deactivate() {
  telemetry.dispose();
  disconnectAll();
  statusBar?.dispose();
  statusBar = null;
}
