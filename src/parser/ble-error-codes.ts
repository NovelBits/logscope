// Canonical Bluetooth LE error code tables, sourced from the Bluetooth
// Core Specification. Each entry includes the official name and a spec
// section reference for inline citation in the LogScope HCI decoder.
//
// Citations target Core Spec v6.3 (latest stable at this writing).
// The error code names and numeric values have been stable across
// v6.0 through v6.3; section numbers are also stable since v6.0 for
// these tables. When the spec is updated, the section refs should be
// re-verified, but day-to-day updates of the spec do not invalidate
// the codes themselves.

export interface ErrorCodeEntry {
  name: string;
  /** Spec section reference, e.g., "Core Spec v6.3, Vol 1, Part F, §2.x" */
  specRef: string;
}

/**
 * HCI Error Codes (returned in the Status field of HCI events and
 * Command Complete events). Source: Bluetooth Core Specification v6.3,
 * Vol 1, Part F ("Controller Error Codes"), §1.3 (list) and §2.x
 * (per-code descriptions).
 *
 * Reserved/no-longer-used slots intentionally omitted: 0x2B, 0x31, 0x33,
 * 0x39, 0x3F.
 */
export const HCI_ERROR_CODES: Record<number, ErrorCodeEntry> = {
  0x00: { name: "Success", specRef: "Core Spec v6.3, Vol 1, Part F, §1.3" },
  0x01: { name: "Unknown HCI Command", specRef: "Core Spec v6.3, Vol 1, Part F, §2.1" },
  0x02: { name: "Unknown Connection Identifier", specRef: "Core Spec v6.3, Vol 1, Part F, §2.2" },
  0x03: { name: "Hardware Failure", specRef: "Core Spec v6.3, Vol 1, Part F, §2.3" },
  0x04: { name: "Page Timeout", specRef: "Core Spec v6.3, Vol 1, Part F, §2.4" },
  0x05: { name: "Authentication Failure", specRef: "Core Spec v6.3, Vol 1, Part F, §2.5" },
  0x06: { name: "PIN or Key Missing", specRef: "Core Spec v6.3, Vol 1, Part F, §2.6" },
  0x07: { name: "Memory Capacity Exceeded", specRef: "Core Spec v6.3, Vol 1, Part F, §2.7" },
  0x08: { name: "Connection Timeout", specRef: "Core Spec v6.3, Vol 1, Part F, §2.8" },
  0x09: { name: "Connection Limit Exceeded", specRef: "Core Spec v6.3, Vol 1, Part F, §2.9" },
  0x0a: { name: "Synchronous Connection Limit To A Device Exceeded", specRef: "Core Spec v6.3, Vol 1, Part F, §2.10" },
  0x0b: { name: "Connection Already Exists", specRef: "Core Spec v6.3, Vol 1, Part F, §2.11" },
  0x0c: { name: "Command Disallowed", specRef: "Core Spec v6.3, Vol 1, Part F, §2.12" },
  0x0d: { name: "Connection Rejected due to Limited Resources", specRef: "Core Spec v6.3, Vol 1, Part F, §2.13" },
  0x0e: { name: "Connection Rejected Due To Security Reasons", specRef: "Core Spec v6.3, Vol 1, Part F, §2.14" },
  0x0f: { name: "Connection Rejected due to Unacceptable BD_ADDR", specRef: "Core Spec v6.3, Vol 1, Part F, §2.15" },
  0x10: { name: "Connection Accept Timeout Exceeded", specRef: "Core Spec v6.3, Vol 1, Part F, §2.16" },
  0x11: { name: "Unsupported Feature or Parameter Value", specRef: "Core Spec v6.3, Vol 1, Part F, §2.17" },
  0x12: { name: "Invalid HCI Command Parameters", specRef: "Core Spec v6.3, Vol 1, Part F, §2.18" },
  0x13: { name: "Remote User Terminated Connection", specRef: "Core Spec v6.3, Vol 1, Part F, §2.19" },
  0x14: { name: "Remote Device Terminated Connection due to Low Resources", specRef: "Core Spec v6.3, Vol 1, Part F, §2.20" },
  0x15: { name: "Remote Device Terminated Connection due to Power Off", specRef: "Core Spec v6.3, Vol 1, Part F, §2.21" },
  0x16: { name: "Connection Terminated By Local Host", specRef: "Core Spec v6.3, Vol 1, Part F, §2.22" },
  0x17: { name: "Repeated Attempts", specRef: "Core Spec v6.3, Vol 1, Part F, §2.23" },
  0x18: { name: "Pairing Not Allowed", specRef: "Core Spec v6.3, Vol 1, Part F, §2.24" },
  0x19: { name: "Unknown LMP PDU", specRef: "Core Spec v6.3, Vol 1, Part F, §2.25" },
  0x1a: { name: "Unsupported Remote Feature / Unsupported LMP Feature", specRef: "Core Spec v6.3, Vol 1, Part F, §2.26" },
  0x1b: { name: "SCO Offset Rejected", specRef: "Core Spec v6.3, Vol 1, Part F, §2.27" },
  0x1c: { name: "SCO Interval Rejected", specRef: "Core Spec v6.3, Vol 1, Part F, §2.28" },
  0x1d: { name: "SCO Air Mode Rejected", specRef: "Core Spec v6.3, Vol 1, Part F, §2.29" },
  0x1e: { name: "Invalid LMP Parameters / Invalid LL Parameters", specRef: "Core Spec v6.3, Vol 1, Part F, §2.30" },
  0x1f: { name: "Unspecified Error", specRef: "Core Spec v6.3, Vol 1, Part F, §2.31" },
  0x20: { name: "Unsupported LMP Parameter Value / Unsupported LL Parameter Value", specRef: "Core Spec v6.3, Vol 1, Part F, §2.32" },
  0x21: { name: "Role Change Not Allowed", specRef: "Core Spec v6.3, Vol 1, Part F, §2.33" },
  0x22: { name: "LMP Response Timeout / LL Response Timeout", specRef: "Core Spec v6.3, Vol 1, Part F, §2.34" },
  0x23: { name: "LMP Error Transaction Collision / LL Procedure Collision", specRef: "Core Spec v6.3, Vol 1, Part F, §2.35" },
  0x24: { name: "LMP PDU Not Allowed", specRef: "Core Spec v6.3, Vol 1, Part F, §2.36" },
  0x25: { name: "Encryption Mode Not Acceptable", specRef: "Core Spec v6.3, Vol 1, Part F, §2.37" },
  0x26: { name: "Link Key cannot be Changed", specRef: "Core Spec v6.3, Vol 1, Part F, §2.38" },
  0x27: { name: "Requested QoS Not Supported", specRef: "Core Spec v6.3, Vol 1, Part F, §2.39" },
  0x28: { name: "Instant Passed", specRef: "Core Spec v6.3, Vol 1, Part F, §2.40" },
  0x29: { name: "Pairing With Unit Key Not Supported", specRef: "Core Spec v6.3, Vol 1, Part F, §2.41" },
  0x2a: { name: "Different Transaction Collision", specRef: "Core Spec v6.3, Vol 1, Part F, §2.42" },
  0x2c: { name: "QoS Unacceptable Parameter", specRef: "Core Spec v6.3, Vol 1, Part F, §2.43" },
  0x2d: { name: "QoS Rejected", specRef: "Core Spec v6.3, Vol 1, Part F, §2.44" },
  0x2e: { name: "Channel Classification Not Supported", specRef: "Core Spec v6.3, Vol 1, Part F, §2.45" },
  0x2f: { name: "Insufficient Security", specRef: "Core Spec v6.3, Vol 1, Part F, §2.46" },
  0x30: { name: "Parameter Out Of Mandatory Range", specRef: "Core Spec v6.3, Vol 1, Part F, §2.47" },
  0x32: { name: "Role Switch Pending", specRef: "Core Spec v6.3, Vol 1, Part F, §2.48" },
  0x34: { name: "Reserved Slot Violation", specRef: "Core Spec v6.3, Vol 1, Part F, §2.49" },
  0x35: { name: "Role Switch Failed", specRef: "Core Spec v6.3, Vol 1, Part F, §2.50" },
  0x36: { name: "Extended Inquiry Response Too Large", specRef: "Core Spec v6.3, Vol 1, Part F, §2.51" },
  0x37: { name: "Secure Simple Pairing Not Supported By Host", specRef: "Core Spec v6.3, Vol 1, Part F, §2.52" },
  0x38: { name: "Host Busy - Pairing", specRef: "Core Spec v6.3, Vol 1, Part F, §2.53" },
  0x3a: { name: "Controller Busy", specRef: "Core Spec v6.3, Vol 1, Part F, §2.55" },
  0x3b: { name: "Unacceptable Connection Parameters", specRef: "Core Spec v6.3, Vol 1, Part F, §2.56" },
  0x3c: { name: "Advertising Timeout", specRef: "Core Spec v6.3, Vol 1, Part F, §2.57" },
  0x3d: { name: "Connection Terminated due to MIC Failure", specRef: "Core Spec v6.3, Vol 1, Part F, §2.58" },
  0x3e: { name: "Connection Failed to be Established / Synchronization Timeout", specRef: "Core Spec v6.3, Vol 1, Part F, §2.59" },
  0x40: { name: "Coarse Clock Adjustment Rejected but Will Try to Adjust Using Clock Dragging", specRef: "Core Spec v6.3, Vol 1, Part F, §2.61" },
  0x41: { name: "Type0 Submap Not Defined", specRef: "Core Spec v6.3, Vol 1, Part F, §2.62" },
  0x42: { name: "Unknown Advertising Identifier", specRef: "Core Spec v6.3, Vol 1, Part F, §2.63" },
  0x43: { name: "Limit Reached", specRef: "Core Spec v6.3, Vol 1, Part F, §2.64" },
  0x44: { name: "Operation Cancelled by Host", specRef: "Core Spec v6.3, Vol 1, Part F, §2.65" },
  0x45: { name: "Packet Too Long", specRef: "Core Spec v6.3, Vol 1, Part F, §2.66" },
  0x46: { name: "Too Late", specRef: "Core Spec v6.3, Vol 1, Part F, §2.67" },
  0x47: { name: "Too Early", specRef: "Core Spec v6.3, Vol 1, Part F, §2.68" },
};

/**
 * ATT Error Codes (returned in the Error Code field of an ATT_ERROR_RSP
 * PDU). Source: Bluetooth Core Specification v6.3, Vol 3, Part F,
 * §3.4.1.1 (Error Response), Table 3.4.
 *
 * Reserved ranges:
 *   0x14-0x7F  reserved for future use
 *   0x80-0x9F  application error codes defined by higher-layer profiles
 *   0xA0-0xDF  reserved for future use
 *   0xE0-0xFF  Common Profile and Service Error Codes (Core Spec
 *              Supplement Part B)
 */
export const ATT_ERROR_CODES: Record<number, ErrorCodeEntry> = {
  0x01: { name: "Invalid Handle", specRef: "Core Spec v6.3, Vol 3, Part F, §3.4.1.1" },
  0x02: { name: "Read Not Permitted", specRef: "Core Spec v6.3, Vol 3, Part F, §3.4.1.1" },
  0x03: { name: "Write Not Permitted", specRef: "Core Spec v6.3, Vol 3, Part F, §3.4.1.1" },
  0x04: { name: "Invalid PDU", specRef: "Core Spec v6.3, Vol 3, Part F, §3.4.1.1" },
  0x05: { name: "Insufficient Authentication", specRef: "Core Spec v6.3, Vol 3, Part F, §3.4.1.1" },
  0x06: { name: "Request Not Supported", specRef: "Core Spec v6.3, Vol 3, Part F, §3.4.1.1" },
  0x07: { name: "Invalid Offset", specRef: "Core Spec v6.3, Vol 3, Part F, §3.4.1.1" },
  0x08: { name: "Insufficient Authorization", specRef: "Core Spec v6.3, Vol 3, Part F, §3.4.1.1" },
  0x09: { name: "Prepare Queue Full", specRef: "Core Spec v6.3, Vol 3, Part F, §3.4.1.1" },
  0x0a: { name: "Attribute Not Found", specRef: "Core Spec v6.3, Vol 3, Part F, §3.4.1.1" },
  0x0b: { name: "Attribute Not Long", specRef: "Core Spec v6.3, Vol 3, Part F, §3.4.1.1" },
  0x0c: { name: "Encryption Key Size Too Short", specRef: "Core Spec v6.3, Vol 3, Part F, §3.4.1.1" },
  0x0d: { name: "Invalid Attribute Value Length", specRef: "Core Spec v6.3, Vol 3, Part F, §3.4.1.1" },
  0x0e: { name: "Unlikely Error", specRef: "Core Spec v6.3, Vol 3, Part F, §3.4.1.1" },
  0x0f: { name: "Insufficient Encryption", specRef: "Core Spec v6.3, Vol 3, Part F, §3.4.1.1" },
  0x10: { name: "Unsupported Group Type", specRef: "Core Spec v6.3, Vol 3, Part F, §3.4.1.1" },
  0x11: { name: "Insufficient Resources", specRef: "Core Spec v6.3, Vol 3, Part F, §3.4.1.1" },
  0x12: { name: "Database Out Of Sync", specRef: "Core Spec v6.3, Vol 3, Part F, §3.4.1.1" },
  0x13: { name: "Value Not Allowed", specRef: "Core Spec v6.3, Vol 3, Part F, §3.4.1.1" },
};

/**
 * SMP Pairing Failed Reason Codes (returned in the Reason field of an
 * SMP Pairing Failed PDU). Source: Bluetooth Core Specification v6.3,
 * Vol 3, Part H, §3.5.5 (Pairing Failed), Table 3.7.
 *
 * Codes 0x10-0xFF are reserved for future use.
 */
export const SMP_ERROR_CODES: Record<number, ErrorCodeEntry> = {
  0x01: { name: "Passkey Entry Failed", specRef: "Core Spec v6.3, Vol 3, Part H, §3.5.5" },
  0x02: { name: "OOB Not Available", specRef: "Core Spec v6.3, Vol 3, Part H, §3.5.5" },
  0x03: { name: "Authentication Requirements", specRef: "Core Spec v6.3, Vol 3, Part H, §3.5.5" },
  0x04: { name: "Confirm Value Failed", specRef: "Core Spec v6.3, Vol 3, Part H, §3.5.5" },
  0x05: { name: "Pairing Not Supported", specRef: "Core Spec v6.3, Vol 3, Part H, §3.5.5" },
  0x06: { name: "Encryption Key Size", specRef: "Core Spec v6.3, Vol 3, Part H, §3.5.5" },
  0x07: { name: "Command Not Supported", specRef: "Core Spec v6.3, Vol 3, Part H, §3.5.5" },
  0x08: { name: "Unspecified Reason", specRef: "Core Spec v6.3, Vol 3, Part H, §3.5.5" },
  0x09: { name: "Repeated Attempts", specRef: "Core Spec v6.3, Vol 3, Part H, §3.5.5" },
  0x0a: { name: "Invalid Parameters", specRef: "Core Spec v6.3, Vol 3, Part H, §3.5.5" },
  0x0b: { name: "DHKey Check Failed", specRef: "Core Spec v6.3, Vol 3, Part H, §3.5.5" },
  0x0c: { name: "Numeric Comparison Failed", specRef: "Core Spec v6.3, Vol 3, Part H, §3.5.5" },
  0x0d: { name: "BR/EDR Pairing In Progress", specRef: "Core Spec v6.3, Vol 3, Part H, §3.5.5" },
  0x0e: { name: "Cross-Transport Key Derivation/Generation Not Allowed", specRef: "Core Spec v6.3, Vol 3, Part H, §3.5.5" },
  0x0f: { name: "Key Rejected", specRef: "Core Spec v6.3, Vol 3, Part H, §3.5.5" },
};

/** Look up an HCI error code, returning name + spec ref, or null if unknown. */
export function lookupHciError(code: number): ErrorCodeEntry | null {
  return HCI_ERROR_CODES[code] ?? null;
}

/** Look up an ATT error code, returning name + spec ref, or null if unknown. */
export function lookupAttError(code: number): ErrorCodeEntry | null {
  return ATT_ERROR_CODES[code] ?? null;
}

/** Look up an SMP error code, returning name + spec ref, or null if unknown. */
export function lookupSmpError(code: number): ErrorCodeEntry | null {
  return SMP_ERROR_CODES[code] ?? null;
}
