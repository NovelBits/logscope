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
}

/** Callback when the WebView sends a message back */
export type WebViewMessageHandler = (msg: { type: string; [key: string]: unknown }) => void;

export class DevScopePanel {
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

  /** Show or reveal the panel */
  show(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Two);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "devscope.logViewer",
      "Devscope",
      vscode.ViewColumn.Two,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionUri, "out", "webview"),
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
  }

  /** Queue entries for batched delivery to the WebView */
  addEntries(entries: LogEntry[]): void {
    for (const e of entries) {
      this.pendingEntries.push({
        timestamp: e.timestamp,
        severity: e.severity,
        module: e.module,
        message: e.message,
        source: e.source,
      });
    }

    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flushEntries(), DevScopePanel.FLUSH_INTERVAL_MS);
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
      .replace(/\{\{nonce\}\}/g, nonce)
      .replace(/\{\{cspSource\}\}/g, webview.cspSource)
      .replace(/\{\{stylesUri\}\}/g, stylesUri.toString())
      .replace(/\{\{scriptUri\}\}/g, scriptUri.toString());

    return html;
  }
}

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}
