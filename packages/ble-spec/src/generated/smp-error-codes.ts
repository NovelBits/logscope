// GENERATED FILE — DO NOT EDIT BY HAND.
// Source: packages/ble-spec/data/novel-bits-curated/smp_error_codes.yaml
// Regenerate with: npm run gen:ble-spec
//
// SMP Pairing Failed Reason Codes (returned in the Reason field of SMP Pairing Failed PDUs).
// Spec version: 6.3
// Last updated: 2026-05-13

import type { ErrorCodeEntry } from "../types";

export const SMP_ERROR_CODES: Record<number, ErrorCodeEntry> = {
  0x01: { code: 0x01, name: "Passkey Entry Failed", specRef: "Core Spec v6.3, Vol 3, Part H, §3.5.5" },
  0x02: { code: 0x02, name: "OOB Not Available", specRef: "Core Spec v6.3, Vol 3, Part H, §3.5.5" },
  0x03: { code: 0x03, name: "Authentication Requirements", specRef: "Core Spec v6.3, Vol 3, Part H, §3.5.5" },
  0x04: { code: 0x04, name: "Confirm Value Failed", specRef: "Core Spec v6.3, Vol 3, Part H, §3.5.5" },
  0x05: { code: 0x05, name: "Pairing Not Supported", specRef: "Core Spec v6.3, Vol 3, Part H, §3.5.5" },
  0x06: { code: 0x06, name: "Encryption Key Size", specRef: "Core Spec v6.3, Vol 3, Part H, §3.5.5" },
  0x07: { code: 0x07, name: "Command Not Supported", specRef: "Core Spec v6.3, Vol 3, Part H, §3.5.5" },
  0x08: { code: 0x08, name: "Unspecified Reason", specRef: "Core Spec v6.3, Vol 3, Part H, §3.5.5" },
  0x09: { code: 0x09, name: "Repeated Attempts", specRef: "Core Spec v6.3, Vol 3, Part H, §3.5.5" },
  0x0a: { code: 0x0a, name: "Invalid Parameters", specRef: "Core Spec v6.3, Vol 3, Part H, §3.5.5" },
  0x0b: { code: 0x0b, name: "DHKey Check Failed", specRef: "Core Spec v6.3, Vol 3, Part H, §3.5.5" },
  0x0c: { code: 0x0c, name: "Numeric Comparison Failed", specRef: "Core Spec v6.3, Vol 3, Part H, §3.5.5" },
  0x0d: { code: 0x0d, name: "BR/EDR Pairing In Progress", specRef: "Core Spec v6.3, Vol 3, Part H, §3.5.5" },
  0x0e: { code: 0x0e, name: "Cross-Transport Key Derivation/Generation Not Allowed", specRef: "Core Spec v6.3, Vol 3, Part H, §3.5.5" },
  0x0f: { code: 0x0f, name: "Key Rejected", specRef: "Core Spec v6.3, Vol 3, Part H, §3.5.5" },
};

export function lookupSmpError(code: number): ErrorCodeEntry | null {
  return SMP_ERROR_CODES[code] ?? null;
}
