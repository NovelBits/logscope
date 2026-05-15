// GENERATED FILE — DO NOT EDIT BY HAND.
// Source: packages/ble-spec/data/sig-mirror/descriptor_uuids.yaml
// Regenerate with: npm run gen:ble-spec
//
// Bluetooth SIG-defined 16-bit Descriptor UUIDs (mirrors the SIG bitbucket assigned-numbers tree).
// Upstream: https://bitbucket.org/bluetooth-SIG/public/raw/main/assigned_numbers/uuids/descriptors.yaml
// Last updated: 2026-05-14
// Upstream commit: ad6172938054

export const DESCRIPTOR_UUIDS: Record<number, string> = {
  0x2900: "Characteristic Extended Properties",
  0x2901: "Characteristic User Description",
  0x2902: "Client Characteristic Configuration",
  0x2903: "Server Characteristic Configuration",
  0x2904: "Characteristic Presentation Format",
  0x2905: "Characteristic Aggregate Format",
  0x2906: "Valid Range",
  0x2907: "External Report Reference",
  0x2908: "Report Reference",
  0x2909: "Number of Digitals",
  0x290A: "Value Trigger Setting",
  0x290B: "Environmental Sensing Configuration",
  0x290C: "Environmental Sensing Measurement",
  0x290D: "Environmental Sensing Trigger Setting",
  0x290E: "Time Trigger Setting",
  0x290F: "Complete BR-EDR Transport Block Data",
  0x2910: "Observation Schedule",
  0x2911: "Valid Range and Accuracy",
  0x2912: "Measurement Description",
  0x2913: "Manufacturer Limits",
  0x2914: "Process Tolerances",
  0x2915: "IMD Trigger Setting",
  0x2916: "Cooking Sensor Info",
  0x2917: "Cooking Trigger Setting",
};

export function lookupDescriptorUuid(code: number): string | null {
  return DESCRIPTOR_UUIDS[code] ?? null;
}
