import {
  decodeAttWriteResponse,
  decodeAttHandleValueConfirmation,
} from "../../src/parser/att-decoders";
import { DecodedField } from "../../src/parser/types";

import {
  decodeAttFindInformationRequest,
  decodeAttFindInformationResponse,
  decodeAttFindByTypeValueRequest,
  decodeAttFindByTypeValueResponse,
  decodeAttReadByTypeRequest,
  decodeAttReadByTypeResponse,
  decodeAttReadByGroupTypeRequest,
  decodeAttReadByGroupTypeResponse,
  decodeAttReadBlobRequest,
  decodeAttReadBlobResponse,
  decodeAttReadMultipleRequest,
  decodeAttReadMultipleResponse,
} from "../../src/parser/att-decoders";

describe("ATT stub decoders (zero-payload)", () => {
  describe("Write Response (0x13)", () => {
    it("renders summary with handle", () => {
      const fields: DecodedField[] = [];
      const result = decodeAttWriteResponse(
        Buffer.from([0x13]),
        "0x0001",
        fields
      );
      expect(result?.summary).toBe("handle:0x0001 ATT Write Response");
      expect(result?.fields).toEqual([]);
    });
  });

  describe("Handle Value Confirmation (0x1e)", () => {
    it("renders summary with handle", () => {
      const fields: DecodedField[] = [];
      const result = decodeAttHandleValueConfirmation(
        Buffer.from([0x1e]),
        "0x0002",
        fields
      );
      expect(result?.summary).toBe("handle:0x0002 ATT Handle Value Confirmation");
      expect(result?.fields).toEqual([]);
    });
  });
});

describe("Find Information (0x04 / 0x05)", () => {
  describe("Request (0x04)", () => {
    it("decodes start + end handles", () => {
      // L2CAP header (8 bytes ignored) + opcode 0x04 + start 0x0001 + end 0xFFFF
      const buf = Buffer.from([
        0, 0, 0, 0, 0, 0, 0, 0,
        0x04,
        0x01, 0x00,
        0xff, 0xff,
      ]);
      const result = decodeAttFindInformationRequest(buf, "0x0040", []);
      expect(result?.summary).toBe("handle:0x0040 ATT Find Information Request (0x0001-0xFFFF)");
      expect(result?.fields).toEqual([
        { name: "Starting Handle", value: "0x0001" },
        { name: "Ending Handle", value: "0xFFFF" },
      ]);
    });

    it("returns null on truncated payload", () => {
      const buf = Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 0x04, 0x01, 0x00]); // missing end handle
      expect(decodeAttFindInformationRequest(buf, "0x0040", [])).toBeNull();
    });
  });

  describe("Response (0x05)", () => {
    it("decodes a 16-bit UUID list and resolves known descriptor UUIDs", () => {
      // opcode 0x05, format 0x01, entry: handle 0x0010 -> UUID 0x2902 (CCCD)
      const buf = Buffer.from([
        0, 0, 0, 0, 0, 0, 0, 0,
        0x05,
        0x01,
        0x10, 0x00, 0x02, 0x29,
      ]);
      const result = decodeAttFindInformationResponse(buf, "0x0040", []);
      expect(result?.summary).toBe("handle:0x0040 ATT Find Information Response (1 entry)");
      expect(result?.fields[0]).toEqual({ name: "Format", value: "16-bit UUIDs" });
      expect(result?.fields[1].value).toContain("Client Characteristic Configuration");
      expect(result?.fields[1].value).toContain("0x2902");
    });

    it("falls back to raw hex for unknown 16-bit UUIDs", () => {
      const buf = Buffer.from([
        0, 0, 0, 0, 0, 0, 0, 0,
        0x05, 0x01,
        0x10, 0x00, 0x99, 0x99,
      ]);
      const result = decodeAttFindInformationResponse(buf, "0x0040", []);
      expect(result?.fields[1].value).toBe("0x0010 -> 0x9999");
    });

    it("decodes a 128-bit UUID list", () => {
      // format 0x02, entry: handle 0x0010 -> Nordic UART service base
      const nordicUart = [0x9e, 0xca, 0xdc, 0x24, 0x0e, 0xe5, 0xa9, 0xe0, 0x93, 0xf3, 0xa3, 0xb5, 0x01, 0x00, 0x40, 0x6e];
      const buf = Buffer.from([
        0, 0, 0, 0, 0, 0, 0, 0,
        0x05, 0x02,
        0x10, 0x00,
        ...nordicUart,
      ]);
      const result = decodeAttFindInformationResponse(buf, "0x0040", []);
      expect(result?.fields[0]).toEqual({ name: "Format", value: "128-bit UUIDs" });
      expect(result?.fields[1].value).toBe("0x0010 -> 6E400001-B5A3-F393-E0A9-E50E24DCCA9E");
    });

    it("flags an invalid format byte", () => {
      const buf = Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 0x05, 0x99]);
      const result = decodeAttFindInformationResponse(buf, "0x0040", []);
      expect(result?.fields[0].value).toContain("invalid");
    });

    it("flags trailing bytes that don't form a full entry", () => {
      const buf = Buffer.from([
        0, 0, 0, 0, 0, 0, 0, 0,
        0x05, 0x01,
        0x10, 0x00, 0x02, 0x29,
        0xff,
      ]);
      const result = decodeAttFindInformationResponse(buf, "0x0040", []);
      const truncated = result?.fields.find((f) => f.name === "Truncated");
      expect(truncated?.value).toBe("1 byte(s)");
    });
  });
});

describe("Find By Type Value (0x06 / 0x07)", () => {
  describe("Request (0x06)", () => {
    it("decodes well-formed request with known service UUID", () => {
      // opcode 0x06, start 0x0001, end 0xFFFF, type 0x180D (Heart Rate),
      // value: 2-byte service UUID 0x180D LE
      const buf = Buffer.from([
        0, 0, 0, 0, 0, 0, 0, 0,
        0x06,
        0x01, 0x00,
        0xff, 0xff,
        0x0d, 0x18,
        0x0d, 0x18,
      ]);
      const result = decodeAttFindByTypeValueRequest(buf, "0x0040", []);
      expect(result?.summary).toBe(
        "handle:0x0040 ATT Find By Type Value Request (Heart Rate (0x180D))"
      );
      expect(result?.fields[0]).toEqual({ name: "Starting Handle", value: "0x0001" });
      expect(result?.fields[1]).toEqual({ name: "Ending Handle", value: "0xFFFF" });
      expect(result?.fields[2].value).toBe("Heart Rate (0x180D)");
      expect(result?.fields[3].name).toBe("Attribute Value");
      expect(result?.fields[3].value).toContain("0d 18");
    });

    it("falls back to raw hex for unknown attribute type", () => {
      // type 0x2800 (Primary Service declaration) — not in any SIG UUID table
      const buf = Buffer.from([
        0, 0, 0, 0, 0, 0, 0, 0,
        0x06,
        0x01, 0x00,
        0xff, 0xff,
        0x00, 0x28,
        0xab, 0xcd,
      ]);
      const result = decodeAttFindByTypeValueRequest(buf, "0x0040", []);
      expect(result?.summary).toBe(
        "handle:0x0040 ATT Find By Type Value Request (0x2800)"
      );
      expect(result?.fields[2].value).toBe("0x2800");
    });

    it("accepts an empty attribute value", () => {
      const buf = Buffer.from([
        0, 0, 0, 0, 0, 0, 0, 0,
        0x06,
        0x01, 0x00,
        0xff, 0xff,
        0x0d, 0x18,
      ]);
      const result = decodeAttFindByTypeValueRequest(buf, "0x0040", []);
      expect(result?.fields[3]).toEqual({ name: "Attribute Value", value: "(empty)" });
    });

    it("returns null on truncated payload (missing attribute type)", () => {
      const buf = Buffer.from([
        0, 0, 0, 0, 0, 0, 0, 0,
        0x06,
        0x01, 0x00,
        0xff, 0xff,
        0x0d,
      ]);
      expect(decodeAttFindByTypeValueRequest(buf, "0x0040", [])).toBeNull();
    });
  });

  describe("Response (0x07)", () => {
    it("decodes a single (found handle, group end handle) pair", () => {
      const buf = Buffer.from([
        0, 0, 0, 0, 0, 0, 0, 0,
        0x07,
        0x10, 0x00, 0x20, 0x00,
      ]);
      const result = decodeAttFindByTypeValueResponse(buf, "0x0040", []);
      expect(result?.summary).toBe("handle:0x0040 ATT Find By Type Value Response (1 entry)");
      expect(result?.fields[0]).toEqual({ name: "Entry 1", value: "0x0010 -> 0x0020" });
    });

    it("decodes three entries", () => {
      const buf = Buffer.from([
        0, 0, 0, 0, 0, 0, 0, 0,
        0x07,
        0x10, 0x00, 0x20, 0x00,
        0x21, 0x00, 0x30, 0x00,
        0x31, 0x00, 0x40, 0x00,
      ]);
      const result = decodeAttFindByTypeValueResponse(buf, "0x0040", []);
      expect(result?.summary).toBe("handle:0x0040 ATT Find By Type Value Response (3 entries)");
      expect(result?.fields).toHaveLength(3);
      expect(result?.fields[2]).toEqual({ name: "Entry 3", value: "0x0031 -> 0x0040" });
    });

    it("accepts zero entries (empty list)", () => {
      const buf = Buffer.from([
        0, 0, 0, 0, 0, 0, 0, 0,
        0x07,
      ]);
      const result = decodeAttFindByTypeValueResponse(buf, "0x0040", []);
      expect(result?.summary).toBe("handle:0x0040 ATT Find By Type Value Response (0 entries)");
      expect(result?.fields).toEqual([]);
    });

    it("flags trailing bytes that don't form a complete pair", () => {
      const buf = Buffer.from([
        0, 0, 0, 0, 0, 0, 0, 0,
        0x07,
        0x10, 0x00, 0x20, 0x00,
        0xab,
      ]);
      const result = decodeAttFindByTypeValueResponse(buf, "0x0040", []);
      const truncated = result?.fields.find((f) => f.name === "Truncated");
      expect(truncated?.value).toBe("1 byte(s)");
    });
  });
});

describe("Read By Type (0x08 / 0x09)", () => {
  describe("Request (0x08)", () => {
    it("decodes 16-bit attribute type resolved by name", () => {
      // opcode 0x08, start 0x0001, end 0xFFFF, type 0x2A37 (Heart Rate Measurement)
      const buf = Buffer.from([
        0, 0, 0, 0, 0, 0, 0, 0,
        0x08,
        0x01, 0x00,
        0xff, 0xff,
        0x37, 0x2a,
      ]);
      const result = decodeAttReadByTypeRequest(buf, "0x0040", []);
      expect(result?.summary).toBe(
        "handle:0x0040 ATT Read By Type Request (Heart Rate Measurement (0x2A37))"
      );
      expect(result?.fields).toEqual([
        { name: "Starting Handle", value: "0x0001" },
        { name: "Ending Handle", value: "0xFFFF" },
        { name: "Attribute Type", value: "Heart Rate Measurement (0x2A37)" },
      ]);
    });

    it("falls back to raw hex for unknown 16-bit attribute type", () => {
      const buf = Buffer.from([
        0, 0, 0, 0, 0, 0, 0, 0,
        0x08,
        0x01, 0x00,
        0xff, 0xff,
        0x99, 0x99,
      ]);
      const result = decodeAttReadByTypeRequest(buf, "0x0040", []);
      expect(result?.summary).toBe("handle:0x0040 ATT Read By Type Request (0x9999)");
      expect(result?.fields[2].value).toBe("0x9999");
    });

    it("decodes 128-bit attribute type", () => {
      // Nordic UART service base (LE on the wire, big-endian when rendered)
      const nordicUart = [0x9e, 0xca, 0xdc, 0x24, 0x0e, 0xe5, 0xa9, 0xe0, 0x93, 0xf3, 0xa3, 0xb5, 0x01, 0x00, 0x40, 0x6e];
      const buf = Buffer.from([
        0, 0, 0, 0, 0, 0, 0, 0,
        0x08,
        0x01, 0x00,
        0xff, 0xff,
        ...nordicUart,
      ]);
      const result = decodeAttReadByTypeRequest(buf, "0x0040", []);
      expect(result?.summary).toBe(
        "handle:0x0040 ATT Read By Type Request (6E400001-B5A3-F393-E0A9-E50E24DCCA9E)"
      );
      expect(result?.fields[2].value).toBe("6E400001-B5A3-F393-E0A9-E50E24DCCA9E");
    });

    it("returns null on truncated payload (between 16-bit and 128-bit sizes)", () => {
      // 16 bytes total: 8 prefix + opcode + 2 + 2 + 3 (partial UUID)
      const buf = Buffer.from([
        0, 0, 0, 0, 0, 0, 0, 0,
        0x08,
        0x01, 0x00,
        0xff, 0xff,
        0x37, 0x2a, 0x00,
      ]);
      expect(decodeAttReadByTypeRequest(buf, "0x0040", [])).toBeNull();
    });
  });

  describe("Response (0x09)", () => {
    it("decodes a single entry", () => {
      // length=5 (handle 2B + value 3B), one entry: handle 0x0010, value 01 02 03
      const buf = Buffer.from([
        0, 0, 0, 0, 0, 0, 0, 0,
        0x09,
        0x05,
        0x10, 0x00, 0x01, 0x02, 0x03,
      ]);
      const result = decodeAttReadByTypeResponse(buf, "0x0040", []);
      expect(result?.summary).toBe("handle:0x0040 ATT Read By Type Response (1 entry)");
      expect(result?.fields[0]).toEqual({ name: "Length", value: "5" });
      expect(result?.fields[1].name).toBe("Entry 1");
      expect(result?.fields[1].value).toContain("handle 0x0010");
      expect(result?.fields[1].value).toContain("01 02 03");
    });

    it("decodes multiple entries", () => {
      const buf = Buffer.from([
        0, 0, 0, 0, 0, 0, 0, 0,
        0x09,
        0x04,
        0x10, 0x00, 0xaa, 0xbb,
        0x11, 0x00, 0xcc, 0xdd,
        0x12, 0x00, 0xee, 0xff,
      ]);
      const result = decodeAttReadByTypeResponse(buf, "0x0040", []);
      expect(result?.summary).toBe("handle:0x0040 ATT Read By Type Response (3 entries)");
      // Length field + 3 entries = 4 fields
      expect(result?.fields).toHaveLength(4);
      expect(result?.fields[3].value).toContain("handle 0x0012");
      expect(result?.fields[3].value).toContain("ee ff");
    });

    it("accepts zero-length values (length == 2, just handles)", () => {
      const buf = Buffer.from([
        0, 0, 0, 0, 0, 0, 0, 0,
        0x09,
        0x02,
        0x10, 0x00,
        0x11, 0x00,
      ]);
      const result = decodeAttReadByTypeResponse(buf, "0x0040", []);
      expect(result?.summary).toBe("handle:0x0040 ATT Read By Type Response (2 entries)");
      expect(result?.fields[1].value).toContain("handle 0x0010");
      expect(result?.fields[1].value).toContain("(empty)");
    });

    it("flags malformed length byte (length == 1)", () => {
      const buf = Buffer.from([
        0, 0, 0, 0, 0, 0, 0, 0,
        0x09,
        0x01,
      ]);
      const result = decodeAttReadByTypeResponse(buf, "0x0040", []);
      expect(result?.summary).toBe("handle:0x0040 ATT Read By Type Response (invalid length)");
      const truncated = result?.fields.find((f) => f.name === "Truncated");
      expect(truncated?.value).toContain("must be >= 2");
    });

    it("flags trailing bytes that don't form a full entry", () => {
      const buf = Buffer.from([
        0, 0, 0, 0, 0, 0, 0, 0,
        0x09,
        0x04,
        0x10, 0x00, 0xaa, 0xbb,
        0xcc,
      ]);
      const result = decodeAttReadByTypeResponse(buf, "0x0040", []);
      const truncated = result?.fields.find((f) => f.name === "Truncated");
      expect(truncated?.value).toBe("1 byte(s)");
    });
  });
});

describe("Read By Group Type (0x10 / 0x11)", () => {
  describe("Request (0x10)", () => {
    it("decodes 16-bit group type resolved by name", () => {
      // opcode 0x10, start 0x0001, end 0xFFFF, group type 0x180D (Heart Rate)
      const buf = Buffer.from([
        0, 0, 0, 0, 0, 0, 0, 0,
        0x10,
        0x01, 0x00,
        0xff, 0xff,
        0x0d, 0x18,
      ]);
      const result = decodeAttReadByGroupTypeRequest(buf, "0x0040", []);
      expect(result?.summary).toBe(
        "handle:0x0040 ATT Read By Group Type Request (Heart Rate (0x180D))"
      );
      expect(result?.fields).toEqual([
        { name: "Starting Handle", value: "0x0001" },
        { name: "Ending Handle", value: "0xFFFF" },
        { name: "Attribute Group Type", value: "Heart Rate (0x180D)" },
      ]);
    });

    it("falls back to raw hex for unknown 16-bit group type", () => {
      // 0x2800 (Primary Service declaration) isn't in any SIG UUID table
      const buf = Buffer.from([
        0, 0, 0, 0, 0, 0, 0, 0,
        0x10,
        0x01, 0x00,
        0xff, 0xff,
        0x00, 0x28,
      ]);
      const result = decodeAttReadByGroupTypeRequest(buf, "0x0040", []);
      expect(result?.summary).toBe("handle:0x0040 ATT Read By Group Type Request (0x2800)");
      expect(result?.fields[2].value).toBe("0x2800");
    });

    it("decodes 128-bit group type", () => {
      const nordicUart = [0x9e, 0xca, 0xdc, 0x24, 0x0e, 0xe5, 0xa9, 0xe0, 0x93, 0xf3, 0xa3, 0xb5, 0x01, 0x00, 0x40, 0x6e];
      const buf = Buffer.from([
        0, 0, 0, 0, 0, 0, 0, 0,
        0x10,
        0x01, 0x00,
        0xff, 0xff,
        ...nordicUart,
      ]);
      const result = decodeAttReadByGroupTypeRequest(buf, "0x0040", []);
      expect(result?.summary).toBe(
        "handle:0x0040 ATT Read By Group Type Request (6E400001-B5A3-F393-E0A9-E50E24DCCA9E)"
      );
      expect(result?.fields[2].value).toBe("6E400001-B5A3-F393-E0A9-E50E24DCCA9E");
    });

    it("returns null on truncated payload", () => {
      const buf = Buffer.from([
        0, 0, 0, 0, 0, 0, 0, 0,
        0x10,
        0x01, 0x00,
        0xff, 0xff,
        0x0d,
      ]);
      expect(decodeAttReadByGroupTypeRequest(buf, "0x0040", [])).toBeNull();
    });
  });

  describe("Response (0x11)", () => {
    it("decodes a single entry with 16-bit service UUID resolved", () => {
      // length=6 (handle 2B + endGroup 2B + value 2B), one entry:
      // 0x0001-0x0005 -> 0x180D (Heart Rate)
      const buf = Buffer.from([
        0, 0, 0, 0, 0, 0, 0, 0,
        0x11,
        0x06,
        0x01, 0x00,
        0x05, 0x00,
        0x0d, 0x18,
      ]);
      const result = decodeAttReadByGroupTypeResponse(buf, "0x0040", []);
      expect(result?.summary).toBe("handle:0x0040 ATT Read By Group Type Response (1 entry)");
      expect(result?.fields[0]).toEqual({ name: "Length", value: "6" });
      expect(result?.fields[1]).toEqual({
        name: "Entry 1",
        value: "0x0001-0x0005 -> Heart Rate (0x180D)",
      });
    });

    it("decodes multiple entries with mixed known/unknown UUIDs", () => {
      const buf = Buffer.from([
        0, 0, 0, 0, 0, 0, 0, 0,
        0x11,
        0x06,
        0x01, 0x00, 0x05, 0x00, 0x0d, 0x18,
        0x06, 0x00, 0x0a, 0x00, 0x0f, 0x18,
        0x0b, 0x00, 0x10, 0x00, 0x99, 0x99,
      ]);
      const result = decodeAttReadByGroupTypeResponse(buf, "0x0040", []);
      expect(result?.summary).toBe("handle:0x0040 ATT Read By Group Type Response (3 entries)");
      expect(result?.fields[1].value).toBe("0x0001-0x0005 -> Heart Rate (0x180D)");
      expect(result?.fields[2].value).toBe("0x0006-0x000A -> Battery (0x180F)");
      expect(result?.fields[3].value).toBe("0x000B-0x0010 -> 0x9999");
    });

    it("decodes a 128-bit value", () => {
      // length = 4 + 16 = 20
      const nordicUart = [0x9e, 0xca, 0xdc, 0x24, 0x0e, 0xe5, 0xa9, 0xe0, 0x93, 0xf3, 0xa3, 0xb5, 0x01, 0x00, 0x40, 0x6e];
      const buf = Buffer.from([
        0, 0, 0, 0, 0, 0, 0, 0,
        0x11,
        0x14,
        0x01, 0x00,
        0x0f, 0x00,
        ...nordicUart,
      ]);
      const result = decodeAttReadByGroupTypeResponse(buf, "0x0040", []);
      expect(result?.fields[1].value).toBe(
        "0x0001-0x000F -> 6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
      );
    });

    it("renders raw hex for a non-UUID-sized value", () => {
      // length = 4 + 3 = 7 (value is 3 bytes, neither 2 nor 16 → raw hex)
      const buf = Buffer.from([
        0, 0, 0, 0, 0, 0, 0, 0,
        0x11,
        0x07,
        0x01, 0x00,
        0x05, 0x00,
        0xaa, 0xbb, 0xcc,
      ]);
      const result = decodeAttReadByGroupTypeResponse(buf, "0x0040", []);
      expect(result?.fields[1].value).toContain("0x0001-0x0005 -> ");
      expect(result?.fields[1].value).toContain("aa bb cc");
    });

    it("flags malformed length byte (length == 3)", () => {
      const buf = Buffer.from([
        0, 0, 0, 0, 0, 0, 0, 0,
        0x11,
        0x03,
      ]);
      const result = decodeAttReadByGroupTypeResponse(buf, "0x0040", []);
      expect(result?.summary).toBe(
        "handle:0x0040 ATT Read By Group Type Response (invalid length)"
      );
      const truncated = result?.fields.find((f) => f.name === "Truncated");
      expect(truncated?.value).toContain("must be >= 4");
    });

    it("flags trailing bytes that don't form a full entry", () => {
      const buf = Buffer.from([
        0, 0, 0, 0, 0, 0, 0, 0,
        0x11,
        0x06,
        0x01, 0x00, 0x05, 0x00, 0x0d, 0x18,
        0xab,
      ]);
      const result = decodeAttReadByGroupTypeResponse(buf, "0x0040", []);
      const truncated = result?.fields.find((f) => f.name === "Truncated");
      expect(truncated?.value).toBe("1 byte(s)");
    });
  });
});

describe("Read Blob (0x0c / 0x0d)", () => {
  describe("Request (0x0c)", () => {
    it("decodes handle + offset", () => {
      // opcode 0x0c, handle 0x0010, offset 0x0014 (20)
      const buf = Buffer.from([
        0, 0, 0, 0, 0, 0, 0, 0,
        0x0c,
        0x10, 0x00,
        0x14, 0x00,
      ]);
      const result = decodeAttReadBlobRequest(buf, "0x0040", []);
      expect(result?.summary).toBe(
        "handle:0x0040 ATT Read Blob Request (handle: 0x0010, offset: 20)"
      );
      expect(result?.fields).toEqual([
        { name: "ATT Handle", value: "0x0010" },
        { name: "Value Offset", value: "20" },
      ]);
    });

    it("returns null on truncated payload (missing offset)", () => {
      const buf = Buffer.from([
        0, 0, 0, 0, 0, 0, 0, 0,
        0x0c,
        0x10, 0x00,
      ]);
      expect(decodeAttReadBlobRequest(buf, "0x0040", [])).toBeNull();
    });
  });

  describe("Response (0x0d)", () => {
    it("decodes a non-empty value", () => {
      const buf = Buffer.from([
        0, 0, 0, 0, 0, 0, 0, 0,
        0x0d,
        0x48, 0x65, 0x6c, 0x6c, 0x6f,
      ]);
      const result = decodeAttReadBlobResponse(buf, "0x0040", []);
      expect(result?.summary).toBe("handle:0x0040 ATT Read Blob Response (5 bytes)");
      expect(result?.fields[0]).toEqual({ name: "Length", value: "5" });
      expect(result?.fields[1].name).toBe("Value");
      expect(result?.fields[1].value).toContain("48 65 6c 6c 6f");
      expect(result?.fields[1].value).toContain("Hello");
    });

    it("accepts a zero-length value", () => {
      const buf = Buffer.from([
        0, 0, 0, 0, 0, 0, 0, 0,
        0x0d,
      ]);
      const result = decodeAttReadBlobResponse(buf, "0x0040", []);
      expect(result?.summary).toBe("handle:0x0040 ATT Read Blob Response (0 bytes)");
      expect(result?.fields[0]).toEqual({ name: "Length", value: "0" });
      expect(result?.fields[1]).toEqual({ name: "Value", value: "(empty)" });
    });

    it("decodes a large 22-byte value (typical post-MTU-exchange blob chunk)", () => {
      const valueBytes = new Array(22).fill(0).map((_, i) => i + 1);
      const buf = Buffer.from([
        0, 0, 0, 0, 0, 0, 0, 0,
        0x0d,
        ...valueBytes,
      ]);
      const result = decodeAttReadBlobResponse(buf, "0x0040", []);
      expect(result?.summary).toBe("handle:0x0040 ATT Read Blob Response (22 bytes)");
      expect(result?.fields[0]).toEqual({ name: "Length", value: "22" });
      expect(result?.fields[1].value).toContain("01 02 03");
      expect(result?.fields[1].value).toContain("16");
    });
  });
});

describe("Read Multiple (0x0e / 0x0f)", () => {
  describe("Request (0x0e)", () => {
    it("decodes a request with 2 handles", () => {
      const buf = Buffer.from([
        0, 0, 0, 0, 0, 0, 0, 0,
        0x0e,
        0x10, 0x00,
        0x20, 0x00,
      ]);
      const result = decodeAttReadMultipleRequest(buf, "0x0040", []);
      expect(result?.summary).toBe("handle:0x0040 ATT Read Multiple Request (2 handles)");
      expect(result?.fields).toEqual([
        { name: "Handle 1", value: "0x0010" },
        { name: "Handle 2", value: "0x0020" },
      ]);
    });

    it("decodes a request with 5 handles", () => {
      const buf = Buffer.from([
        0, 0, 0, 0, 0, 0, 0, 0,
        0x0e,
        0x10, 0x00,
        0x20, 0x00,
        0x30, 0x00,
        0x40, 0x00,
        0x50, 0x00,
      ]);
      const result = decodeAttReadMultipleRequest(buf, "0x0040", []);
      expect(result?.summary).toBe("handle:0x0040 ATT Read Multiple Request (5 handles)");
      expect(result?.fields).toHaveLength(5);
      expect(result?.fields[4]).toEqual({ name: "Handle 5", value: "0x0050" });
    });

    it("returns null on request with only 1 handle (spec requires min 2)", () => {
      const buf = Buffer.from([
        0, 0, 0, 0, 0, 0, 0, 0,
        0x0e,
        0x10, 0x00,
      ]);
      expect(decodeAttReadMultipleRequest(buf, "0x0040", [])).toBeNull();
    });

    it("flags an odd trailing byte as truncated", () => {
      // 2 valid handles + 1 trailing byte (5 body bytes, body.length=5)
      const buf = Buffer.from([
        0, 0, 0, 0, 0, 0, 0, 0,
        0x0e,
        0x10, 0x00,
        0x20, 0x00,
        0xab,
      ]);
      const result = decodeAttReadMultipleRequest(buf, "0x0040", []);
      expect(result?.summary).toBe("handle:0x0040 ATT Read Multiple Request (2 handles)");
      const truncated = result?.fields.find((f) => f.name === "Truncated");
      expect(truncated?.value).toBe("1 byte(s)");
    });
  });

  describe("Response (0x0f)", () => {
    it("decodes a concatenated value", () => {
      const buf = Buffer.from([
        0, 0, 0, 0, 0, 0, 0, 0,
        0x0f,
        0xaa, 0xbb, 0xcc, 0xdd,
      ]);
      const result = decodeAttReadMultipleResponse(buf, "0x0040", []);
      expect(result?.summary).toBe("handle:0x0040 ATT Read Multiple Response (4 bytes)");
      expect(result?.fields[0].name).toBe("Value");
      expect(result?.fields[0].value).toContain("aa bb cc dd");
    });

    it("accepts an empty response", () => {
      const buf = Buffer.from([
        0, 0, 0, 0, 0, 0, 0, 0,
        0x0f,
      ]);
      const result = decodeAttReadMultipleResponse(buf, "0x0040", []);
      expect(result?.summary).toBe("handle:0x0040 ATT Read Multiple Response (0 bytes)");
      expect(result?.fields[0]).toEqual({ name: "Value", value: "(empty)" });
    });
  });
});
