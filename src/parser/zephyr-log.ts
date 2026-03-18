import type { LogEntry, Parser, Severity } from "./types";

// Matches: [HH:MM:SS.mmm,uuu] <level> module: message
const ZEPHYR_LOG_RE =
  /^\[(\d{2}):(\d{2}):(\d{2})\.(\d{3}),(\d{3})\]\s+<(err|wrn|inf|dbg)>\s+([\w.]+):\s?(.*)/;

export class ZephyrLogParser implements Parser {
  parse(data: string | Uint8Array): LogEntry[] {
    const text = typeof data === "string" ? data : new TextDecoder().decode(data);
    const lines = text.split("\n");
    const entries: LogEntry[] = [];

    for (const line of lines) {
      const trimmed = line.trimEnd();
      if (!trimmed) continue;

      const match = trimmed.match(ZEPHYR_LOG_RE);
      if (!match) continue;

      const [, hours, minutes, seconds, millis, micros, severity, module, message] = match;

      const timestamp =
        parseInt(hours) * 3_600_000_000 +
        parseInt(minutes) * 60_000_000 +
        parseInt(seconds) * 1_000_000 +
        parseInt(millis) * 1_000 +
        parseInt(micros);

      entries.push({
        timestamp,
        source: "log",
        severity: severity as Severity,
        module,
        message: message ?? "",
        metadata: {},
      });
    }

    return entries;
  }
}
