// "trace" severity is reserved for RTOS/SystemView events (future parsers)
// The Zephyr text log parser only produces err/wrn/inf/dbg
export type Severity = "err" | "wrn" | "inf" | "dbg" | "trace";
export type Source = "log" | "rtos" | "hci";

export interface LogEntry {
  timestamp: number; // microseconds since session start
  source: Source;
  severity: Severity;
  module: string;
  message: string;
  raw?: Uint8Array; // only for binary sources (RTOS, HCI)
  metadata: Record<string, unknown>;
}

export interface DecodedField {
  name: string;
  value: string;
  color?: string;
}

export interface DecodedPacket {
  summary: string;
  fields: DecodedField[];
}

export interface Parser {
  parse(data: string | Uint8Array): LogEntry[];
}
