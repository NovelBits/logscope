// src/telemetry.ts

import { TelemetryReporter } from "@vscode/extension-telemetry";
import * as vscode from "vscode";
import { log, logError } from "./logger";

const CONNECTION_STRING =
  "InstrumentationKey=5a47be12-de3a-4301-ba9a-82fcbdc2d4b5;IngestionEndpoint=https://eastus-8.in.applicationinsights.azure.com/;LiveEndpoint=https://eastus.livediagnostics.monitor.azure.com/;ApplicationId=a9761017-50c1-414c-8d63-e74901ae9204";

export class TelemetryService {
  private reporter: TelemetryReporter | undefined;
  private installId: string = "";
  private sessionStartTime: number = 0;
  private activationTime: number = 0;
  private warnedOnSendFailure: boolean = false;

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

    try {
      this.reporter = new TelemetryReporter(CONNECTION_STRING);
      context.subscriptions.push(this.reporter);
      log("Telemetry reporter initialized");
    } catch (err) {
      logError("Telemetry reporter failed to initialize (telemetry disabled this session)", err);
      this.reporter = undefined;
    }
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
   *
   * `reason` disambiguates the two very different outcomes that both surface as
   * abandonment at step "device": the user changed their mind with a populated
   * list, versus the list was empty because discovery failed. Without it,
   * "device" was by far the most-abandoned step and told us nothing about why.
   *
   * Like trackConnectFailed, this takes a classified error CODE only, never a
   * raw message (those can contain filesystem paths).
   */
  trackConnectFlowAbandoned(step: string, reason?: string): void {
    this.send("connect_flow_abandoned", reason ? { step, reason } : { step });
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
    } catch (err) {
      // Only catches synchronous errors here. Silent HTTP failures inside the
      // @vscode/extension-telemetry package don't reach this catch — the
      // upstream daily GitHub Action (.github/workflows/telemetry-health.yml)
      // is the canonical detector for ingestion-side outages.
      if (!this.warnedOnSendFailure) {
        this.warnedOnSendFailure = true;
        logError(`Telemetry send failed for event '${eventName}' (will not warn again this session)`, err);
      }
    }
  }
}

// Module-level singleton (matches LogScope's module-level state pattern)
export const telemetry = new TelemetryService();
