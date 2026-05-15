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
import { lookupAttError } from "@novelbits/ble-spec";
import {
  COLOR_ERROR,
  field,
  fieldWithSpec,
  fmtHandle,
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

export const attDecoders: Record<number, AttDecoder> = {
  0x01: decodeAttErrorResponse,
  0x02: decodeAttExchangeMtu,
  0x03: decodeAttExchangeMtu,
  0x0a: decodeAttReadRequest,
  0x0b: decodeAttReadResponse,
  0x12: decodeAttWriteOrNotify,
  0x13: decodeAttWriteResponse,
  0x1b: decodeAttWriteOrNotify,
  0x1e: decodeAttHandleValueConfirmation,
  0x52: decodeAttWriteOrNotify,
};
