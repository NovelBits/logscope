/**
 * Shared TypeScript types for the BLE spec database.
 * Generated modules import these.
 */

export interface ErrorCodeEntry {
  /** Hex value, e.g. 0x05 */
  code: number;
  /** Official spec name, e.g. "Authentication Failure" */
  name: string;
  /**
   * Bluetooth Core Spec section reference, e.g.
   * "Core Spec v6.3, Vol 1, Part F, §2.5".
   * For error codes whose canonical home is the Core Spec text (not the
   * SIG's machine-readable YAML), this is curated by Novel Bits.
   */
  specRef: string;
}

export interface CompanyIdEntry {
  /** Hex value, e.g. 0x004C */
  code: number;
  /** Canonical name as published by Bluetooth SIG, e.g. "Apple, Inc." */
  name: string;
}
