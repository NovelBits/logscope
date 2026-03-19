import type { LogEntry, Parser, Severity } from "./types";

// Matches: [HH:MM:SS.mmm,uuu] <level> module: message
const ZEPHYR_LOG_RE =
  /^\[(\d{2}):(\d{2}):(\d{2})\.(\d{3}),(\d{3})\]\s+<(err|wrn|inf|dbg)>\s+([\w.]+):\s?(.*)/;

// Strip ANSI escape codes (color codes from Zephyr's CONFIG_LOG_BACKEND_RTT)
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;

export class ZephyrLogParser implements Parser {
  parse(data: string | Uint8Array): LogEntry[] {
    const text = typeof data === "string" ? data : new TextDecoder().decode(data);
    const lines = text.split("\n");
    const entries: LogEntry[] = [];

    for (const line of lines) {
      const trimmed = line.replaceAll(ANSI_RE, "").trimEnd();
      if (!trimmed) continue;

      const match = trimmed.match(ZEPHYR_LOG_RE);
      if (match) {
        const [, hours, minutes, seconds, millis, micros, severity, module, message] = match;

        const timestamp =
          Number.parseInt(hours) * 3_600_000_000 +
          Number.parseInt(minutes) * 60_000_000 +
          Number.parseInt(seconds) * 1_000_000 +
          Number.parseInt(millis) * 1_000 +
          Number.parseInt(micros);

        entries.push({
          timestamp,
          source: "log",
          severity: severity as Severity,
          module,
          message: message ?? "",
          metadata: {},
        });
      } else {
        // Unmatched lines: printk() output, boot banners, raw text
        // Show them so no data is lost — use "raw" module and "inf" severity
        entries.push({
          timestamp: 0,
          source: "log",
          severity: "inf",
          module: "raw",
          message: trimmed,
          metadata: { raw: true },
        });
      }
    }

    return entries;
  }
}
