import {
  decodeAttWriteResponse,
  decodeAttHandleValueConfirmation,
} from "../../src/parser/att-decoders";
import { DecodedField } from "../../src/parser/types";

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
