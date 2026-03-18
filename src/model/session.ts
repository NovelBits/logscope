import type { LogEntry } from "../parser/types";

export class Session {
  readonly id: string;
  readonly startTime: Date;
  readonly deviceName: string;
  readonly transport: "rtt" | "uart" | "swo";
  readonly modules = new Set<string>();
  private entryCount = 0;

  constructor(deviceName: string, transport: "rtt" | "uart" | "swo") {
    this.id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.startTime = new Date();
    this.deviceName = deviceName;
    this.transport = transport;
  }

  addEntry(entry: LogEntry): void {
    this.modules.add(entry.module);
    this.entryCount++;
  }

  get count(): number {
    return this.entryCount;
  }
}

export function serializeSession(entries: LogEntry[]): string {
  return entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

export function deserializeSession(ndjson: string): LogEntry[] {
  return ndjson
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as LogEntry);
}

function formatTimestamp(us: number): string {
  const totalSeconds = Math.floor(us / 1_000_000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const remainingUs = us % 1_000_000;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(remainingUs).padStart(6, "0")}`;
}

export function exportAsText(entries: LogEntry[]): string {
  return entries
    .map((e) => {
      const ts = formatTimestamp(e.timestamp);
      const level = e.severity.toUpperCase();
      return `[${ts}] [${level}] [${e.module}] ${e.message}`;
    })
    .join("\n");
}
