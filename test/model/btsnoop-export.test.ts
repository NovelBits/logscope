import { exportAsBtsnoop } from "../../src/model/btsnoop-export";
import type { LogEntry } from "../../src/parser/types";

describe("exportAsBtsnoop", () => {
  const sessionStart = new Date("2026-03-18T12:00:00Z");

  it("produces valid btsnoop header", () => {
    const entries: LogEntry[] = [];
    const buf = exportAsBtsnoop(entries, sessionStart);
    // Header is 16 bytes even with no entries
    expect(buf.length).toBe(16);
    // Magic
    expect(buf.subarray(0, 8).toString("ascii")).toBe("btsnoop\0");
    // Version = 1
    expect(buf.readUInt32BE(8)).toBe(1);
    // Datalink = 2001 (BTSNOOP_FORMAT_MONITOR)
    expect(buf.readUInt32BE(12)).toBe(2001);
  });

  it("includes HCI entries with raw data", () => {
    const entries: LogEntry[] = [
      {
        timestamp: 100000, // 100ms
        source: "hci",
        severity: "inf",
        module: "CMD",
        message: "TX CMD Reset",
        raw: new Uint8Array([0x03, 0x0c, 0x00]),
        metadata: { opcode: 2, direction: "tx" },
      },
      {
        // Non-HCI entry — should be excluded
        timestamp: 200000,
        source: "log",
        severity: "inf",
        module: "app",
        message: "Hello",
        metadata: {},
      },
    ];

    const buf = exportAsBtsnoop(entries, sessionStart);
    // Header (16) + 1 record header (24) + 3 bytes payload
    expect(buf.length).toBe(16 + 24 + 3);

    // Record: original_length = 3
    expect(buf.readUInt32BE(16)).toBe(3);
    // included_length = 3
    expect(buf.readUInt32BE(20)).toBe(3);
    // flags = opcode = 2 (COMMAND)
    expect(buf.readUInt32BE(24)).toBe(2);
    // drops = 0
    expect(buf.readUInt32BE(28)).toBe(0);
    // Payload bytes
    expect(buf[40]).toBe(0x03);
    expect(buf[41]).toBe(0x0c);
    expect(buf[42]).toBe(0x00);
  });

  it("skips entries without raw data or opcode", () => {
    const entries: LogEntry[] = [
      {
        timestamp: 0,
        source: "hci",
        severity: "inf",
        module: "SYS",
        message: "System note",
        metadata: {},
        // No raw, no opcode
      },
    ];

    const buf = exportAsBtsnoop(entries, sessionStart);
    expect(buf.length).toBe(16); // Header only
  });

  it("handles multiple HCI entries", () => {
    const entries: LogEntry[] = [
      {
        timestamp: 0,
        source: "hci",
        severity: "inf",
        module: "CMD",
        message: "cmd1",
        raw: new Uint8Array([0x01, 0x02]),
        metadata: { opcode: 2 },
      },
      {
        timestamp: 1000,
        source: "hci",
        severity: "inf",
        module: "EVT",
        message: "evt1",
        raw: new Uint8Array([0x0E, 0x04, 0x01, 0x03, 0x0C, 0x00]),
        metadata: { opcode: 3 },
      },
    ];

    const buf = exportAsBtsnoop(entries, sessionStart);
    // Header (16) + record1 (24+2) + record2 (24+6) = 72
    expect(buf.length).toBe(72);
  });
});
