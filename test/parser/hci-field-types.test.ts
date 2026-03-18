import {
  formatAddress,
  formatAddressType,
  formatPhyName,
  formatRole,
  formatInterval,
  formatTimeout,
  hciErrorCode,
  attOpcodeName,
} from "../../src/parser/hci-field-types";

describe("formatAddress", () => {
  it("formats a 6-byte LE address in reverse order", () => {
    // Bytes in buffer (little-endian): AA BB CC DD EE FF
    // Expected output (big-endian): FF:EE:DD:CC:BB:AA
    const buf = Buffer.from([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]);
    expect(formatAddress(buf, 0)).toBe("FF:EE:DD:CC:BB:AA");
  });

  it("respects offset into the buffer", () => {
    const buf = Buffer.from([0x00, 0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66]);
    expect(formatAddress(buf, 2)).toBe("66:55:44:33:22:11");
  });
});

describe("formatAddressType", () => {
  it("returns Public for 0x00", () => {
    expect(formatAddressType(0x00)).toBe("Public");
  });

  it("returns Random for 0x01", () => {
    expect(formatAddressType(0x01)).toBe("Random");
  });

  it("returns Unknown for unrecognized type", () => {
    expect(formatAddressType(0x05)).toBe("Unknown (0x05)");
  });
});

describe("formatPhyName", () => {
  it("returns 1M for phy 1", () => {
    expect(formatPhyName(1)).toBe("1M");
  });

  it("returns 2M for phy 2", () => {
    expect(formatPhyName(2)).toBe("2M");
  });

  it("returns Coded for phy 3", () => {
    expect(formatPhyName(3)).toBe("Coded");
  });

  it("returns Unknown for unrecognized phy", () => {
    expect(formatPhyName(99)).toMatch(/^Unknown/);
  });
});

describe("formatRole", () => {
  it("returns Central for 0x00", () => {
    expect(formatRole(0x00)).toBe("Central");
  });

  it("returns Peripheral for 0x01", () => {
    expect(formatRole(0x01)).toBe("Peripheral");
  });
});

describe("formatInterval", () => {
  it("converts raw interval to ms (multiply by 1.25)", () => {
    expect(formatInterval(24)).toBe("24 (30.00 ms)");
  });

  it("handles zero", () => {
    expect(formatInterval(0)).toBe("0 (0.00 ms)");
  });
});

describe("formatTimeout", () => {
  it("converts raw timeout to ms (multiply by 10)", () => {
    expect(formatTimeout(72)).toBe("72 (720 ms)");
  });

  it("handles zero", () => {
    expect(formatTimeout(0)).toBe("0 (0 ms)");
  });
});

describe("hciErrorCode", () => {
  it("returns Success for 0x00", () => {
    expect(hciErrorCode(0x00)).toBe("Success");
  });

  it("returns known error string", () => {
    expect(hciErrorCode(0x13)).toBe("Remote User Terminated Connection");
  });

  it("returns Unknown for unrecognized code", () => {
    expect(hciErrorCode(0xff)).toBe("Unknown (0xFF)");
  });
});

describe("attOpcodeName", () => {
  it("returns known opcode name", () => {
    expect(attOpcodeName(0x1b)).toBe("Handle Value Notification");
  });

  it("returns ATT 0xNN for unknown opcode", () => {
    expect(attOpcodeName(0xfe)).toBe("ATT 0xFE");
  });
});
