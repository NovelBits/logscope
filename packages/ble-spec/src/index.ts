/**
 * Public surface of @novelbits/ble-spec.
 * Phase 1 ships HCI / ATT / SMP error codes and Company Identifiers.
 * Later phases add UUIDs, AD types, the GATT Specification Supplement, and
 * clickable spec section URLs.
 */

export type { ErrorCodeEntry, CompanyIdEntry } from "./types";

export { HCI_ERROR_CODES, lookupHciError } from "./generated/hci-error-codes";
