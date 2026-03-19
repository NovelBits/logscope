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
import type { Transport, ConnectConfig } from "./transport/types";

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

function getInitConfig() {
  const cfg = vscode.workspace.getConfiguration("logscope");
  return {
    device: "auto",
    autoConnect: cfg.get<boolean>("autoConnect", false),
    lastDevice: cfg.get<string>("lastDevice", ""),
  };
}


let bootDetected = false; // Track if we've seen at least one boot

function handleChunk(chunk: Buffer): void {
  if (!ringBuffer || !session) return;

  lineBuffer += chunk.toString("utf-8");
  const segments = lineBuffer.split("\n");
  lineBuffer = segments.pop() ?? "";

  if (segments.length === 0) return;

  // Detect board reset via boot banner
  const completeText = segments.join("\n") + "\n";
  if (completeText.includes("*** Booting")) {
    if (bootDetected) {
      // This is a reboot, not the first boot
      panel?.sendReset();
    }
    bootDetected = true;
  }

  const entries = parser.parse(completeText);

  for (const entry of entries) {
    ringBuffer.push(entry);
    session.addEntry(entry);
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
      sidebarProvider.updateState({ connected: false });
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
    sidebarProvider.updateState({ entryCount: count });
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

// ── Activation ──────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext) {
  // Create UI components
  panel = new LogScopePanel(context.extensionUri);
  statusBar = new StatusBar();

  // Register sidebar TreeView
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("logscope.sidebar", sidebarProvider)
  );

  // Auto-open the panel on activation so the welcome screen is visible
  const cfg = getConfig();
  panel.show(getInitConfig(), cfg.logWrap);

  // Scan for devices and send to webview
  async function scanAndSendDevices() {
    const devices = await discoverDevices();
    lastDiscoveredDevices = devices;
    panel?.sendDevices(devices);
    return devices;
  }

  // Initial scan + auto-connect if enabled
  const devCfg = vscode.workspace.getConfiguration("logscope");
  const autoConnect = devCfg.get<boolean>("autoConnect", false);
  const lastSerial = devCfg.get<string>("lastDevice", "");

  if (autoConnect && lastSerial) {
    // Fast path: skip discovery, connect immediately, scan in background
    const attemptAutoConnect = async (attempt: number) => {
      const MAX_RETRIES = 2;
      const RETRY_DELAYS = [500, 2000];
      try {
        panel?.sendConnecting();
        sidebarProvider.updateState({ connecting: true });
        const pollInterval = getConfig().rttPollInterval;
        await connectRtt("auto", pollInterval);
        const rttTransport = transport as NrfutilRttTransport;
        const displayName = rttTransport.detectedDevice || "Connected";
        panel?.sendConnected("J-Link RTT", displayName);
        sidebarProvider.updateState({
          connected: true, connecting: false,
          transport: "J-Link RTT", address: displayName,
        });
      } catch (err) {
        if (attempt < MAX_RETRIES) {
          console.log(`[LogScope] Auto-connect attempt ${attempt} failed, retrying in ${RETRY_DELAYS[attempt]}ms...`);
          setTimeout(() => attemptAutoConnect(attempt + 1), RETRY_DELAYS[attempt]);
        } else {
          const message = err instanceof Error ? err.message : String(err);
          panel?.sendConnectError(message);
          sidebarProvider.updateState({ connecting: false });
        }
      }
    };
    // Connect immediately, no delay
    attemptAutoConnect(0);
    // Scan for devices in background (for the dropdown if user disconnects)
    scanAndSendDevices();
  } else {
    // No auto-connect: just scan for devices
    setTimeout(() => scanAndSendDevices(), 300);
  }

  // Handle messages from WebView
  panel.setMessageHandler(async (msg) => {
    switch (msg.type) {
      case "connect":
      case "reconnect": {
        const config = msg.config as ConnectConfig;

        if (transport?.connected) return;

        panel?.sendConnecting();
        sidebarProvider.updateState({ connecting: true });

        try {
          if (config.transport === "uart") {
            const baudRate = config.baudRate ?? 115200;
            await connectUart(config.device, baudRate);
            const devCfg = vscode.workspace.getConfiguration("logscope");
            await devCfg.update("uart.lastPort", config.device, vscode.ConfigurationTarget.Workspace);
            await devCfg.update("transport", "uart", vscode.ConfigurationTarget.Workspace);
            panel?.sendConnected("Serial UART", config.device);
            sidebarProvider.updateState({
              connected: true, connecting: false,
              transport: "Serial UART", address: config.device,
            });
          } else {
            // RTT transport (default)
            const serial = config.device;
            const discovered = lastDiscoveredDevices.find(d => String(d.serial) === serial);
            const device = "auto";
            const pollInterval = getConfig().rttPollInterval;
            await connectRtt(device, pollInterval);
            const rttTransport = transport as NrfutilRttTransport;
            const displayName = rttTransport.detectedDevice || "Connected";
            const devCfg = vscode.workspace.getConfiguration("logscope");
            await devCfg.update("lastDevice", serial, vscode.ConfigurationTarget.Workspace);
            await devCfg.update("transport", "rtt", vscode.ConfigurationTarget.Workspace);
            panel?.sendConnected("J-Link RTT", displayName);
            sidebarProvider.updateState({
              connected: true, connecting: false,
              transport: "J-Link RTT", address: displayName,
            });
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          panel?.sendConnectError(message);
          sidebarProvider.updateState({ connecting: false });
          disconnectAll();
        }
        break;
      }

      case "refreshDevices": {
        const devices = await discoverDevices();
        lastDiscoveredDevices = devices;
        panel?.sendDevices(devices);
        break;
      }

      case "refreshPorts": {
        const ports = await discoverSerialPorts();
        panel?.sendSerialPorts(ports);
        break;
      }

      case "disconnect": {
        userDisconnecting = true;
        disconnectAll();
        panel?.sendDisconnected(false);
        sidebarProvider.updateState({ connected: false });
        // Delay reset so async transport close events see userDisconnecting=true
        setTimeout(() => { userDisconnecting = false; }, 100);
        break;
      }

      case "export": {
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
          // Export HCI packets as btsnoop for Wireshark
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
          vscode.window.showInformationMessage(
            `LogScope: Exported ${hciCount} HCI packets to ${uri.fsPath} — open with Wireshark`
          );
        } else {
          const ext = formatValue === "jsonl" ? "jsonl" : "log";
          const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(`logscope-${new Date().toISOString().slice(0,19).replaceAll(/[T:]/g, "-")}.${ext}`),
            filters: { "Log files": [ext] },
          });
          if (!uri) return;

          const content = formatValue === "jsonl"
            ? exportAsJsonLines(entries)
            : exportAsText(entries);
          await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf-8"));
          vscode.window.showInformationMessage(
            `LogScope: Exported ${entries.length} entries to ${uri.fsPath}`
          );
        }
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

  // ── Commands ────────────────────────────────────────────────

  const openCmd = vscode.commands.registerCommand("logscope.open", () => {
    const cfg = getConfig();
    panel?.show(getInitConfig(), cfg.logWrap);
  });

  const connectCmd = vscode.commands.registerCommand("logscope.connect", () => {
    // Open the panel — user connects via the form
    const cfg = getConfig();
    panel?.show(getInitConfig(), cfg.logWrap);
  });

  const disconnectCmd = vscode.commands.registerCommand("logscope.disconnect", () => {
    if (!transport?.connected) return;
    userDisconnecting = true;
    disconnectAll();
    panel?.sendDisconnected(false);
    sidebarProvider.updateState({ connected: false });
    // Delay reset so async transport close events see userDisconnecting=true
    setTimeout(() => { userDisconnecting = false; }, 100);
  });

  const exportCmd = vscode.commands.registerCommand("logscope.export", () => {
    // Trigger export via the message handler
    if (panel) {
      panel.setMessageHandler(panel["onMessage"] as never); // keep existing handler
      // Simulate the export message
    }
    // Direct export from command palette
    if (!ringBuffer || ringBuffer.size === 0) {
      vscode.window.showWarningMessage("LogScope: Nothing to export.");
      return;
    }
    vscode.window.showQuickPick(
      [
        { label: "Text (.log)", value: "text", description: "All log entries as plain text" },
        { label: "JSON Lines (.jsonl)", value: "jsonl", description: "All log entries as JSON" },
        { label: "Wireshark (.btsnoop)", value: "btsnoop", description: "HCI packets only — opens in Wireshark" },
      ],
      { placeHolder: "Select export format" }
    ).then(async (format) => {
      if (!format || !ringBuffer) return;
      const formatValue = (format as { label: string; value: string }).value;
      const entries = ringBuffer.getAll();
      if (formatValue === "btsnoop") {
        const hciCount = entries.filter(e => e.source === "hci" && e.raw && e.metadata?.opcode).length;
        if (hciCount === 0) {
          vscode.window.showWarningMessage("LogScope: No HCI packets to export.");
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
    });
  });

  context.subscriptions.push(openCmd, connectCmd, disconnectCmd, exportCmd);
}

export function deactivate() {
  disconnectAll();
  statusBar?.dispose();
  statusBar = null;
}
