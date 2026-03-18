import * as vscode from "vscode";
import { RttTransport } from "./transport/rtt";
import { JLinkManager } from "./transport/jlink-manager";
import { ZephyrLogParser } from "./parser/zephyr-log";
import { RingBuffer } from "./model/ring-buffer";
import { Session, exportAsText } from "./model/session";
import { DevScopePanel } from "./ui/webview-provider";
import { StatusBar } from "./ui/status-bar";
import type { Transport } from "./transport/types";

// ── Module-level state ──────────────────────────────────────────
let transport: Transport | null = null;
let session: Session | null = null;
let ringBuffer: RingBuffer | null = null;
const parser = new ZephyrLogParser();
let panel: DevScopePanel | null = null;
let statusBar: StatusBar | null = null;
let statusInterval: ReturnType<typeof setInterval> | null = null;
let lineBuffer = "";
const jlinkManager = new JLinkManager();

// ── Helpers ─────────────────────────────────────────────────────

function getConfig() {
  const cfg = vscode.workspace.getConfiguration("devscope");
  return {
    host: cfg.get<string>("rtt.host", "localhost"),
    port: cfg.get<number>("rtt.port", 19021),
    maxEntries: cfg.get<number>("maxEntries", 100_000),
    jlinkPath: cfg.get<string>("jlink.path", ""),
    jlinkDevice: cfg.get<string>("jlink.device", "NRF54L15"),
    jlinkInterface: cfg.get<string>("jlink.interface", "SWD"),
    jlinkSpeed: cfg.get<number>("jlink.speed", 4000),
    jlinkAutoStart: cfg.get<boolean>("jlink.autoStart", true),
  };
}

function handleChunk(chunk: Buffer): void {
  if (!ringBuffer || !session) return;

  // Partial-line buffering: RTT sends arbitrary byte boundaries.
  // Accumulate text, split on newlines, keep the trailing partial.
  lineBuffer += chunk.toString("utf-8");
  const segments = lineBuffer.split("\n");
  lineBuffer = segments.pop() ?? "";

  if (segments.length === 0) return;

  const completeText = segments.join("\n") + "\n";
  const entries = parser.parse(completeText);

  for (const entry of entries) {
    ringBuffer.push(entry);
    session.addEntry(entry);
  }

  // Push to WebView
  if (entries.length > 0 && panel) {
    panel.addEntries(entries);

    // Update modules if new ones appeared
    const modules = Array.from(session.modules);
    panel.updateModules(modules);
  }
}

function startStatusUpdates(): void {
  stopStatusUpdates();
  statusInterval = setInterval(() => {
    const connected = transport?.connected ?? false;
    const count = ringBuffer?.size ?? 0;
    const evicted = ringBuffer?.evictedCount ?? 0;

    panel?.updateStatus(connected, count, evicted);
    statusBar?.update(connected, count, evicted);
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
  jlinkManager.stop();
  statusBar?.update(false, ringBuffer?.size ?? 0, ringBuffer?.evictedCount ?? 0);
  panel?.updateStatus(false, ringBuffer?.size ?? 0, ringBuffer?.evictedCount ?? 0);
}

// ── Activation ──────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext) {
  // Create UI components
  panel = new DevScopePanel(context.extensionUri);
  statusBar = new StatusBar();

  // Handle messages from WebView
  panel.setMessageHandler((msg) => {
    if (msg.type === "clear") {
      ringBuffer?.clear();
      panel?.clear();
    }
  });

  // ── Connect ───────────────────────────────────────────────────
  const connectCmd = vscode.commands.registerCommand("devscope.connect", async () => {
    if (transport?.connected) {
      vscode.window.showInformationMessage("DevScope: Already connected.");
      return;
    }

    const cfg = getConfig();
    ringBuffer = new RingBuffer(cfg.maxEntries);
    session = new Session("device", "rtt");
    lineBuffer = "";

    // Auto-start J-Link if enabled
    let jlinkStarted = false;
    if (cfg.jlinkAutoStart) {
      const result = await jlinkManager.start({
        jlinkPath: cfg.jlinkPath,
        device: cfg.jlinkDevice,
        iface: cfg.jlinkInterface,
        speed: cfg.jlinkSpeed,
        rttPort: cfg.port,
      });

      if (result.started) {
        jlinkStarted = true;
      } else if (!result.jlinkPath) {
        // J-Link not found — fall back to manual mode
        vscode.window.showWarningMessage(
          "DevScope: J-Link not found — connecting to existing RTT server. " +
            "Install J-Link tools or set devscope.jlink.path for auto-start."
        );
      } else {
        // J-Link found but failed to start
        vscode.window.showWarningMessage(
          `DevScope: ${result.error} Falling back to direct connection.`
        );
      }
    }

    // Connect TCP transport to RTT telnet server
    const rtt = new RttTransport(cfg.host, cfg.port);
    transport = rtt;

    rtt.on("data", (chunk: Buffer) => handleChunk(chunk));

    rtt.on("disconnected", () => {
      vscode.window.showWarningMessage("DevScope: RTT connection lost. Reconnect when ready.");
      statusBar?.update(false, ringBuffer?.size ?? 0, ringBuffer?.evictedCount ?? 0);
      panel?.updateStatus(false, ringBuffer?.size ?? 0, ringBuffer?.evictedCount ?? 0);
    });

    rtt.on("error", (err: Error) => {
      vscode.window.showErrorMessage(
        `DevScope: Connection error — ${err.message}. Is J-Link running?`
      );
    });

    try {
      await rtt.connect();
      startStatusUpdates();
      const source = jlinkStarted ? " (J-Link auto-started)" : "";
      vscode.window.showInformationMessage(
        `DevScope: Connected to RTT at ${cfg.host}:${cfg.port}${source}`
      );
    } catch {
      const hint = cfg.jlinkAutoStart
        ? "Check that your device is connected and powered on."
        : "Make sure J-Link is connected and the RTT telnet server is running.";
      vscode.window.showErrorMessage(
        `DevScope: Could not connect to ${cfg.host}:${cfg.port}. ${hint}`
      );
      jlinkManager.stop();
      transport = null;
    }
  });

  // ── Disconnect ────────────────────────────────────────────────
  const disconnectCmd = vscode.commands.registerCommand("devscope.disconnect", () => {
    if (!transport?.connected) {
      vscode.window.showInformationMessage("DevScope: Not connected.");
      return;
    }
    disconnectAll();
    vscode.window.showInformationMessage("DevScope: Disconnected.");
  });

  // ── Open Panel ────────────────────────────────────────────────
  const openPanelCmd = vscode.commands.registerCommand("devscope.openPanel", () => {
    panel?.show();
  });

  // ── Export ────────────────────────────────────────────────────
  const exportCmd = vscode.commands.registerCommand("devscope.export", async () => {
    if (!ringBuffer || ringBuffer.size === 0) {
      vscode.window.showWarningMessage("DevScope: Nothing to export — no log entries captured yet.");
      return;
    }

    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file("devscope-export.log"),
      filters: { "Log files": ["log", "txt"], "All files": ["*"] },
    });

    if (!uri) return;

    const text = exportAsText(ringBuffer.getAll());
    await vscode.workspace.fs.writeFile(uri, Buffer.from(text, "utf-8"));
    vscode.window.showInformationMessage(`DevScope: Exported ${ringBuffer.size} entries to ${uri.fsPath}`);
  });

  context.subscriptions.push(connectCmd, disconnectCmd, openPanelCmd, exportCmd);
}

export function deactivate() {
  disconnectAll();
  statusBar?.dispose();
  statusBar = null;
}
