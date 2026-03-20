import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import type { LogEntry } from "../parser/types";

/** JSON-safe entry sent to the WebView */
interface SerializedEntry {
  timestamp: number;
  severity: string;
  module: string;
  message: string;
  source: string;
  raw?: number[];
  decoded?: unknown;
}

/** Callback when the WebView sends a message back */
export type WebViewMessageHandler = (msg: { type: string; [key: string]: unknown }) => void;

export class LogScopePanel {
  private panel: vscode.WebviewPanel | null = null;
  private readonly extensionUri: vscode.Uri;
  private onMessage: WebViewMessageHandler | null = null;

  // Batching: accumulate entries and flush at ~60 fps
  private pendingEntries: SerializedEntry[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly FLUSH_INTERVAL_MS = 16;

  constructor(extensionUri: vscode.Uri) {
    this.extensionUri = extensionUri;
  }

  /** Register a handler for messages coming FROM the WebView */
  setMessageHandler(handler: WebViewMessageHandler): void {
    this.onMessage = handler;
  }

  /** Show or reveal the panel. Always opens in viewer mode. */
  show(wrapEnabled = false): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Two);
      this.sendInit(wrapEnabled);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "logscope.logViewer",
      "LogScope",
      vscode.ViewColumn.Two,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionUri, "out", "webview"),
          vscode.Uri.joinPath(this.extensionUri, "assets"),
        ],
      }
    );

    this.panel.webview.html = this.getHtml(this.panel.webview);

    this.panel.webview.onDidReceiveMessage((msg) => {
      if (this.onMessage) {
        this.onMessage(msg);
      }
    });

    this.panel.onDidDispose(() => {
      this.panel = null;
      if (this.flushTimer) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }
    });

    // Send init after a short delay to ensure the WebView script has loaded
    setTimeout(() => this.sendInit(wrapEnabled), 100);
  }

  /** Queue entries for batched delivery to the WebView */
  addEntries(entries: LogEntry[]): void {
    for (const e of entries) {
      const serialized: SerializedEntry = {
        timestamp: e.timestamp,
        severity: e.severity,
        module: e.module,
        message: e.message,
        source: e.source,
      };
      if (e.source === "hci") {
        if (e.raw) serialized.raw = Array.from(e.raw);
        if (e.metadata?.decoded) serialized.decoded = e.metadata.decoded;
      }
      this.pendingEntries.push(serialized);
    }

    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flushEntries(), LogScopePanel.FLUSH_INTERVAL_MS);
    }
  }

  private flushEntries(): void {
    this.flushTimer = null;
    if (this.pendingEntries.length === 0 || !this.panel) return;

    this.panel.webview.postMessage({
      type: "entries",
      entries: this.pendingEntries,
    });
    this.pendingEntries = [];
  }

  /** Send current status to the WebView */
  updateStatus(connected: boolean, entryCount: number, evictedCount: number): void {
    this.panel?.webview.postMessage({
      type: "status",
      connected,
      entryCount,
      evictedCount,
    });
  }

  /** Send updated module list to the WebView */
  updateModules(modules: string[]): void {
    this.panel?.webview.postMessage({
      type: "modules",
      modules,
    });
  }

  /** Tell the WebView to clear its timeline */
  clear(): void {
    this.pendingEntries = [];
    this.panel?.webview.postMessage({ type: "clear" });
  }

  get visible(): boolean {
    return this.panel?.visible ?? false;
  }

  // ── Connection state messages ─────────────────────────────────

  /** Bootstrap the WebView with wrap setting */
  sendInit(wrapEnabled: boolean): void {
    this.panel?.webview.postMessage({ type: "init", wrapEnabled });
  }

  /** Notify WebView that connection attempt started */
  sendConnecting(): void {
    this.panel?.webview.postMessage({ type: "connecting" });
  }

  /** Notify WebView that connection succeeded */
  sendConnected(transport: string, address: string): void {
    this.panel?.webview.postMessage({ type: "connected", transport, address });
  }

  /** Notify WebView of disconnection (user-initiated or unexpected) */
  sendDisconnected(unexpected: boolean): void {
    this.panel?.webview.postMessage({ type: "disconnected", unexpected });
  }

  /** Notify WebView that connection attempt failed */
  sendConnectError(message: string): void {
    this.panel?.webview.postMessage({ type: "connectError", message });
  }

  /** Notify WebView that a board reset was detected */
  sendReset(): void {
    this.panel?.webview.postMessage({ type: "reset" });
  }

  // ── HTML generation ───────────────────────────────────────────

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();

    const stylesUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "out", "webview", "styles.css")
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "out", "webview", "main.js")
    );

    const templatePath = path.join(
      this.extensionUri.fsPath,
      "out",
      "webview",
      "index.html"
    );
    let html = fs.readFileSync(templatePath, "utf-8");

    html = html
      .replaceAll("{{nonce}}", nonce)
      .replaceAll("{{cspSource}}", webview.cspSource)
      .replaceAll("{{stylesUri}}", stylesUri.toString())
      .replaceAll("{{scriptUri}}", scriptUri.toString());

    return html;
  }
}

function getNonce(): string {
  const crypto = require("crypto") as typeof import("crypto");
  return crypto.randomBytes(16).toString("hex");
}
