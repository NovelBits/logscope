/**
 * Round-trip test: parse the YAML files directly, then look up the same
 * codes through the generated TS exports, and verify the data matches.
 * If the generator dropped, mangled, or duplicated any entry, this test
 * catches it.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as yaml from "yaml";
import {
  lookupHciError,
  lookupAttError,
  lookupSmpError,
  lookupCompanyId,
} from "../src";

const DATA_DIR = join(__dirname, "..", "data", "novel-bits-curated");

function loadYaml(name: string): { entries: any[] } {
  return yaml.parse(readFileSync(join(DATA_DIR, name), "utf-8"));
}

describe("YAML round-trip integrity", () => {
  it("every HCI error YAML entry resolves through lookupHciError", () => {
    const data = loadYaml("hci_error_codes.yaml");
    for (const entry of data.entries) {
      const code = parseInt(entry.code, 16);
      const resolved = lookupHciError(code);
      expect(resolved).not.toBeNull();
      expect(resolved!.name).toBe(entry.name);
      expect(resolved!.specRef).toBe(entry.specRef);
    }
  });

  it("every ATT error YAML entry resolves through lookupAttError", () => {
    const data = loadYaml("att_error_codes.yaml");
    for (const entry of data.entries) {
      const code = parseInt(entry.code, 16);
      const resolved = lookupAttError(code);
      expect(resolved).not.toBeNull();
      expect(resolved!.name).toBe(entry.name);
    }
  });

  it("every SMP error YAML entry resolves through lookupSmpError", () => {
    const data = loadYaml("smp_error_codes.yaml");
    for (const entry of data.entries) {
      const code = parseInt(entry.code, 16);
      const resolved = lookupSmpError(code);
      expect(resolved).not.toBeNull();
      expect(resolved!.name).toBe(entry.name);
    }
  });

  it("every Company ID YAML entry resolves through lookupCompanyId", () => {
    const data = loadYaml("company_identifiers.yaml");
    for (const entry of data.entries) {
      const code = parseInt(entry.code, 16);
      const resolved = lookupCompanyId(code);
      expect(resolved).not.toBeNull();
      expect(resolved).toBe(entry.name);
    }
  });
});
