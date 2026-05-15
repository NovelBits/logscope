/**
 * BLE spec database generator: reads YAML data files in
 * data/novel-bits-curated/ and emits TypeScript modules in src/generated/.
 *
 * The generated files are committed to git so that:
 *   - LogScope builds don't need the generator at build time
 *   - PR diffs surface YAML changes visibly in the generated TS
 *   - CI can run with --check to fail if YAML and generated TS have drifted
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as yaml from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, "..");
const DATA_DIR = join(PACKAGE_ROOT, "data", "novel-bits-curated");
const OUT_DIR = join(PACKAGE_ROOT, "src", "generated");

interface ErrorCodeYaml {
  schema: string;
  spec_version: string;
  last_updated: string;
  entries: Array<{ code: string; name: string; specRef: string }>;
}

interface CompanyIdYaml {
  schema: string;
  source: string;
  last_updated: string;
  entries: Array<{ code: string; name: string }>;
}

interface UuidYaml {
  schema: string;
  source: string;
  last_updated: string;
  source_commit?: string;
  entries: Array<{ code: string; name: string }>;
}

function renderErrorCodeModule(
  data: ErrorCodeYaml,
  constantName: string,
  lookupName: string,
  description: string
): string {
  const header = `// GENERATED FILE — DO NOT EDIT BY HAND.
// Source: packages/ble-spec/data/novel-bits-curated/${data.schema}.yaml
// Regenerate with: npm run gen:ble-spec
//
// ${description}
// Spec version: ${data.spec_version}
// Last updated: ${data.last_updated}

import type { ErrorCodeEntry } from "../types";
`;

  const entries = data.entries
    .map(
      (e) =>
        `  ${e.code}: { code: ${e.code}, name: ${JSON.stringify(e.name)}, specRef: ${JSON.stringify(e.specRef)} },`
    )
    .join("\n");

  return `${header}
export const ${constantName}: Record<number, ErrorCodeEntry> = {
${entries}
};

export function ${lookupName}(code: number): ErrorCodeEntry | null {
  return ${constantName}[code] ?? null;
}
`;
}

function renderCompanyIdsModule(data: CompanyIdYaml): string {
  const header = `// GENERATED FILE — DO NOT EDIT BY HAND.
// Source: packages/ble-spec/data/novel-bits-curated/company_identifiers.yaml
// Regenerate with: npm run gen:ble-spec
//
// Bluetooth SIG Company Identifiers (curated subset).
// Source: ${data.source}
// Last updated: ${data.last_updated}
`;

  const entries = data.entries
    .map((e) => `  ${e.code}: ${JSON.stringify(e.name)},`)
    .join("\n");

  return `${header}
export const BLUETOOTH_COMPANY_IDS: Record<number, string> = {
${entries}
};

export function lookupCompanyId(code: number): string | null {
  return BLUETOOTH_COMPANY_IDS[code] ?? null;
}
`;
}

function renderUuidModule(
  data: UuidYaml,
  constantName: string,
  lookupName: string,
  label: string
): string {
  const header = `// GENERATED FILE — DO NOT EDIT BY HAND.
// Source: packages/ble-spec/data/sig-mirror/${data.schema}.yaml
// Regenerate with: npm run gen:ble-spec
//
// ${label}
// Upstream: ${data.source}
// Last updated: ${data.last_updated}${data.source_commit ? `\n// Upstream commit: ${data.source_commit}` : ""}
`;

  const entries = data.entries
    .map((e) => `  ${e.code}: ${JSON.stringify(e.name)},`)
    .join("\n");

  return `${header}
export const ${constantName}: Record<number, string> = {
${entries}
};

export function ${lookupName}(code: number): string | null {
  return ${constantName}[code] ?? null;
}
`;
}

interface GenSpec {
  yamlFile: string;
  outFile: string;
  render: (raw: any) => string;
}

const GENERATIONS: GenSpec[] = [
  {
    yamlFile: "hci_error_codes.yaml",
    outFile: "hci-error-codes.ts",
    render: (raw) =>
      renderErrorCodeModule(
        raw,
        "HCI_ERROR_CODES",
        "lookupHciError",
        "HCI Error Codes (returned in the Status field of HCI events)."
      ),
  },
  {
    yamlFile: "att_error_codes.yaml",
    outFile: "att-error-codes.ts",
    render: (raw) =>
      renderErrorCodeModule(
        raw,
        "ATT_ERROR_CODES",
        "lookupAttError",
        "ATT Error Codes (returned in the Error Code field of ATT_ERROR_RSP PDUs)."
      ),
  },
  {
    yamlFile: "smp_error_codes.yaml",
    outFile: "smp-error-codes.ts",
    render: (raw) =>
      renderErrorCodeModule(
        raw,
        "SMP_ERROR_CODES",
        "lookupSmpError",
        "SMP Pairing Failed Reason Codes (returned in the Reason field of SMP Pairing Failed PDUs)."
      ),
  },
  {
    yamlFile: "company_identifiers.yaml",
    outFile: "company-ids.ts",
    render: (raw) => renderCompanyIdsModule(raw),
  },
];

function main() {
  const checkMode = process.argv.includes("--check");
  let drifted = false;

  for (const spec of GENERATIONS) {
    const inputPath = join(DATA_DIR, spec.yamlFile);
    if (!existsSync(inputPath)) {
      console.error(`SKIP: ${inputPath} does not exist`);
      continue;
    }
    const raw = yaml.parse(readFileSync(inputPath, "utf-8"));
    const rendered = spec.render(raw);
    const outputPath = join(OUT_DIR, spec.outFile);

    if (checkMode) {
      if (!existsSync(outputPath)) {
        console.error(`DRIFT: ${outputPath} missing — run \`npm run gen:ble-spec\``);
        drifted = true;
        continue;
      }
      const existing = readFileSync(outputPath, "utf-8");
      if (existing !== rendered) {
        console.error(`DRIFT: ${outputPath} out of sync with ${inputPath}`);
        drifted = true;
      }
    } else {
      writeFileSync(outputPath, rendered);
      console.log(`WROTE: ${outputPath}`);
    }
  }

  if (drifted) {
    console.error("\nGenerated files are out of sync with YAML source.");
    console.error("Run `npm run gen:ble-spec` and commit the result.");
    process.exit(1);
  }
}

main();
