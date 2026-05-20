// GENERATED FILE — DO NOT EDIT BY HAND.
// Source: packages/ble-spec/data/novel-bits-curated/att_error_codes.yaml
// Regenerate with: npm run gen:ble-spec
//
// ATT Error Codes (returned in the Error Code field of ATT_ERROR_RSP PDUs).
// Spec version: 6.3
// Last updated: 2026-05-13

import type { ErrorCodeEntry } from "../types";

export const ATT_ERROR_CODES: Record<number, ErrorCodeEntry> = {
  0x01: { code: 0x01, name: "Invalid Handle", specRef: "Core Spec v6.3, Vol 3, Part F, §3.4.1.1" },
  0x02: { code: 0x02, name: "Read Not Permitted", specRef: "Core Spec v6.3, Vol 3, Part F, §3.4.1.1" },
  0x03: { code: 0x03, name: "Write Not Permitted", specRef: "Core Spec v6.3, Vol 3, Part F, §3.4.1.1" },
  0x04: { code: 0x04, name: "Invalid PDU", specRef: "Core Spec v6.3, Vol 3, Part F, §3.4.1.1" },
  0x05: { code: 0x05, name: "Insufficient Authentication", specRef: "Core Spec v6.3, Vol 3, Part F, §3.4.1.1" },
  0x06: { code: 0x06, name: "Request Not Supported", specRef: "Core Spec v6.3, Vol 3, Part F, §3.4.1.1" },
  0x07: { code: 0x07, name: "Invalid Offset", specRef: "Core Spec v6.3, Vol 3, Part F, §3.4.1.1" },
  0x08: { code: 0x08, name: "Insufficient Authorization", specRef: "Core Spec v6.3, Vol 3, Part F, §3.4.1.1" },
  0x09: { code: 0x09, name: "Prepare Queue Full", specRef: "Core Spec v6.3, Vol 3, Part F, §3.4.1.1" },
  0x0a: { code: 0x0a, name: "Attribute Not Found", specRef: "Core Spec v6.3, Vol 3, Part F, §3.4.1.1" },
  0x0b: { code: 0x0b, name: "Attribute Not Long", specRef: "Core Spec v6.3, Vol 3, Part F, §3.4.1.1" },
  0x0c: { code: 0x0c, name: "Encryption Key Size Too Short", specRef: "Core Spec v6.3, Vol 3, Part F, §3.4.1.1" },
  0x0d: { code: 0x0d, name: "Invalid Attribute Value Length", specRef: "Core Spec v6.3, Vol 3, Part F, §3.4.1.1" },
  0x0e: { code: 0x0e, name: "Unlikely Error", specRef: "Core Spec v6.3, Vol 3, Part F, §3.4.1.1" },
  0x0f: { code: 0x0f, name: "Insufficient Encryption", specRef: "Core Spec v6.3, Vol 3, Part F, §3.4.1.1" },
  0x10: { code: 0x10, name: "Unsupported Group Type", specRef: "Core Spec v6.3, Vol 3, Part F, §3.4.1.1" },
  0x11: { code: 0x11, name: "Insufficient Resources", specRef: "Core Spec v6.3, Vol 3, Part F, §3.4.1.1" },
  0x12: { code: 0x12, name: "Database Out Of Sync", specRef: "Core Spec v6.3, Vol 3, Part F, §3.4.1.1" },
  0x13: { code: 0x13, name: "Value Not Allowed", specRef: "Core Spec v6.3, Vol 3, Part F, §3.4.1.1" },
};

export function lookupAttError(code: number): ErrorCodeEntry | null {
  return ATT_ERROR_CODES[code] ?? null;
}
