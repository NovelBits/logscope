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

  describe("timestamp conversion", () => {
    const BTSNOOP_UNIX_EPOCH = BigInt("0x00dcddb30f2f8000");

    it("calculates btsnoop epoch timestamp from session start and entry offset", () => {
      const sessionStart = new Date("2026-03-18T12:00:00Z");
      const entryTimestamp = 500000; // 500ms in microseconds

      const entries: LogEntry[] = [
        {
          timestamp: entryTimestamp,
          source: "hci",
          severity: "inf",
          module: "CMD",
          message: "cmd",
          raw: new Uint8Array([0x01]),
          metadata: { opcode: 2 },
        },
      ];

      const buf = exportAsBtsnoop(entries, sessionStart);
      // Timestamp is at offset 16 (record header start) + 16 (after orig_len, incl_len, flags, drops) = 32
      const ts = buf.readBigUInt64BE(32);

      const expected = BTSNOOP_UNIX_EPOCH + BigInt(sessionStart.getTime()) * BigInt(1000) + BigInt(entryTimestamp);
      expect(ts).toBe(expected);
    });

    it("produces correct timestamp for zero entry offset", () => {
      const sessionStart = new Date("2026-01-01T00:00:00Z");

      const entries: LogEntry[] = [
        {
          timestamp: 0,
          source: "hci",
          severity: "inf",
          module: "CMD",
          message: "cmd",
          raw: new Uint8Array([0x01]),
          metadata: { opcode: 2 },
        },
      ];

      const buf = exportAsBtsnoop(entries, sessionStart);
      const ts = buf.readBigUInt64BE(32);

      // With zero entry timestamp, result should be exactly session start in btsnoop epoch
      const expected = BTSNOOP_UNIX_EPOCH + BigInt(sessionStart.getTime()) * BigInt(1000);
      expect(ts).toBe(expected);
    });

    it("preserves timestamp ordering across multiple records", () => {
      const entries: LogEntry[] = [
        {
          timestamp: 1000,
          source: "hci",
          severity: "inf",
          module: "CMD",
          message: "first",
          raw: new Uint8Array([0x01]),
          metadata: { opcode: 2 },
        },
        {
          timestamp: 5000,
          source: "hci",
          severity: "inf",
          module: "EVT",
          message: "second",
          raw: new Uint8Array([0x02]),
          metadata: { opcode: 3 },
        },
        {
          timestamp: 100000,
          source: "hci",
          severity: "inf",
          module: "EVT",
          message: "third",
          raw: new Uint8Array([0x03]),
          metadata: { opcode: 4 },
        },
      ];

      const buf = exportAsBtsnoop(entries, new Date("2026-03-18T12:00:00Z"));

      // Each record: 24 (header) + 6 (monitor) + 1 (payload) = 31 bytes
      const recordSize = 24 + 6 + 1;
      const ts1 = buf.readBigUInt64BE(16 + 16); // first record timestamp
      const ts2 = buf.readBigUInt64BE(16 + recordSize + 16); // second record timestamp
      const ts3 = buf.readBigUInt64BE(16 + 2 * recordSize + 16); // third record timestamp

      expect(ts1).toBeLessThan(ts2);
      expect(ts2).toBeLessThan(ts3);
      expect(ts2 - ts1).toBe(BigInt(4000)); // 5000 - 1000
      expect(ts3 - ts2).toBe(BigInt(95000)); // 100000 - 5000
    });
  });

  describe("multi-record traversal", () => {
    it("can walk all records by reading orig_len without overrun", () => {
      const entries: LogEntry[] = [
        {
          timestamp: 0,
          source: "hci",
          severity: "inf",
          module: "CMD",
          message: "cmd1",
          raw: new Uint8Array([0x01, 0x02, 0x03]),
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
        {
          timestamp: 2000,
          source: "hci",
          severity: "inf",
          module: "ACL",
          message: "acl1",
          raw: new Uint8Array([0xAA, 0xBB]),
          metadata: { opcode: 4 },
        },
      ];

      const buf = exportAsBtsnoop(entries, new Date("2026-03-18T12:00:00Z"));

      // Walk records starting after the 16-byte file header
      let offset = 16;
      let recordCount = 0;

      while (offset < buf.length) {
        // Each record header: orig_len(4) + incl_len(4) + flags(4) + drops(4) + timestamp(8) = 24
        const origLen = buf.readUInt32BE(offset);
        const inclLen = buf.readUInt32BE(offset + 4);

        // orig_len should equal incl_len (no truncation)
        expect(origLen).toBe(inclLen);
        expect(origLen).toBeGreaterThan(0);

        // Advance past record header + record data
        offset += 24 + inclLen;
        recordCount++;
      }

      // Should land exactly at buffer end
      expect(offset).toBe(buf.length);
      expect(recordCount).toBe(3);
    });
  });

  describe("edge cases", () => {
    it("skips log entries (source: log)", () => {
      const entries: LogEntry[] = [
        {
          timestamp: 0,
          source: "log",
          severity: "inf",
          module: "app",
          message: "Hello world",
          raw: new Uint8Array([0x01, 0x02]),
          metadata: { opcode: 2 },
        },
      ];

      const buf = exportAsBtsnoop(entries, new Date("2026-03-18T12:00:00Z"));
      expect(buf.length).toBe(16); // Header only
    });

    it("skips HCI entries without raw bytes", () => {
      const entries: LogEntry[] = [
        {
          timestamp: 0,
          source: "hci",
          severity: "inf",
          module: "CMD",
          message: "no raw data",
          metadata: { opcode: 2 },
        },
      ];

      const buf = exportAsBtsnoop(entries, new Date("2026-03-18T12:00:00Z"));
      expect(buf.length).toBe(16);
    });

    it("skips HCI entries with empty raw (length 0)", () => {
      const entries: LogEntry[] = [
        {
          timestamp: 0,
          source: "hci",
          severity: "inf",
          module: "CMD",
          message: "empty raw",
          raw: new Uint8Array([]),
          metadata: { opcode: 2 },
        },
      ];

      const buf = exportAsBtsnoop(entries, new Date("2026-03-18T12:00:00Z"));
      expect(buf.length).toBe(16);
    });

    it("skips HCI entries without metadata.opcode", () => {
      const entries: LogEntry[] = [
        {
          timestamp: 0,
          source: "hci",
          severity: "inf",
          module: "CMD",
          message: "no opcode",
          raw: new Uint8Array([0x01, 0x02]),
          metadata: {},
        },
      ];

      const buf = exportAsBtsnoop(entries, new Date("2026-03-18T12:00:00Z"));
      expect(buf.length).toBe(16);
    });
  });
});
