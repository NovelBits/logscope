/**
 * Shared decoder helpers used by both the top-level HCI decoders
 * (`hci-decoders.ts`) and the per-opcode ATT decoders (`att-decoders.ts`).
 *
 * Extracted into its own module to break the circular import that would
 * otherwise form: `hci-decoders.ts` imports the `attDecoders` dispatch
 * table from `att-decoders.ts`, and the ATT decoders need these
 * formatting helpers — so the helpers live here, and both decoder
 * modules import from this one.
 */

import { DecodedField } from "./types";
import { attOpcodeName as attOpcodeNameImpl } from "./hci-field-types";

export const COLOR_ERROR = "#f44747";

/** Create a DecodedField, optionally with a color */
export function field(name: string, value: string, color?: string): DecodedField {
  return color ? { name, value, color } : { name, value };
}

/**
 * Create a DecodedField with a Bluetooth Core Spec section reference.
 * Used for status / error codes and similar spec-defined values where
 * we want the user to see "this is defined in the Core Spec at §X.Y.Z".
 */
export function fieldWithSpec(name: string, value: string, specRef: string, color?: string): DecodedField {
  const f: DecodedField = { name, value, specRef };
  if (color) f.color = color;
  return f;
}

/** Format raw bytes as hex + ASCII (e.g., "01 00 48 65  ..He") */
export function formatValueBytes(bytes: Uint8Array | Buffer): string {
  if (bytes.length === 0) return "(empty)";
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join(" ");
  const ascii = Array.from(bytes).map(b => b >= 0x20 && b <= 0x7e ? String.fromCodePoint(b) : ".").join("");
  return `${hex}  ${ascii}`;
}

/** Format a 16-bit handle as 0xNNNN */
export function fmtHandle(h: number): string {
  return `0x${h.toString(16).toUpperCase().padStart(4, "0")}`;
}

/**
 * Re-export of `attOpcodeName` from `hci-field-types`. Centralized here so
 * both `hci-decoders.ts` and `att-decoders.ts` can import the ATT-opcode
 * helpers from a single shared module.
 */
export function attOpcodeName(opcode: number): string {
  return attOpcodeNameImpl(opcode);
}

/**
 * Format a 16-byte little-endian UUID buffer as a standard textual UUID
 * (8-4-4-4-12 hex with hyphens, big-endian). Used for 128-bit UUIDs in
 * ATT responses where the SIG transmits little-endian on the wire but
 * humans read big-endian.
 */
export function format128BitUuid(buf: Buffer): string {
  if (buf.length !== 16) {
    return buf.toString("hex").toUpperCase();
  }
  const bytes = Buffer.from(buf).reverse();
  const hex = bytes.toString("hex").toUpperCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
