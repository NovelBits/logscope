// "trace" severity is reserved for RTOS/SystemView events (future parsers)
// The Zephyr text log parser only produces err/wrn/inf/dbg
export type Severity = "err" | "wrn" | "inf" | "dbg" | "trace";
export type Source = "log" | "rtos" | "hci";

export interface LogEntry {
  timestamp: number; // microseconds since session start
  receivedAt?: number; // epoch ms when host received this line
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
  /**
   * Optional Bluetooth Core Specification section reference, e.g.
   * "Core Spec v6.0, Vol 1, Part F, §2.5". Rendered inline next to the
   * value in the HCI decoder panel so the user can see "where in the
   * spec this is defined" without leaving the log viewer. Set by lookups
   * against the @novelbits/ble-spec reference tables.
   */
  specRef?: string;
}

export interface DecodedPacket {
  summary: string;
  fields: DecodedField[];
}

export interface Parser {
  parse(data: string | Uint8Array): LogEntry[];
}
