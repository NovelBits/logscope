import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import type { LogEntry } from "../parser/types";
import type { LogScopeError } from "../errors";

/** JSON-safe entry sent to the WebView */
interface SerializedEntry {
  timestamp: number;
  receivedAt?: number;
  severity: string;
  module: string;
  message: string;
  source: string;
  raw?: number[];
  decoded?: unknown;
  watchHits?: { name: string; color: string }[];
}

/** Callback when the WebView sends a message back */
export type WebViewMessageHandler = (msg: { type: string; [key: string]: unknown }) => void;
export type WebViewReadyHandler = () => void;

export class LogScopePanel {
  private panel: vscode.WebviewPanel | null = null;
  private readonly extensionUri: vscode.Uri;
  private onMessage: WebViewMessageHandler | null = null;
  private onReady: WebViewReadyHandler | null = null;

  // Batching: accumulate entries and flush at ~60 fps
  private pendingEntries: SerializedEntry[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly FLUSH_INTERVAL_MS = 16;

  // Ready-state queuing: messages sent before the webview posts "ready" are buffered
  private webviewReady = false;
  private messageQueue: unknown[] = [];

  constructor(extensionUri: vscode.Uri) {
    this.extensionUri = extensionUri;
  }

  /** Register a handler for messages coming FROM the WebView */
  setMessageHandler(handler: WebViewMessageHandler): void {
    this.onMessage = handler;
  }

  /** Register a handler for when the WebView reports it is ready */
  setReadyHandler(handler: WebViewReadyHandler): void {
    this.onReady = handler;
  }

  /** Show or reveal the panel. Always opens in viewer mode. */
  show(wrapEnabled = false, timeFormat = "24h"): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Two);
      this.sendInit(wrapEnabled, timeFormat);
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
      if (msg.type === "ready") {
        this.webviewReady = true;
        for (const queued of this.messageQueue) {
          this.panel?.webview.postMessage(queued);
        }
        this.messageQueue = [];
        this.onReady?.();
        return;
      }
      if (this.onMessage) {
        this.onMessage(msg);
      }
    });

    this.panel.onDidDispose(() => {
      this.panel = null;
      this.webviewReady = false;
      this.messageQueue = [];
      if (this.flushTimer) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }
    });

    // Queue init message; it will be delivered once the webview posts "ready"
    this.sendInit(wrapEnabled, timeFormat);
  }

  /** Queue entries for batched delivery to the WebView */
  addEntries(entries: LogEntry[]): void {
    for (const e of entries) {
      const serialized: SerializedEntry = {
        timestamp: e.timestamp,
        receivedAt: e.receivedAt,
        severity: e.severity,
        module: e.module,
        message: e.message,
        source: e.source,
      };
      if (e.source === "hci") {
        if (e.raw) serialized.raw = Array.from(e.raw);
        if (e.metadata?.decoded) serialized.decoded = e.metadata.decoded;
      }
      if (e.metadata?.watchHits) {
        serialized.watchHits = e.metadata.watchHits as { name: string; color: string }[];
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

    if (!this.webviewReady) {
      // Webview not ready yet; reschedule so entries aren't lost
      this.flushTimer = setTimeout(() => this.flushEntries(), LogScopePanel.FLUSH_INTERVAL_MS);
      return;
    }

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

  postMessage(message: unknown): void {
    this.panel?.webview.postMessage(message);
  }

  get visible(): boolean {
    return this.panel?.visible ?? false;
  }

  // ── Queued messaging ──────────────────────────────────────────

  /** Post a message to the webview, queuing it if the webview is not ready yet */
  private postMessageQueued(message: unknown): void {
    if (!this.panel) return;
    if (this.webviewReady) {
      this.panel.webview.postMessage(message);
    } else {
      this.messageQueue.push(message);
    }
  }

  // ── Connection state messages ─────────────────────────────────

  /** Bootstrap the WebView with wrap setting */
  sendInit(wrapEnabled: boolean, timeFormat = "24h"): void {
    this.postMessageQueued({ type: "init", wrapEnabled, timeFormat });
  }

  /** Notify WebView that connection attempt started */
  sendConnecting(): void {
    this.postMessageQueued({ type: "connecting" });
  }

  /** Notify WebView that connection succeeded */
  sendConnected(transport: string, address: string, parserMode = "zephyr"): void {
    this.postMessageQueued({ type: "connected", transport, address, parserMode });
  }

  /** Notify WebView of disconnection (user-initiated or unexpected) */
  sendDisconnected(unexpected: boolean): void {
    this.postMessageQueued({ type: "disconnected", unexpected });
  }

  /** Notify WebView that connection attempt failed */
  sendConnectError(error: LogScopeError): void {
    this.postMessageQueued({
      type: "connectError",
      code: error.code,
      headline: error.headline,
      detail: error.detail,
      actions: error.actions,
      severity: error.severity,
    });
  }

  /** Notify WebView that a board reset was detected */
  sendReset(): void {
    this.postMessageQueued({ type: "reset" });
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
  const crypto = require("node:crypto") as typeof import("node:crypto");
  return crypto.randomBytes(16).toString("hex");
}
