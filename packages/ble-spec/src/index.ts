/**
 * Public surface of @novelbits/ble-spec.
 * Phase 1 ships HCI / ATT / SMP error codes and Company Identifiers.
 * Later phases add UUIDs, AD types, the GATT Specification Supplement, and
 * clickable spec section URLs.
 */

export type { ErrorCodeEntry } from "./types";

export { HCI_ERROR_CODES, lookupHciError } from "./generated/hci-error-codes";
export { ATT_ERROR_CODES, lookupAttError } from "./generated/att-error-codes";
export { SMP_ERROR_CODES, lookupSmpError } from "./generated/smp-error-codes";
export { BLUETOOTH_COMPANY_IDS, lookupCompanyId } from "./generated/company-ids";
