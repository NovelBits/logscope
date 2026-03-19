/**
 * Export HCI log entries as a btsnoop file for Wireshark.
 *
 * Uses btsnoop format with datalink type 2001 (Linux Bluetooth Monitor)
 * which Wireshark recognizes natively.
 *
 * Each record contains a 6-byte BT Monitor header:
 *   [opcode:2 LE][adapter_index:2 LE][data_length:2 LE]
 * followed by the HCI payload.
 *
 * btsnoop spec: RFC 1761 (original) + BlueZ extensions for type 2001
 */

import type { LogEntry } from "../parser/types";

// btsnoop file header
const BTSNOOP_MAGIC = Buffer.from("btsnoop\0", "ascii");
const BTSNOOP_VERSION = 1;
const BTSNOOP_DATALINK_MONITOR = 2001;

// btsnoop timestamp epoch: microseconds since 0 AD (January 1, year 0)
// Unix epoch (Jan 1 1970) in btsnoop epoch = 0x00dcddb30f2f8000
const BTSNOOP_UNIX_EPOCH = BigInt("0x00dcddb30f2f8000");

/**
 * Build a 6-byte BT Monitor header for a record.
 */
function monitorHeader(opcode: number, payloadLength: number): Buffer {
  const hdr = Buffer.alloc(6);
  hdr.writeUInt16LE(opcode, 0);      // BT Monitor opcode
  hdr.writeUInt16LE(0, 2);           // Adapter index (always 0)
  hdr.writeUInt16LE(payloadLength, 4); // Data length
  return hdr;
}

/**
 * Export HCI entries as a btsnoop binary buffer.
 * Only includes entries with source === "hci" and valid raw bytes.
 */
export function exportAsBtsnoop(entries: LogEntry[], sessionStartTime: Date): Buffer {
  // Filter to HCI entries with raw data and a real HCI opcode (2-7, 18-19)
  const hciEntries = entries.filter(
    (e) => e.source === "hci" && e.raw && e.raw.length > 0 && typeof e.metadata?.opcode === "number"
      && [2, 3, 4, 5, 6, 7, 18, 19].includes(e.metadata.opcode as number)
  );

  // Calculate total size
  const HEADER_SIZE = 16;
  const RECORD_HEADER_SIZE = 24; // 4+4+4+4+8
  const MONITOR_HEADER_SIZE = 6;
  let totalSize = HEADER_SIZE;
  for (const entry of hciEntries) {
    totalSize += RECORD_HEADER_SIZE + MONITOR_HEADER_SIZE + entry.raw!.length;
  }

  const buf = Buffer.alloc(totalSize);
  let offset = 0;

  // Write btsnoop file header
  BTSNOOP_MAGIC.copy(buf, offset); offset += 8;
  buf.writeUInt32BE(BTSNOOP_VERSION, offset); offset += 4;
  buf.writeUInt32BE(BTSNOOP_DATALINK_MONITOR, offset); offset += 4;

  // Session start in btsnoop epoch (microseconds)
  const sessionStartUs = BTSNOOP_UNIX_EPOCH + BigInt(sessionStartTime.getTime()) * BigInt(1000);

  // Write records
  for (const entry of hciEntries) {
    const raw = entry.raw!;
    const opcode = entry.metadata.opcode as number;
    const monHdr = monitorHeader(opcode, raw.length);
    const recordDataLen = MONITOR_HEADER_SIZE + raw.length;

    // Original length = included length (we have full data)
    buf.writeUInt32BE(recordDataLen, offset); offset += 4;
    buf.writeUInt32BE(recordDataLen, offset); offset += 4;

    // Flags: for datalink 2001, flags = opcode in network byte order
    buf.writeUInt32BE(opcode, offset); offset += 4;

    // Cumulative drops
    buf.writeUInt32BE(0, offset); offset += 4;

    // Timestamp in btsnoop epoch
    const ts = sessionStartUs + BigInt(entry.timestamp);
    buf.writeBigUInt64BE(ts, offset); offset += 8;

    // BT Monitor header + HCI payload
    monHdr.copy(buf, offset); offset += MONITOR_HEADER_SIZE;
    Buffer.from(raw).copy(buf, offset); offset += raw.length;
  }

  return buf;
}
