/**
 * Public surface of @novelbits/ble-spec.
 * Phase 1 ships HCI / ATT / SMP error codes and Company Identifiers.
 * The att-decode-full sprint adds SIG-mirror Service / Characteristic /
 * Descriptor UUID resolution.
 * Later phases add AD types and clickable spec section URLs.
 */

export type { ErrorCodeEntry } from "./types";

export { HCI_ERROR_CODES, lookupHciError } from "./generated/hci-error-codes";
export { ATT_ERROR_CODES, lookupAttError } from "./generated/att-error-codes";
export { SMP_ERROR_CODES, lookupSmpError } from "./generated/smp-error-codes";
export { BLUETOOTH_COMPANY_IDS, lookupCompanyId } from "./generated/company-ids";
export { SERVICE_UUIDS, lookupServiceUuid } from "./generated/service-uuids";
export { CHARACTERISTIC_UUIDS, lookupCharacteristicUuid } from "./generated/characteristic-uuids";
export { DESCRIPTOR_UUIDS, lookupDescriptorUuid } from "./generated/descriptor-uuids";
