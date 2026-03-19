import { exportAsBtsnoop } from "../../src/model/btsnoop-export";
import type { LogEntry } from "../../src/parser/types";

describe("exportAsBtsnoop", () => {
  const sessionStart = new Date("2026-03-18T12:00:00Z");

  it("produces valid btsnoop header", () => {
    const buf = exportAsBtsnoop([], sessionStart);
    expect(buf.length).toBe(16);
    expect(buf.subarray(0, 8).toString("ascii")).toBe("btsnoop\0");
    expect(buf.readUInt32BE(8)).toBe(1); // version
    expect(buf.readUInt32BE(12)).toBe(2001); // datalink
  });

  it("includes HCI entries with monitor header", () => {
    const entries: LogEntry[] = [
      {
        timestamp: 100000,
        source: "hci",
        severity: "inf",
        module: "CMD",
        message: "TX CMD Reset",
        raw: new Uint8Array([0x03, 0x0c, 0x00]),
        metadata: { opcode: 2, direction: "tx" },
      },
      {
        // Non-HCI — excluded
        timestamp: 200000,
        source: "log",
        severity: "inf",
        module: "app",
        message: "Hello",
        metadata: {},
      },
    ];

    const buf = exportAsBtsnoop(entries, sessionStart);
    // Header(16) + record header(24) + monitor header(6) + 3 bytes payload = 49
    expect(buf.length).toBe(49);

    // Record original_length = 6 (monitor hdr) + 3 (payload) = 9
    expect(buf.readUInt32BE(16)).toBe(9);
    // included_length = 9
    expect(buf.readUInt32BE(20)).toBe(9);
    // flags = opcode = 2
    expect(buf.readUInt32BE(24)).toBe(2);

    // Monitor header at offset 40: opcode LE = 0x0002
    expect(buf.readUInt16LE(40)).toBe(2);
    // Adapter index = 0
    expect(buf.readUInt16LE(42)).toBe(0);
    // Data length = 3
    expect(buf.readUInt16LE(44)).toBe(3);

    // Payload at offset 46
    expect(buf[46]).toBe(0x03);
    expect(buf[47]).toBe(0x0c);
    expect(buf[48]).toBe(0x00);
  });

  it("skips non-HCI opcodes (system notes, user logging)", () => {
    const entries: LogEntry[] = [
      {
        timestamp: 0,
        source: "hci",
        severity: "dbg",
        module: "SYS",
        message: "BT Monitor opcode 0x08",
        metadata: { opcode: 8 }, // OPEN_INDEX — not a real HCI packet
      },
      {
        timestamp: 0,
        source: "hci",
        severity: "inf",
        module: "MON",
        message: "mirrored log",
        metadata: { opcode: 13 }, // USER_LOGGING
      },
    ];

    const buf = exportAsBtsnoop(entries, sessionStart);
    expect(buf.length).toBe(16); // Header only
  });

  it("handles multiple records", () => {
    const entries: LogEntry[] = [
      {
        timestamp: 0,
        source: "hci",
        severity: "inf",
        module: "CMD",
        message: "cmd",
        raw: new Uint8Array([0x01, 0x02]),
        metadata: { opcode: 2 },
      },
      {
        timestamp: 1000,
        source: "hci",
        severity: "inf",
        module: "EVT",
        message: "evt",
        raw: new Uint8Array([0x0E, 0x04, 0x01, 0x03, 0x0C, 0x00]),
        metadata: { opcode: 3 },
      },
    ];

    const buf = exportAsBtsnoop(entries, sessionStart);
    // Header(16) + record1(24+6+2) + record2(24+6+6) = 84
    expect(buf.length).toBe(84);
  });
});
