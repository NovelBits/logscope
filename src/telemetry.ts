// src/telemetry.ts

import { TelemetryReporter } from "@vscode/extension-telemetry";
import * as vscode from "vscode";

const CONNECTION_STRING =
  "InstrumentationKey=c75e4caf-ea88-4564-b348-93d44f623849;IngestionEndpoint=https://eastus-8.in.applicationinsights.azure.com/;LiveEndpoint=https://eastus.livediagnostics.monitor.azure.com/;ApplicationId=38b06cd0-bdf6-46ea-a405-46e82f454745";

export class TelemetryService {
  private reporter: TelemetryReporter | undefined;
  private installId: string = "";
  private sessionStartTime: number = 0;
  private activationTime: number = 0;

  /**
   * Initialize telemetry. Call once in activate().
   * Generates or retrieves anonymous install ID from globalState.
   */
  init(context: vscode.ExtensionContext): void {
    // Generate or retrieve anonymous install ID
    let id = context.globalState.get<string>("logscope.installId");
    if (!id) {
      id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      context.globalState.update("logscope.installId", id);
    }
    this.installId = id;

    // Store first install date for cohort analysis
    if (!context.globalState.get<number>("logscope.installDate")) {
      context.globalState.update("logscope.installDate", Date.now());
    }

    this.reporter = new TelemetryReporter(CONNECTION_STRING);
    context.subscriptions.push(this.reporter);
    this.activationTime = Date.now();
  }

  /**
   * Track extension activation (used for DAU/MAU).
   * Called once per VS Code session when the extension activates.
   */
  trackActivation(extensionVersion: string): void {
    this.send("activation", {
      extensionVersion,
      platform: process.platform,
      arch: process.arch,
      vscodeVersion: vscode.version,
    });
  }

  /**
   * Track a device connection session starting.
   * Called from doConnect() on successful connection.
   */
  trackSessionStart(transport: "rtt" | "uart", parserMode: string): void {
    this.sessionStartTime = Date.now();
    this.send("session_start", {
      transport,
      parserMode,
    });
  }

  /**
   * Track a session ending (disconnect).
   * Called from disconnectAll().
   */
  trackSessionEnd(stats: {
    transport: string;
    parserMode: string;
    entryCount: number;
    hciPacketCount: number;
    errorCount: number;
    evictedCount: number;
  }): void {
    const durationMs = this.sessionStartTime
      ? Date.now() - this.sessionStartTime
      : 0;
    this.send(
      "session_end",
      {
        transport: stats.transport,
        parserMode: stats.parserMode,
      },
      {
        durationMs,
        entryCount: stats.entryCount,
        hciPacketCount: stats.hciPacketCount,
        errorCount: stats.errorCount,
        evictedCount: stats.evictedCount,
      }
    );
    this.sessionStartTime = 0;
  }

  /**
   * Track a connection failure.
   * Called from doConnect() catch block.
   * Uses error.code only (never raw messages, which may contain paths).
   */
  trackConnectFailed(errorCode: string, transport: string): void {
    this.send("connect_failed", {
      errorCode,
      transport,
    });
  }

  /**
   * Track user abandoning the guided connect flow.
   * Called when guidedConnect() QuickPick is dismissed.
   */
  trackConnectFlowAbandoned(step: string): void {
    this.send("connect_flow_abandoned", { step });
  }

  /**
   * Track a successful export.
   * Called from doExport() after file is saved.
   */
  trackExport(format: "text" | "jsonl" | "btsnoop", entryCount: number): void {
    this.send("export", { format }, { entryCount });
  }

  /**
   * Track parser mode change.
   * Called from changeParser().
   */
  trackParserChange(from: string, to: string): void {
    this.send("parser_change", { from, to });
  }

  /**
   * Track a command execution.
   * Called for any command that isn't already tracked by a specific method.
   */
  trackCommand(commandId: string): void {
    this.send("command", { commandId });
  }

  /**
   * Dispose the reporter. Call in deactivate().
   */
  dispose(): void {
    // Reporter is disposed via context.subscriptions, but explicit call is fine too
    this.reporter = undefined;
  }

  // ── Private ──

  private send(
    eventName: string,
    properties?: Record<string, string>,
    measurements?: Record<string, number>
  ): void {
    try {
      this.reporter?.sendTelemetryEvent(
        eventName,
        { installId: this.installId, ...properties },
        measurements
      );
    } catch {
      // Telemetry must never crash the extension
    }
  }
}

// Module-level singleton (matches LogScope's module-level state pattern)
export const telemetry = new TelemetryService();
