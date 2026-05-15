import {
  decodeAttWriteResponse,
  decodeAttHandleValueConfirmation,
} from "../../src/parser/att-decoders";
import { DecodedField } from "../../src/parser/types";

import {
  decodeAttFindInformationRequest,
  decodeAttFindInformationResponse,
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
