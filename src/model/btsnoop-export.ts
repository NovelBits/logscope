/**
 * Export HCI log entries as a btsnoop file for Wireshark.
 *
 * Uses btsnoop format with datalink type 2001 (BTSNOOP_FORMAT_MONITOR)
 * which matches the Zephyr BT Monitor protocol. Wireshark opens these
 * natively — no plugins required.
 *
 * Reference: https://www.kernel.org/doc/html/latest/dev-tools/kunit/running_tests.html
 * btsnoop format: https://fte.com/webhelpII/HSpy/Content/Technical_Information/BT_Snoop_File_Format.htm
 */

import type { LogEntry } from "../parser/types";

// btsnoop header magic
const BTSNOOP_MAGIC = Buffer.from("btsnoop\0", "ascii");
const BTSNOOP_VERSION = 1;
const BTSNOOP_DATALINK_MONITOR = 2001; // HCI Monitor format

// BT Monitor opcode mapping (matches Zephyr BT Monitor protocol)
const MONITOR_OPCODES: Record<string, number> = {
  // Map our opcode metadata values to btsnoop flags
};

// Epoch offset: btsnoop timestamps are microseconds since 2000-01-01 00:00:00 UTC
// Difference between Unix epoch (1970) and btsnoop epoch (2000) in microseconds
const BTSNOOP_EPOCH_OFFSET_US = BigInt(946684800) * BigInt(1_000_000);

/**
 * Export HCI entries as a btsnoop binary buffer.
 * Only includes entries with source === "hci" and valid raw bytes.
 */
export function exportAsBtsnoop(entries: LogEntry[], sessionStartTime: Date): Buffer {
  // Filter to HCI entries with raw data and a real opcode
  const hciEntries = entries.filter(
    (e) => e.source === "hci" && e.raw && e.raw.length > 0 && typeof e.metadata?.opcode === "number"
  );

  // Calculate total size: header (16) + records
  const HEADER_SIZE = 16;
  const RECORD_HEADER_SIZE = 24; // 4+4+4+4+8
  let totalSize = HEADER_SIZE;
  for (const entry of hciEntries) {
    totalSize += RECORD_HEADER_SIZE + entry.raw!.length;
  }

  const buf = Buffer.alloc(totalSize);
  let offset = 0;

  // Write btsnoop header
  BTSNOOP_MAGIC.copy(buf, offset);
  offset += 8;
  buf.writeUInt32BE(BTSNOOP_VERSION, offset);
  offset += 4;
  buf.writeUInt32BE(BTSNOOP_DATALINK_MONITOR, offset);
  offset += 4;

  // Session start as Unix timestamp in microseconds
  const sessionStartUs = BigInt(sessionStartTime.getTime()) * BigInt(1000);

  // Write records
  for (const entry of hciEntries) {
    const raw = entry.raw!;
    const opcode = entry.metadata.opcode as number;
    const dataLen = raw.length;

    // Original length and included length (same — we have the full payload)
    buf.writeUInt32BE(dataLen, offset);
    offset += 4;
    buf.writeUInt32BE(dataLen, offset);
    offset += 4;

    // Flags: the BT Monitor opcode (used by Wireshark to identify packet type)
    buf.writeUInt32BE(opcode, offset);
    offset += 4;

    // Cumulative drops (0 — we don't track drops)
    buf.writeUInt32BE(0, offset);
    offset += 4;

    // Timestamp: microseconds since 2000-01-01 UTC
    // entry.timestamp is microseconds since session start
    const entryTimestampUs = sessionStartUs + BigInt(entry.timestamp) + BTSNOOP_EPOCH_OFFSET_US;
    // Write as 64-bit big-endian
    buf.writeBigUInt64BE(entryTimestampUs, offset);
    offset += 8;

    // Packet data (raw payload)
    Buffer.from(raw).copy(buf, offset);
    offset += dataLen;
  }

  return buf;
}
