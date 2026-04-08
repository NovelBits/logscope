import * as vscode from "vscode";

let channel: vscode.OutputChannel | null = null;

export function initLogger(outputChannel: vscode.OutputChannel): void {
  channel = outputChannel;
}

function timestamp(): string {
  return new Date().toISOString().slice(11, 23);
}

export function log(message: string): void {
  const line = `[${timestamp()}] ${message}`;
  channel?.appendLine(line);
  console.log(`[LogScope] ${message}`);
}

export function logError(message: string, err?: unknown): void {
  const detail = err instanceof Error ? err.message : err ? String(err) : "";
  const line = `[${timestamp()}] ERROR: ${message}${detail ? " — " + detail : ""}`;
  channel?.appendLine(line);
  console.error(`[LogScope] ${message}`, err);
}

/** Log a line that came from an external process (e.g. nrfutil, rtt-helper) */
export function logFromHelper(source: string, line: string): void {
  const formatted = `[${timestamp()}] [${source}] ${line}`;
  channel?.appendLine(formatted);
  console.log(`[LogScope ${source}] ${line}`);
}
