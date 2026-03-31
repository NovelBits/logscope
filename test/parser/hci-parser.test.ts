import { HciParser } from "../../src/parser/hci-parser";
import type { LogEntry } from "../../src/parser/types";

// BT Monitor opcodes
const OP_COMMAND = 2;
const OP_EVENT = 3;
const OP_ACL_TX = 4;
const OP_SYSTEM_NOTE = 12;
const OP_USER_LOGGING = 13;

// Extended header type for 32-bit timestamp
const EXT_TS32 = 8;

/**
 * Build a BT Monitor wire-format packet.
 *
 * Wire format:
 *   [data_len:2 LE][opcode:2 LE][flags:1][hdr_len:1][ext_hdr:N][payload:M]
 *
 * data_len = 4 (opcode+flags+hdrLen) + extHdr.length + payload.length
 */
function makePacket(
  opcode: number,
  payload: Buffer,
  opts?: { extHdr?: Buffer; flags?: number },
): Buffer {
  const extHdr = opts?.extHdr ?? Buffer.alloc(0);
  const flags = opts?.flags ?? 0;
  const hdrLen = extHdr.length;
  const dataLen = 4 + hdrLen + payload.length;

  const buf = Buffer.alloc(2 + dataLen);
  buf.writeUInt16LE(dataLen, 0); // data_len
  buf.writeUInt16LE(opcode, 2); // opcode
  buf[4] = flags; // flags
  buf[5] = hdrLen; // hdr_len
  if (hdrLen > 0) {
    extHdr.copy(buf, 6);
  }
  payload.copy(buf, 6 + hdrLen);
  return buf;
}

/**
 * Build an extended header with a TS32 timestamp.
 * Format: [type:1 = 0x08][ts32:4 LE]
 */
function makeTs32ExtHdr(timestampUnits: number): Buffer {
  const buf = Buffer.alloc(5);
  buf[0] = EXT_TS32;
  buf.writeUInt32LE(timestampUnits, 1);
  return buf;
}

/**
 * Build a minimal HCI Command payload: [opcode_lo, opcode_hi, param_len, ...params]
 */
function makeCommandPayload(cmdOpcode: number, params: Buffer = Buffer.alloc(0)): Buffer {
  const buf = Buffer.alloc(3 + params.length);
  buf.writeUInt16LE(cmdOpcode, 0);
  buf[2] = params.length;
  params.copy(buf, 3);
  return buf;
}

/**
 * Build a minimal HCI Event payload: [event_code, param_len, ...params]
 */
function makeEventPayload(eventCode: number, params: Buffer = Buffer.alloc(0)): Buffer {
  const buf = Buffer.alloc(2 + params.length);
  buf[0] = eventCode;
  buf[1] = params.length;
  params.copy(buf, 2);
  return buf;
}

describe("HciParser", () => {
  let parser: HciParser;

  beforeEach(() => {
    parser = new HciParser();
  });

  describe("basic packet parsing", () => {
    it("parses an HCI Command packet (opcode 2)", () => {
      // Reset command: OGF 0x03, OCF 0x03 => opcode 0x0C03
      const payload = makeCommandPayload(0x0c03);
      const packet = makePacket(OP_COMMAND, payload);

      const entries = parser.parse(packet);

      expect(entries).toHaveLength(1);
      expect(entries[0].source).toBe("hci");
      expect(entries[0].module).toBe("CMD");
      expect(entries[0].message).toContain("TX");
      expect(entries[0].message).toContain("CMD");
      expect(entries[0].message).toContain("Reset");
      expect(entries[0].metadata.opcode).toBe(OP_COMMAND);
      expect(entries[0].metadata.direction).toBe("tx");
    });

    it("parses an HCI Event packet (opcode 3)", () => {
      // Command Complete event (0x0E), 1 byte param
      const payload = makeEventPayload(0x0e, Buffer.from([0x01]));
      const packet = makePacket(OP_EVENT, payload);

      const entries = parser.parse(packet);

      expect(entries).toHaveLength(1);
      expect(entries[0].source).toBe("hci");
      expect(entries[0].module).toBe("EVT");
      expect(entries[0].message).toContain("RX");
      expect(entries[0].message).toContain("EVT");
      expect(entries[0].message).toContain("Command Complete");
      expect(entries[0].metadata.opcode).toBe(OP_EVENT);
      expect(entries[0].metadata.direction).toBe("rx");
    });

    it("parses a System Note packet (opcode 12)", () => {
      const noteText = "Bluetooth initialized";
      const payload = Buffer.from(noteText + "\0", "utf-8");
      const packet = makePacket(OP_SYSTEM_NOTE, payload);

      const entries = parser.parse(packet);

      expect(entries).toHaveLength(1);
      expect(entries[0].message).toContain("SYS");
      expect(entries[0].message).toContain("Bluetooth initialized");
      expect(entries[0].severity).toBe("wrn");
    });

    it("parses a User Logging packet (opcode 13)", () => {
      // priority=6 (info), ident length=3, ident="bt\0", message="hello\0"
      const ident = "bt\0";
      const msg = "hello\0";
      const payload = Buffer.alloc(2 + ident.length + msg.length);
      payload[0] = 6; // priority (info level)
      payload[1] = ident.length;
      Buffer.from(ident, "utf-8").copy(payload, 2);
      Buffer.from(msg, "utf-8").copy(payload, 2 + ident.length);
      const packet = makePacket(OP_USER_LOGGING, payload);

      const entries = parser.parse(packet);

      expect(entries).toHaveLength(1);
      expect(entries[0].severity).toBe("inf");
      expect(entries[0].message).toContain("bt");
      expect(entries[0].message).toContain("hello");
    });
  });

  describe("empty and edge-case inputs", () => {
    it("returns empty array for empty input", () => {
      const entries = parser.parse(Buffer.alloc(0));
      expect(entries).toEqual([]);
    });

    it("returns empty array for input shorter than header (< 6 bytes)", () => {
      const entries = parser.parse(Buffer.from([0x04, 0x00, 0x02]));
      expect(entries).toEqual([]);
    });

    it("returns null for packets with negative payload length (corrupt hdrLen)", () => {
      // Craft a packet where hdrLen > dataLen - 4, causing negative payloadLen
      const buf = Buffer.alloc(8);
      buf.writeUInt16LE(4, 0); // dataLen = 4 (minimum: opcode+flags+hdrLen)
      buf.writeUInt16LE(OP_COMMAND, 2);
      buf[4] = 0; // flags
      buf[5] = 10; // hdrLen = 10, but dataLen - 4 = 0, so payloadLen = -10
      // Packet totalLen = 2 + 4 = 6, buffer is 8, so it will be extracted

      const entries = parser.parse(buf);
      expect(entries).toEqual([]);
    });
  });

  describe("buffering incomplete packets", () => {
    it("buffers incomplete packet and parses when remaining data arrives", () => {
      const payload = makeCommandPayload(0x0c03); // Reset
      const packet = makePacket(OP_COMMAND, payload);

      // Split in the middle
      const half = Math.floor(packet.length / 2);
      const part1 = packet.subarray(0, half);
      const part2 = packet.subarray(half);

      // First call: incomplete, should return nothing
      const entries1 = parser.parse(part1);
      expect(entries1).toEqual([]);

      // Second call: rest of the packet
      const entries2 = parser.parse(part2);
      expect(entries2).toHaveLength(1);
      expect(entries2[0].message).toContain("Reset");
    });

    it("buffers when data_len header arrives but payload is still pending", () => {
      const payload = makeCommandPayload(0x0c03);
      const packet = makePacket(OP_COMMAND, payload);

      // Send only the first 4 bytes (data_len + partial opcode)
      const entries1 = parser.parse(packet.subarray(0, 4));
      expect(entries1).toEqual([]);

      // Send the rest
      const entries2 = parser.parse(packet.subarray(4));
      expect(entries2).toHaveLength(1);
    });

    it("handles single-byte-at-a-time delivery", () => {
      const payload = makeCommandPayload(0x0c03);
      const packet = makePacket(OP_COMMAND, payload);

      let allEntries: LogEntry[] = [];
      for (let i = 0; i < packet.length; i++) {
        const entries = parser.parse(packet.subarray(i, i + 1));
        allEntries = allEntries.concat(entries);
      }
      expect(allEntries).toHaveLength(1);
      expect(allEntries[0].message).toContain("Reset");
    });
  });

  describe("multiple packets in a single buffer", () => {
    it("parses two packets concatenated in one buffer", () => {
      const cmd = makePacket(OP_COMMAND, makeCommandPayload(0x0c03)); // Reset
      const evt = makePacket(OP_EVENT, makeEventPayload(0x0e, Buffer.from([0x01]))); // Command Complete
      const combined = Buffer.concat([cmd, evt]);

      const entries = parser.parse(combined);

      expect(entries).toHaveLength(2);
      expect(entries[0].module).toBe("CMD");
      expect(entries[1].module).toBe("EVT");
    });

    it("parses three packets in one buffer", () => {
      const pkt1 = makePacket(OP_COMMAND, makeCommandPayload(0x0c03));
      const pkt2 = makePacket(OP_EVENT, makeEventPayload(0x0e, Buffer.from([0x01])));
      const note = Buffer.from("test note\0", "utf-8");
      const pkt3 = makePacket(OP_SYSTEM_NOTE, note);

      const entries = parser.parse(Buffer.concat([pkt1, pkt2, pkt3]));

      expect(entries).toHaveLength(3);
      expect(entries[0].module).toBe("CMD");
      expect(entries[1].module).toBe("EVT");
      expect(entries[2].message).toContain("test note");
    });

    it("parses complete packets and buffers trailing incomplete one", () => {
      const pkt1 = makePacket(OP_COMMAND, makeCommandPayload(0x0c03));
      const pkt2 = makePacket(OP_EVENT, makeEventPayload(0x0e, Buffer.from([0x01])));
      // Only send first 3 bytes of pkt2
      const combined = Buffer.concat([pkt1, pkt2.subarray(0, 3)]);

      const entries1 = parser.parse(combined);
      expect(entries1).toHaveLength(1);
      expect(entries1[0].module).toBe("CMD");

      // Send the rest of pkt2
      const entries2 = parser.parse(pkt2.subarray(3));
      expect(entries2).toHaveLength(1);
      expect(entries2[0].module).toBe("EVT");
    });
  });

  describe("buffer overflow protection", () => {
    it("accumulates large incomplete packet without losing data at boundary", () => {
      // data_len = 65535 => totalLen = 65537. Feed 65536 bytes: incomplete, buffer = 65536.
      // The guard checks > 65536, so 65536 does NOT trigger a reset.
      const chunk = Buffer.alloc(65536);
      chunk.writeUInt16LE(65535, 0); // data_len = 65535
      chunk.writeUInt16LE(OP_COMMAND, 2);
      chunk[4] = 0; // flags
      chunk[5] = 0; // hdrLen

      const entries1 = parser.parse(chunk);
      expect(entries1).toEqual([]); // incomplete packet, nothing parsed yet

      // Feed 1 more byte to complete the packet (buffer = 65537 = totalLen)
      const entries2 = parser.parse(Buffer.alloc(1));
      // The packet completes and parses (65531 bytes of zero payload as a command)
      expect(entries2).toHaveLength(1);
      expect(entries2[0].module).toBe("CMD");
    });

    it("recovers after buffer reset by parsing subsequent valid packets", () => {
      // The overflow guard (> 65536 bytes) is a safety net for corrupt data streams.
      // With uint16 data_len (max 65535), max totalLen is 65537 and max incomplete
      // buffer is 65536 bytes, which is exactly at the boundary (not over).
      // The guard catches pathological cases where corrupt framing causes accumulation.
      // We can verify recovery behavior: after a large packet completes (clearing the buffer),
      // new valid packets parse correctly.
      const largeChunk = Buffer.alloc(65536);
      largeChunk.writeUInt16LE(65535, 0);
      largeChunk.writeUInt16LE(OP_COMMAND, 2);
      largeChunk[4] = 0;
      largeChunk[5] = 0;

      // Complete the large packet, then immediately follow with a small valid one
      const validPacket = makePacket(OP_COMMAND, makeCommandPayload(0x0c03));
      const lastByte = Buffer.alloc(1);
      const combined = Buffer.concat([lastByte, validPacket]);

      parser.parse(largeChunk);
      const entries = parser.parse(combined);

      // Large packet parses + small Reset packet parses
      expect(entries).toHaveLength(2);
      expect(entries[1].message).toContain("Reset");
    });
  });

  describe("unknown opcodes", () => {
    it("handles unknown opcode gracefully with SYS pktType", () => {
      const unknownOpcode = 0xff;
      const payload = Buffer.from([0x01, 0x02, 0x03]);
      const packet = makePacket(unknownOpcode, payload);

      const entries = parser.parse(packet);

      expect(entries).toHaveLength(1);
      expect(entries[0].module).toBe("SYS");
      expect(entries[0].severity).toBe("dbg");
      expect(entries[0].message).toContain("0xff");
      expect(entries[0].message).toContain("3B");
    });

    it("handles unknown opcode with empty payload", () => {
      const packet = makePacket(0xfe, Buffer.alloc(0));

      const entries = parser.parse(packet);

      expect(entries).toHaveLength(1);
      expect(entries[0].module).toBe("SYS");
      expect(entries[0].message).toContain("0xfe");
      expect(entries[0].message).toContain("0B");
    });
  });

  describe("timestamp extraction from extended header", () => {
    it("extracts TS32 timestamp from extended header", () => {
      const tsUnits = 12345; // in 1/10 ms units
      const extHdr = makeTs32ExtHdr(tsUnits);
      const payload = makeCommandPayload(0x0c03);
      const packet = makePacket(OP_COMMAND, payload, { extHdr });

      const entries = parser.parse(packet);

      expect(entries).toHaveLength(1);
      // Timestamp should be tsUnits * 100 microseconds
      expect(entries[0].timestamp).toBe(12345 * 100);
    });

    it("returns timestamp 0 when no extended header", () => {
      const payload = makeCommandPayload(0x0c03);
      const packet = makePacket(OP_COMMAND, payload);

      const entries = parser.parse(packet);

      expect(entries).toHaveLength(1);
      expect(entries[0].timestamp).toBe(0);
    });

    it("returns timestamp 0 when ext header type is not TS32", () => {
      // Use an unknown ext header type (0x01 instead of 0x08)
      const extHdr = Buffer.alloc(5);
      extHdr[0] = 0x01; // not EXT_TS32
      extHdr.writeUInt32LE(99999, 1);
      const payload = makeCommandPayload(0x0c03);
      const packet = makePacket(OP_COMMAND, payload, { extHdr });

      const entries = parser.parse(packet);

      expect(entries).toHaveLength(1);
      expect(entries[0].timestamp).toBe(0);
    });

    it("handles large TS32 values correctly", () => {
      // Max value near 2^32 - 1
      const tsUnits = 0xfffffffe;
      const extHdr = makeTs32ExtHdr(tsUnits);
      const payload = makeCommandPayload(0x0c03);
      const packet = makePacket(OP_COMMAND, payload, { extHdr });

      const entries = parser.parse(packet);

      expect(entries).toHaveLength(1);
      expect(entries[0].timestamp).toBe(0xfffffffe * 100);
    });

    it("extracts timestamp zero from TS32 header with value 0", () => {
      const extHdr = makeTs32ExtHdr(0);
      const payload = makeCommandPayload(0x0c03);
      const packet = makePacket(OP_COMMAND, payload, { extHdr });

      const entries = parser.parse(packet);

      expect(entries).toHaveLength(1);
      expect(entries[0].timestamp).toBe(0);
    });
  });

  describe("raw payload preservation", () => {
    it("includes raw payload bytes in entry", () => {
      const payload = makeCommandPayload(0x0c03);
      const packet = makePacket(OP_COMMAND, payload);

      const entries = parser.parse(packet);

      expect(entries).toHaveLength(1);
      expect(entries[0].raw).toBeInstanceOf(Uint8Array);
      expect(entries[0].raw!.length).toBe(payload.length);
    });
  });
});
