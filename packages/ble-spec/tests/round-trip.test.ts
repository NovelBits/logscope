/**
 * Round-trip test: parse the YAML files directly, then look up the same
 * codes through the generated TS exports, and verify the data matches.
 * If the generator dropped, mangled, or duplicated any entry, this test
 * catches it.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as yaml from "yaml";
import type { ErrorCodeEntry } from "../src/types";
import {
  lookupHciError,
  lookupAttError,
  lookupSmpError,
  lookupCompanyId,
  lookupServiceUuid,
  lookupCharacteristicUuid,
  lookupDescriptorUuid,
} from "../src";

const CURATED_DIR = join(__dirname, "..", "data", "novel-bits-curated");
const SIG_DIR = join(__dirname, "..", "data", "sig-mirror");

interface YamlFile {
  entries: Array<{ code: string; name: string; specRef?: string }>;
}

function loadCuratedYaml(name: string): YamlFile {
  return yaml.parse(readFileSync(join(CURATED_DIR, name), "utf-8"));
}

function loadSigYaml(name: string): YamlFile {
  return yaml.parse(readFileSync(join(SIG_DIR, name), "utf-8"));
}

type ErrorLookup = (code: number) => ErrorCodeEntry | null;
type StringLookup = (code: number) => string | null;

describe("YAML round-trip integrity", () => {
  describe.each([
    ["HCI", "hci_error_codes.yaml", lookupHciError, true],
    ["ATT", "att_error_codes.yaml", lookupAttError, false],
    ["SMP", "smp_error_codes.yaml", lookupSmpError, false],
  ] as Array<[string, string, ErrorLookup, boolean]>)(
    "%s error codes",
    (_label, yamlFile, lookup, checkSpecRef) => {
      it("every YAML entry resolves through the lookup", () => {
        const data = loadCuratedYaml(yamlFile);
        for (const entry of data.entries) {
          const code = Number.parseInt(entry.code, 16);
          const resolved = lookup(code);
          expect(resolved?.name).toBe(entry.name);
          if (checkSpecRef) {
            expect(resolved?.specRef).toBe(entry.specRef);
          }
        }
      });
    }
  );

  it("every Company ID YAML entry resolves through lookupCompanyId", () => {
    const data = loadCuratedYaml("company_identifiers.yaml");
    for (const entry of data.entries) {
      const code = Number.parseInt(entry.code, 16);
      expect(lookupCompanyId(code)).toBe(entry.name);
    }
  });

  describe.each([
    ["service", "service_uuids.yaml", lookupServiceUuid],
    ["characteristic", "characteristic_uuids.yaml", lookupCharacteristicUuid],
    ["descriptor", "descriptor_uuids.yaml", lookupDescriptorUuid],
  ] as Array<[string, string, StringLookup]>)(
    "%s UUIDs",
    (_label, yamlFile, lookup) => {
      it("every SIG YAML entry resolves through the lookup", () => {
        const data = loadSigYaml(yamlFile);
        for (const entry of data.entries) {
          const code = Number.parseInt(entry.code, 16);
          expect(lookup(code)).toBe(entry.name);
        }
      });
    }
  );
});
