/**
 * Per-opcode ATT decoders. Each helper takes the full ACL payload, the
 * formatted connection handle string, and the shared fields array (which it
 * mutates). Returns a DecodedPacket on success, or null when the payload is
 * too short to decode — in which case the caller (in `hci-decoders.ts`) falls
 * back to the default ATT opcode-name display.
 *
 * This module is consumed by `hci-decoders.ts` via the `attDecoders` dispatch
 * table. Shared formatting helpers live in `hci-decoders-shared.ts` to break
 * the circular import that would otherwise form.
 */

import { DecodedField, DecodedPacket } from "./types";
import {
  lookupAttError,
  lookupCharacteristicUuid,
  lookupDescriptorUuid,
  lookupServiceUuid,
} from "@novelbits/ble-spec";
import {
  COLOR_ERROR,
  field,
  fieldWithSpec,
  fmtHandle,
  format128BitUuid,
  formatValueBytes,
  attOpcodeName,
} from "./hci-decoders-shared";

/**
 * Decoder for a single ATT opcode. Receives the full ACL payload (so it can
 * read fields at known byte offsets), the formatted connection handle string,
 * and the shared fields array which it mutates. Returns a DecodedPacket on
 * success, or null when the payload is too short to decode (in which case the
 * caller falls back to the default ATT opcode-name display).
 */
export type AttDecoder = (
  payload: Buffer,
  handleStr: string,
  fields: DecodedField[]
) => DecodedPacket | null;

/**
 * ATT Error Response (opcode 0x01): Request Opcode (1B) + Attribute Handle
 * In Error (2B) + Error Code (1B). Core Spec v6.0 Vol 3 Part F §3.4.1.1.
 */
export function decodeAttErrorResponse(
  payload: Buffer,
  handleStr: string,
  fields: DecodedField[]
): DecodedPacket | null {
  if (payload.length < 13) return null;
  const reqOpcode = payload[9];
  const reqOpcodeName = attOpcodeName(reqOpcode);
  const attHandle = payload.readUInt16LE(10);
  const errCode = payload[12];
  const errEntry = lookupAttError(errCode);
  const errText = errEntry
    ? errEntry.name
    : `Unknown (0x${errCode.toString(16).toUpperCase().padStart(2, "0")})`;
  fields.push(
    field("Request In Error", reqOpcodeName),
    field("ATT Handle In Error", fmtHandle(attHandle)),
  );
  if (errEntry) {
    fields.push(fieldWithSpec("Error Code", errEntry.name, errEntry.specRef, COLOR_ERROR));
  } else {
    fields.push(field("Error Code", errText, COLOR_ERROR));
  }
  return {
    summary: `handle:${handleStr} ATT Error Response (${reqOpcodeName} -> ${errText})`,
    fields,
  };
}

/** ATT Exchange MTU Request (0x02) / Response (0x03). */
export function decodeAttExchangeMtu(
  payload: Buffer,
  handleStr: string,
  fields: DecodedField[]
): DecodedPacket | null {
  if (payload.length < 11) return null;
  const mtu = payload.readUInt16LE(9);
  fields.push(field("MTU", mtu.toString()));
  return { summary: `handle:${handleStr} ATT Exchange MTU (mtu: ${mtu})`, fields };
}

/** ATT Read Request (0x0a). */
export function decodeAttReadRequest(
  payload: Buffer,
  handleStr: string,
  fields: DecodedField[]
): DecodedPacket | null {
  if (payload.length < 11) return null;
  const attHandle = payload.readUInt16LE(9);
  fields.push(field("ATT Handle", fmtHandle(attHandle)));
  return { summary: `handle:${handleStr} ATT Read Request (handle: ${fmtHandle(attHandle)})`, fields };
}

/** ATT Read Response (0x0b) — variable-length value, no minimum beyond the opcode byte. */
export function decodeAttReadResponse(
  payload: Buffer,
  handleStr: string,
  fields: DecodedField[]
): DecodedPacket | null {
  const respData = payload.subarray(9);
  fields.push(field("Data", formatValueBytes(respData)));
  return { summary: `handle:${handleStr} ATT Read Response (${respData.length} bytes)`, fields };
}

/**
 * ATT Write Request (0x12) / Write Command (0x52) / Notification (0x1b).
 * Shared decoder — the ATT opcode is read from payload[8] for label selection
 * only; the parsing layout is identical across the three.
 */
export function decodeAttWriteOrNotify(
  payload: Buffer,
  handleStr: string,
  fields: DecodedField[]
): DecodedPacket | null {
  if (payload.length < 11) return null;
  const attOpcode = payload[8];
  const attHandle = payload.readUInt16LE(9);
  const value = payload.subarray(11);
  fields.push(field("ATT Handle", fmtHandle(attHandle)), field("Value", formatValueBytes(value)));
  const label =
    attOpcode === 0x12 ? "ATT Write Request" :
    attOpcode === 0x52 ? "ATT Write Command" :
    "ATT Notification";
  return { summary: `handle:${handleStr} ${label} (handle: ${fmtHandle(attHandle)})`, fields };
}

/** ATT Write Response (0x13) — zero-payload opcode. */
export function decodeAttWriteResponse(
  _payload: Buffer,
  handleStr: string,
  fields: DecodedField[]
): DecodedPacket {
  return {
    summary: `handle:${handleStr} ATT Write Response`,
    fields,
  };
}

/** ATT Handle Value Confirmation (0x1e) — zero-payload opcode. */
export function decodeAttHandleValueConfirmation(
  _payload: Buffer,
  handleStr: string,
  fields: DecodedField[]
): DecodedPacket {
  return {
    summary: `handle:${handleStr} ATT Handle Value Confirmation`,
    fields,
  };
}

export function decodeAttFindInformationRequest(
  payload: Buffer,
  handleStr: string,
  fields: DecodedField[]
): DecodedPacket | null {
  // ATT opcode at offset 8; body bytes start at offset 9.
  // Need: 4 body bytes (start handle 2B + end handle 2B) = 13 bytes total.
  if (payload.length < 13) return null;
  const startHandle = payload.readUInt16LE(9);
  const endHandle = payload.readUInt16LE(11);
  fields.push(
    field("Starting Handle", fmtHandle(startHandle)),
    field("Ending Handle", fmtHandle(endHandle)),
  );
  return {
    summary: `handle:${handleStr} ATT Find Information Request (${fmtHandle(startHandle)}-${fmtHandle(endHandle)})`,
    fields,
  };
}

export function decodeAttFindInformationResponse(
  payload: Buffer,
  handleStr: string,
  fields: DecodedField[]
): DecodedPacket | null {
  // Opcode at 8, format byte at 9, list starts at 10.
  if (payload.length < 10) return null;
  const format = payload[9];
  const entrySize = format === 0x01 ? 4 : format === 0x02 ? 18 : null;
  if (entrySize === null) {
    fields.push(field("Format", `0x${format.toString(16).padStart(2, "0")} (invalid)`, COLOR_ERROR));
    return { summary: `handle:${handleStr} ATT Find Information Response (invalid format)`, fields };
  }

  fields.push(field("Format", format === 0x01 ? "16-bit UUIDs" : "128-bit UUIDs"));

  const list = payload.subarray(10);
  const fullEntries = Math.floor(list.length / entrySize);
  const leftover = list.length - fullEntries * entrySize;

  for (let i = 0; i < fullEntries; i++) {
    const offset = i * entrySize;
    const attrHandle = list.readUInt16LE(offset);
    let uuidLabel: string;
    if (format === 0x01) {
      const uuid16 = list.readUInt16LE(offset + 2);
      const name = lookupDescriptorUuid(uuid16);
      const hex = `0x${uuid16.toString(16).padStart(4, "0").toUpperCase()}`;
      uuidLabel = name ? `${name} (${hex})` : hex;
    } else {
      uuidLabel = format128BitUuid(list.subarray(offset + 2, offset + 18));
    }
    fields.push(field(`Entry ${i + 1}`, `${fmtHandle(attrHandle)} -> ${uuidLabel}`));
  }
  if (leftover > 0) {
    fields.push(field("Truncated", `${leftover} byte(s)`, COLOR_ERROR));
  }

  return {
    summary: `handle:${handleStr} ATT Find Information Response (${fullEntries} entr${fullEntries === 1 ? "y" : "ies"})`,
    fields,
  };
}

/**
 * Resolve a 16-bit UUID against all three SIG UUID tables (service,
 * characteristic, descriptor) and return the first match. Used by ATT
 * decoders where the wire format doesn't tell us which UUID kind to expect
 * (e.g., Find By Type Value's Attribute Type, Read By Type's Attribute Type).
 *
 * Service is tried first because the dominant real-world use of these
 * opcodes is service discovery (Attribute Type = 0x2800 Primary Service,
 * with the value being the service UUID).
 */
function lookupAnyUuid16(uuid: number): string | null {
  return lookupServiceUuid(uuid) ?? lookupCharacteristicUuid(uuid) ?? lookupDescriptorUuid(uuid);
}

/**
 * Format a 16-bit UUID with name resolution against the union of SIG tables.
 * Returns "Name (0xHHHH)" when resolved, or just "0xHHHH" otherwise.
 */
function fmtUuid16WithLookup(uuid: number): string {
  const name = lookupAnyUuid16(uuid);
  const hex = `0x${uuid.toString(16).padStart(4, "0").toUpperCase()}`;
  return name ? `${name} (${hex})` : hex;
}

/**
 * ATT Find By Type Value Request (0x06). Core Spec v6.3 Vol 3 Part F §3.4.3.3.
 *
 * Body: Starting Handle (2B) + Ending Handle (2B) + Attribute Type (2B, 16-bit
 * UUID only per spec) + Attribute Value (variable, may be zero-length).
 * Minimum total payload: 8 (L2CAP prefix) + 1 (opcode) + 6 (handles + type) = 15.
 */
export function decodeAttFindByTypeValueRequest(
  payload: Buffer,
  handleStr: string,
  fields: DecodedField[]
): DecodedPacket | null {
  if (payload.length < 15) return null;
  const startHandle = payload.readUInt16LE(9);
  const endHandle = payload.readUInt16LE(11);
  const attrType = payload.readUInt16LE(13);
  const value = payload.subarray(15);
  const attrTypeLabel = fmtUuid16WithLookup(attrType);
  fields.push(
    field("Starting Handle", fmtHandle(startHandle)),
    field("Ending Handle", fmtHandle(endHandle)),
    field("Attribute Type", attrTypeLabel),
    field("Attribute Value", formatValueBytes(value)),
  );
  return {
    summary: `handle:${handleStr} ATT Find By Type Value Request (${attrTypeLabel})`,
    fields,
  };
}

/**
 * ATT Find By Type Value Response (0x07). Core Spec v6.3 Vol 3 Part F §3.4.3.4.
 *
 * Body: a list of (Found Attribute Handle 2B + Group End Handle 2B) entries.
 * Each entry is exactly 4 bytes. Zero entries is valid per spec.
 */
export function decodeAttFindByTypeValueResponse(
  payload: Buffer,
  handleStr: string,
  fields: DecodedField[]
): DecodedPacket | null {
  if (payload.length < 9) return null;
  const list = payload.subarray(9);
  const entrySize = 4;
  const fullEntries = Math.floor(list.length / entrySize);
  const leftover = list.length - fullEntries * entrySize;

  for (let i = 0; i < fullEntries; i++) {
    const offset = i * entrySize;
    const foundHandle = list.readUInt16LE(offset);
    const groupEndHandle = list.readUInt16LE(offset + 2);
    fields.push(
      field(`Entry ${i + 1}`, `${fmtHandle(foundHandle)} -> ${fmtHandle(groupEndHandle)}`),
    );
  }
  if (leftover > 0) {
    fields.push(field("Truncated", `${leftover} byte(s)`, COLOR_ERROR));
  }

  return {
    summary: `handle:${handleStr} ATT Find By Type Value Response (${fullEntries} entr${fullEntries === 1 ? "y" : "ies"})`,
    fields,
  };
}

/**
 * ATT Read By Type Request (0x08). Core Spec v6.3 Vol 3 Part F §3.4.4.1.
 *
 * Body: Starting Handle (2B) + Ending Handle (2B) + Attribute Type UUID
 * (2B or 16B). The UUID size is inferred from the total body length:
 * 6 bytes → 16-bit UUID, 20 bytes → 128-bit UUID. Any other length is
 * malformed → return null.
 */
export function decodeAttReadByTypeRequest(
  payload: Buffer,
  handleStr: string,
  fields: DecodedField[]
): DecodedPacket | null {
  // Opcode at offset 8; body starts at offset 9.
  // Valid total lengths: 9 + 6 = 15 (16-bit UUID) or 9 + 20 = 29 (128-bit).
  if (payload.length !== 15 && payload.length !== 29) return null;
  const startHandle = payload.readUInt16LE(9);
  const endHandle = payload.readUInt16LE(11);
  let attrTypeLabel: string;
  if (payload.length === 15) {
    const uuid16 = payload.readUInt16LE(13);
    attrTypeLabel = fmtUuid16WithLookup(uuid16);
  } else {
    attrTypeLabel = format128BitUuid(payload.subarray(13, 29));
  }
  fields.push(
    field("Starting Handle", fmtHandle(startHandle)),
    field("Ending Handle", fmtHandle(endHandle)),
    field("Attribute Type", attrTypeLabel),
  );
  return {
    summary: `handle:${handleStr} ATT Read By Type Request (${attrTypeLabel})`,
    fields,
  };
}

/**
 * ATT Read By Type Response (0x09). Core Spec v6.3 Vol 3 Part F §3.4.4.2.
 *
 * Body: Length byte (1B) giving the size of each Attribute Data entry that
 * follows, then a list of entries each containing
 * `Attribute Handle (2B) + Attribute Value (length - 2 bytes)`. The Length
 * byte must be >= 2 (room for the handle); zero-length values (length == 2)
 * are valid.
 *
 * NOTE for Sprint B: the aggregation view will interpret the Attribute Value
 * bytes based on the request's Attribute Type (e.g., when type = 0x2803
 * Characteristic Declaration, the value is structured as
 * properties/handle/UUID). For Sprint A we just render raw bytes.
 */
export function decodeAttReadByTypeResponse(
  payload: Buffer,
  handleStr: string,
  fields: DecodedField[]
): DecodedPacket | null {
  // Need at least the length byte at offset 9.
  if (payload.length < 10) return null;
  const lengthByte = payload[9];
  fields.push(field("Length", lengthByte.toString()));

  if (lengthByte < 2) {
    fields.push(field("Truncated", `invalid length byte: ${lengthByte} (must be >= 2)`, COLOR_ERROR));
    return {
      summary: `handle:${handleStr} ATT Read By Type Response (invalid length)`,
      fields,
    };
  }

  const list = payload.subarray(10);
  const fullEntries = Math.floor(list.length / lengthByte);
  const leftover = list.length - fullEntries * lengthByte;
  const valueSize = lengthByte - 2;

  for (let i = 0; i < fullEntries; i++) {
    const offset = i * lengthByte;
    const attrHandle = list.readUInt16LE(offset);
    const valueBytes = list.subarray(offset + 2, offset + 2 + valueSize);
    fields.push(
      field(`Entry ${i + 1}`, `handle ${fmtHandle(attrHandle)}, value: ${formatValueBytes(valueBytes)}`),
    );
  }
  if (leftover > 0) {
    fields.push(field("Truncated", `${leftover} byte(s)`, COLOR_ERROR));
  }

  return {
    summary: `handle:${handleStr} ATT Read By Type Response (${fullEntries} entr${fullEntries === 1 ? "y" : "ies"})`,
    fields,
  };
}

/**
 * ATT Read By Group Type Request (0x10). Core Spec v6.3 Vol 3 Part F §3.4.4.9.
 *
 * Body: same shape as Read By Type request — Starting Handle (2B) +
 * Ending Handle (2B) + Attribute Group Type UUID (2B or 16B). Body length
 * disambiguates UUID size: 6 → 16-bit, 20 → 128-bit.
 */
export function decodeAttReadByGroupTypeRequest(
  payload: Buffer,
  handleStr: string,
  fields: DecodedField[]
): DecodedPacket | null {
  if (payload.length !== 15 && payload.length !== 29) return null;
  const startHandle = payload.readUInt16LE(9);
  const endHandle = payload.readUInt16LE(11);
  let groupTypeLabel: string;
  if (payload.length === 15) {
    const uuid16 = payload.readUInt16LE(13);
    groupTypeLabel = fmtUuid16WithLookup(uuid16);
  } else {
    groupTypeLabel = format128BitUuid(payload.subarray(13, 29));
  }
  fields.push(
    field("Starting Handle", fmtHandle(startHandle)),
    field("Ending Handle", fmtHandle(endHandle)),
    field("Attribute Group Type", groupTypeLabel),
  );
  return {
    summary: `handle:${handleStr} ATT Read By Group Type Request (${groupTypeLabel})`,
    fields,
  };
}

/**
 * ATT Read By Group Type Response (0x11). Core Spec v6.3 Vol 3 Part F §3.4.4.10.
 *
 * Body: Length byte (1B) giving the size of each Attribute Data entry, then
 * a list of entries each containing
 * `Attribute Handle (2B) + End Group Handle (2B) + Attribute Value (length - 4 bytes)`.
 *
 * The dominant use is Primary Service discovery, where each value IS a
 * service UUID. We resolve as follows: value length 2 → 16-bit, attempt
 * `lookupServiceUuid` (services only, since this is the canonical use);
 * value length 16 → format as 128-bit UUID; any other length → raw hex.
 */
export function decodeAttReadByGroupTypeResponse(
  payload: Buffer,
  handleStr: string,
  fields: DecodedField[]
): DecodedPacket | null {
  if (payload.length < 10) return null;
  const lengthByte = payload[9];
  fields.push(field("Length", lengthByte.toString()));

  if (lengthByte < 4) {
    fields.push(field("Truncated", `invalid length byte: ${lengthByte} (must be >= 4)`, COLOR_ERROR));
    return {
      summary: `handle:${handleStr} ATT Read By Group Type Response (invalid length)`,
      fields,
    };
  }

  const list = payload.subarray(10);
  const fullEntries = Math.floor(list.length / lengthByte);
  const leftover = list.length - fullEntries * lengthByte;
  const valueSize = lengthByte - 4;

  for (let i = 0; i < fullEntries; i++) {
    const offset = i * lengthByte;
    const attrHandle = list.readUInt16LE(offset);
    const endGroupHandle = list.readUInt16LE(offset + 2);
    const valueBytes = list.subarray(offset + 4, offset + 4 + valueSize);

    let valueLabel: string;
    if (valueSize === 2) {
      const uuid16 = valueBytes.readUInt16LE(0);
      const name = lookupServiceUuid(uuid16);
      const hex = `0x${uuid16.toString(16).padStart(4, "0").toUpperCase()}`;
      valueLabel = name ? `${name} (${hex})` : hex;
    } else if (valueSize === 16) {
      valueLabel = format128BitUuid(valueBytes);
    } else {
      valueLabel = formatValueBytes(valueBytes);
    }

    fields.push(
      field(`Entry ${i + 1}`, `${fmtHandle(attrHandle)}-${fmtHandle(endGroupHandle)} -> ${valueLabel}`),
    );
  }
  if (leftover > 0) {
    fields.push(field("Truncated", `${leftover} byte(s)`, COLOR_ERROR));
  }

  return {
    summary: `handle:${handleStr} ATT Read By Group Type Response (${fullEntries} entr${fullEntries === 1 ? "y" : "ies"})`,
    fields,
  };
}

/**
 * ATT Read Blob Request (0x0c). Core Spec v6.3 Vol 3 Part F §3.4.4.5.
 *
 * Body: Attribute Handle (2B) + Value Offset (2B). Minimum body 4 bytes;
 * minimum total payload 13 bytes (8-byte L2CAP prefix + opcode + 4 body).
 */
export function decodeAttReadBlobRequest(
  payload: Buffer,
  handleStr: string,
  fields: DecodedField[]
): DecodedPacket | null {
  if (payload.length < 13) return null;
  const attHandle = payload.readUInt16LE(9);
  const offset = payload.readUInt16LE(11);
  fields.push(
    field("ATT Handle", fmtHandle(attHandle)),
    field("Value Offset", offset.toString()),
  );
  return {
    summary: `handle:${handleStr} ATT Read Blob Request (handle: ${fmtHandle(attHandle)}, offset: ${offset})`,
    fields,
  };
}

/**
 * ATT Read Blob Response (0x0d). Core Spec v6.3 Vol 3 Part F §3.4.4.6.
 *
 * Body: Part Attribute Value (variable, up to MTU-1 bytes). Zero length is
 * valid per spec — server may return an empty value if there's nothing more
 * to read at the requested offset.
 */
export function decodeAttReadBlobResponse(
  payload: Buffer,
  handleStr: string,
  fields: DecodedField[]
): DecodedPacket | null {
  if (payload.length < 9) return null;
  const value = payload.subarray(9);
  fields.push(
    field("Length", value.length.toString()),
    field("Value", formatValueBytes(value)),
  );
  return {
    summary: `handle:${handleStr} ATT Read Blob Response (${value.length} bytes)`,
    fields,
  };
}

export const attDecoders: Record<number, AttDecoder> = {
  0x01: decodeAttErrorResponse,
  0x02: decodeAttExchangeMtu,
  0x03: decodeAttExchangeMtu,
  0x04: decodeAttFindInformationRequest,
  0x05: decodeAttFindInformationResponse,
  0x06: decodeAttFindByTypeValueRequest,
  0x07: decodeAttFindByTypeValueResponse,
  0x08: decodeAttReadByTypeRequest,
  0x09: decodeAttReadByTypeResponse,
  0x0a: decodeAttReadRequest,
  0x0b: decodeAttReadResponse,
  0x0c: decodeAttReadBlobRequest,
  0x0d: decodeAttReadBlobResponse,
  0x10: decodeAttReadByGroupTypeRequest,
  0x11: decodeAttReadByGroupTypeResponse,
  0x12: decodeAttWriteOrNotify,
  0x13: decodeAttWriteResponse,
  0x1b: decodeAttWriteOrNotify,
  0x1e: decodeAttHandleValueConfirmation,
  0x52: decodeAttWriteOrNotify,
};
