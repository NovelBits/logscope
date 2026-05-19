/**
 * Pure utility functions for formatting HCI field values
 * used in Bluetooth LE packet decoding.
 */

/** Format a 6-byte little-endian Bluetooth LE address as XX:XX:XX:XX:XX:XX */
export function formatAddress(buf: Buffer, offset: number): string {
  const bytes: string[] = [];
  for (let i = 5; i >= 0; i--) {
    bytes.push(buf[offset + i].toString(16).toUpperCase().padStart(2, "0"));
  }
  return bytes.join(":");
}

/** Map address type byte to a human-readable string */
export function formatAddressType(type: number): string {
  switch (type) {
    case 0x00:
      return "Public";
    case 0x01:
      return "Random";
    default:
      return `Unknown (0x${type.toString(16).toUpperCase().padStart(2, "0")})`;
  }
}

/** Map PHY code to a human-readable name */
export function formatPhyName(phy: number): string {
  switch (phy) {
    case 1:
      return "1M";
    case 2:
      return "2M";
    case 3:
      return "Coded";
    default:
      return `Unknown (0x${phy.toString(16).toUpperCase().padStart(2, "0")})`;
  }
}

/** Map connection role byte to Central/Peripheral */
export function formatRole(role: number): string {
  switch (role) {
    case 0x00:
      return "Central";
    case 0x01:
      return "Peripheral";
    default:
      return `Unknown (0x${role.toString(16).toUpperCase().padStart(2, "0")})`;
  }
}

/** Format a connection interval raw value (units of 1.25 ms) */
export function formatInterval(raw: number): string {
  const ms = (raw * 1.25).toFixed(2);
  return `${raw} (${ms} ms)`;
}

/** Format a supervision timeout raw value (units of 10 ms) */
export function formatTimeout(raw: number): string {
  const ms = raw * 10;
  return `${raw} (${ms} ms)`;
}

const HCI_ERROR_CODES: Record<number, string> = {
  0x00: "Success",
  0x01: "Unknown HCI Command",
  0x02: "Unknown Connection Identifier",
  0x03: "Hardware Failure",
  0x04: "Page Timeout",
  0x05: "Authentication Failure",
  0x06: "PIN or Key Missing",
  0x07: "Memory Capacity Exceeded",
  0x08: "Connection Timeout",
  0x09: "Connection Limit Exceeded",
  0x0b: "Connection Already Exists",
  0x0c: "Command Disallowed",
  0x0d: "Connection Rejected due to Limited Resources",
  0x0e: "Connection Rejected due to Security Reasons",
  0x11: "Unsupported Feature or Parameter Value",
  0x12: "Invalid HCI Command Parameters",
  0x13: "Remote User Terminated Connection",
  0x14: "Remote Device Terminated Connection due to Low Resources",
  0x15: "Remote Device Terminated Connection due to Power Off",
  0x16: "Connection Terminated by Local Host",
  0x18: "Pairing Not Allowed",
  0x1a: "Unsupported Remote Feature",
  0x1f: "Unspecified Error",
  0x20: "Unsupported LMP Parameter Value",
  0x22: "LMP Response Timeout / LL Response Timeout",
  0x23: "LMP Error Transaction Collision / LL Procedure Collision",
  0x25: "Encryption Mode Not Acceptable",
  0x28: "Instant Passed",
  0x29: "Pairing With Unit Key Not Supported",
  0x2a: "Different Transaction Collision",
  0x2f: "Insufficient Security",
  0x30: "Parameter Out of Mandatory Range",
  0x3a: "Controller Busy",
  0x3b: "Unacceptable Connection Parameters",
  0x3c: "Advertising Timeout",
  0x3d: "Connection Terminated due to MIC Failure",
  0x3e: "Connection Failed to be Established / Synchronization Timeout",
  0x40: "Coarse Clock Adjustment Rejected",
  0x41: "Type0 Submap Not Defined",
  0x42: "Unknown Advertising Identifier",
  0x43: "Limit Reached",
  0x44: "Operation Cancelled by Host",
  0x45: "Packet Too Long",
  0x46: "Too Late",
  0x47: "Too Early",
  0x48: "Insufficient Channels",
};

/** Look up an HCI error/status code */
export function hciErrorCode(code: number): string {
  return (
    HCI_ERROR_CODES[code] ??
    `Unknown (0x${code.toString(16).toUpperCase().padStart(2, "0")})`
  );
}

const ATT_OPCODES: Record<number, string> = {
  0x01: "Error Response",
  0x02: "Exchange MTU Request",
  0x03: "Exchange MTU Response",
  0x04: "Find Information Request",
  0x05: "Find Information Response",
  0x06: "Find By Type Value Request",
  0x07: "Find By Type Value Response",
  0x08: "Read By Type Request",
  0x09: "Read By Type Response",
  0x0a: "Read Request",
  0x0b: "Read Response",
  0x10: "Read By Group Type Request",
  0x11: "Read By Group Type Response",
  0x12: "Write Request",
  0x13: "Write Response",
  0x1b: "Handle Value Notification",
  0x1d: "Handle Value Indication",
  0x1e: "Handle Value Confirmation",
  0x52: "Write Command",
};

/** Look up an ATT opcode name */
export function attOpcodeName(opcode: number): string {
  return (
    ATT_OPCODES[opcode] ??
    `ATT 0x${opcode.toString(16).toUpperCase().padStart(2, "0")}`
  );
}

const ATT_ERROR_CODES: Record<number, string> = {
  0x01: "Invalid Handle",
  0x02: "Read Not Permitted",
  0x03: "Write Not Permitted",
  0x04: "Invalid PDU",
  0x05: "Insufficient Authentication",
  0x06: "Request Not Supported",
  0x07: "Invalid Offset",
  0x08: "Insufficient Authorization",
  0x09: "Prepare Queue Full",
  0x0a: "Attribute Not Found",
  0x0b: "Attribute Not Long",
  0x0c: "Encryption Key Size Too Short",
  0x0d: "Invalid Attribute Value Length",
  0x0e: "Unlikely Error",
  0x0f: "Insufficient Encryption",
  0x10: "Unsupported Group Type",
  0x11: "Insufficient Resources",
  0x12: "Database Out Of Sync",
  0x13: "Value Not Allowed",
};

/** Look up an ATT error code name. Per Core Spec Vol 3 Part F Section 3.4.1.1. */
export function attErrorCodeName(code: number): string {
  return (
    ATT_ERROR_CODES[code] ??
    `ATT Error 0x${code.toString(16).toUpperCase().padStart(2, "0")}`
  );
}

import specSnippets from "./spec-snippets.json";
import { HCI_COMMANDS, HCI_EVENTS, LE_META_EVENTS } from "./hci-opcodes";

interface AttErrorSnippet {
  name: string;
  description: string;
  spec_ref: { doc: string; section: string; section_name: string; page: number };
}
interface AttOpcodeSnippet {
  name: string;
  description: string;
  spec_ref: { doc: string; section: string; section_name: string };
}
interface HciErrorSnippet {
  description: string;
}
interface HciCodedSnippet {
  description: string;
  spec_ref?: { doc: string; section: string };
}

const SPEC = specSnippets as unknown as {
  att_error_codes: Record<string, AttErrorSnippet>;
  att_opcodes: Record<string, AttOpcodeSnippet>;
  hci_error_codes: Record<string, HciErrorSnippet>;
  hci_commands: Record<string, HciCodedSnippet>;
  hci_events: Record<string, HciCodedSnippet>;
  le_meta_events: Record<string, HciCodedSnippet>;
};

const codeKey = (code: number) => `0x${code.toString(16).padStart(2, "0")}`;
const codeKey4 = (code: number) => `0x${code.toString(16).padStart(4, "0")}`;

/**
 * Return a formatted tooltip string with the spec-defined description and citation
 * for an ATT error code. Returns undefined if the code is outside the documented range.
 */
export function attErrorCodeSnippet(code: number): string | undefined {
  const entry = SPEC.att_error_codes[codeKey(code)];
  if (!entry) return undefined;
  return `${entry.name} — ${entry.description} (${entry.spec_ref.doc} §${entry.spec_ref.section})`;
}

/**
 * Return a formatted tooltip string for an ATT opcode (Read Request, Write Request, etc.).
 * Returns undefined for opcodes not documented in spec-snippets.json.
 */
export function attOpcodeSnippet(opcode: number): string | undefined {
  const entry = SPEC.att_opcodes[codeKey(opcode)];
  if (!entry) return undefined;
  return `${entry.name} — ${entry.description} (${entry.spec_ref.doc} §${entry.spec_ref.section})`;
}

/**
 * Return a formatted tooltip string for an HCI status / error code.
 * Combines the name from HCI_ERROR_CODES with the spec-defined description.
 * Returns undefined for codes not documented in spec-snippets.json.
 */
export function hciErrorCodeSnippet(code: number): string | undefined {
  const entry = SPEC.hci_error_codes[codeKey(code)];
  if (!entry) return undefined;
  const name = HCI_ERROR_CODES[code] ?? "Unknown";
  return `${name} — ${entry.description} (Core_v6.3 Vol 1 Part F)`;
}

/** Tooltip for an HCI command opcode (e.g., 0x2006 LE Set Advertising Parameters). */
export function hciCommandSnippet(opcode: number): string | undefined {
  const entry = SPEC.hci_commands[codeKey4(opcode)];
  if (!entry) return undefined;
  const name = HCI_COMMANDS[opcode] ?? "HCI Command";
  const ref = entry.spec_ref ? ` (${entry.spec_ref.doc} §${entry.spec_ref.section})` : "";
  return `${name} — ${entry.description}${ref}`;
}

/** Tooltip for an HCI event code (e.g., 0x05 Disconnection Complete). */
export function hciEventSnippet(eventCode: number): string | undefined {
  const entry = SPEC.hci_events[codeKey(eventCode)];
  if (!entry) return undefined;
  const name = HCI_EVENTS[eventCode] ?? "HCI Event";
  const ref = entry.spec_ref ? ` (${entry.spec_ref.doc} §${entry.spec_ref.section})` : "";
  return `${name} — ${entry.description}${ref}`;
}

/** Tooltip for an LE Meta subevent code (e.g., 0x01 LE Connection Complete). */
export function leMetaEventSnippet(subevent: number): string | undefined {
  const entry = SPEC.le_meta_events[codeKey(subevent)];
  if (!entry) return undefined;
  const name = LE_META_EVENTS[subevent] ?? "LE Subevent";
  const ref = entry.spec_ref ? ` (${entry.spec_ref.doc} §${entry.spec_ref.section})` : "";
  return `${name} — ${entry.description}${ref}`;
}
