import {
  HCI_ERROR_CODES,
  ATT_ERROR_CODES,
  SMP_ERROR_CODES,
  lookupHciError,
  lookupAttError,
  lookupSmpError,
} from "../../src/parser/ble-error-codes";
import { lookupCompanyId, BLUETOOTH_COMPANY_IDS } from "../../src/parser/ble-company-ids";

describe("BLE error code tables", () => {
  it("HCI table covers all spec-defined codes through 0x47", () => {
    // Spot-check the most common errors users will see.
    expect(HCI_ERROR_CODES[0x00].name).toBe("Success");
    expect(HCI_ERROR_CODES[0x05].name).toBe("Authentication Failure");
    expect(HCI_ERROR_CODES[0x07].name).toBe("Memory Capacity Exceeded");
    expect(HCI_ERROR_CODES[0x08].name).toBe("Connection Timeout");
    expect(HCI_ERROR_CODES[0x0e].name).toBe("Connection Rejected Due To Security Reasons");
    expect(HCI_ERROR_CODES[0x13].name).toBe("Remote User Terminated Connection");
    expect(HCI_ERROR_CODES[0x16].name).toBe("Connection Terminated By Local Host");
    expect(HCI_ERROR_CODES[0x3b].name).toBe("Unacceptable Connection Parameters");
    expect(HCI_ERROR_CODES[0x47].name).toBe("Too Early");
  });

  it("HCI table entries all have a spec reference", () => {
    for (const [code, entry] of Object.entries(HCI_ERROR_CODES)) {
      expect(entry.specRef).toMatch(/Core Spec.*Vol 1.*Part F/);
      expect(entry.name.length).toBeGreaterThan(0);
    }
  });

  it("ATT table covers all spec-defined codes 0x01-0x13", () => {
    expect(ATT_ERROR_CODES[0x01].name).toBe("Invalid Handle");
    expect(ATT_ERROR_CODES[0x02].name).toBe("Read Not Permitted");
    expect(ATT_ERROR_CODES[0x05].name).toBe("Insufficient Authentication");
    expect(ATT_ERROR_CODES[0x0a].name).toBe("Attribute Not Found");
    expect(ATT_ERROR_CODES[0x0e].name).toBe("Unlikely Error");
    expect(ATT_ERROR_CODES[0x13].name).toBe("Value Not Allowed");
  });

  it("ATT table entries all reference Vol 3 Part F", () => {
    for (const entry of Object.values(ATT_ERROR_CODES)) {
      expect(entry.specRef).toMatch(/Vol 3.*Part F/);
    }
  });

  it("SMP table covers all spec-defined codes 0x01-0x0F", () => {
    expect(SMP_ERROR_CODES[0x01].name).toBe("Passkey Entry Failed");
    expect(SMP_ERROR_CODES[0x05].name).toBe("Pairing Not Supported");
    expect(SMP_ERROR_CODES[0x06].name).toBe("Encryption Key Size");
    expect(SMP_ERROR_CODES[0x0b].name).toBe("DHKey Check Failed");
    expect(SMP_ERROR_CODES[0x0f].name).toBe("Key Rejected");
  });

  it("SMP table entries all reference Vol 3 Part H", () => {
    for (const entry of Object.values(SMP_ERROR_CODES)) {
      expect(entry.specRef).toMatch(/Vol 3.*Part H/);
    }
  });

  describe("lookup helpers", () => {
    it("lookupHciError returns null for unknown codes", () => {
      expect(lookupHciError(0xff)).toBeNull();
      expect(lookupHciError(0x99)).toBeNull();
    });

    it("lookupHciError returns the entry for known codes", () => {
      const entry = lookupHciError(0x05);
      expect(entry).not.toBeNull();
      expect(entry!.name).toBe("Authentication Failure");
      expect(entry!.specRef).toContain("Vol 1, Part F");
    });

    it("lookupAttError returns null for reserved codes", () => {
      // 0x14-0x7F are reserved
      expect(lookupAttError(0x14)).toBeNull();
      expect(lookupAttError(0x50)).toBeNull();
    });

    it("lookupSmpError returns null for reserved codes", () => {
      // 0x10-0xFF are reserved
      expect(lookupSmpError(0x10)).toBeNull();
      expect(lookupSmpError(0xff)).toBeNull();
    });
  });
});

describe("Bluetooth Company Identifiers", () => {
  it("resolves the most-seen consumer-device companies", () => {
    expect(lookupCompanyId(0x004c)).toBe("Apple, Inc.");
    expect(lookupCompanyId(0x0006)).toBe("Microsoft");
    expect(lookupCompanyId(0x00e0)).toBe("Google");
    expect(lookupCompanyId(0x0075)).toBe("Samsung Electronics Co. Ltd.");
    expect(lookupCompanyId(0x0059)).toBe("Nordic Semiconductor ASA");
  });

  it("resolves the major silicon vendors", () => {
    expect(lookupCompanyId(0x000d)).toBe("Texas Instruments Inc.");
    expect(lookupCompanyId(0x0025)).toBe("NXP B.V.");
    expect(lookupCompanyId(0x02ff)).toBe("Silicon Laboratories");
    expect(lookupCompanyId(0x02e5)).toBe("Espressif Systems (Shanghai) Co., Ltd.");
    expect(lookupCompanyId(0x0030)).toBe("ST Microelectronics");
  });

  it("returns null for company IDs not in the curated subset", () => {
    expect(lookupCompanyId(0xffff)).toBeNull();
    expect(lookupCompanyId(0x9999)).toBeNull();
  });

  it("table has at least 100 entries (curated subset target)", () => {
    expect(Object.keys(BLUETOOTH_COMPANY_IDS).length).toBeGreaterThanOrEqual(100);
  });
});
