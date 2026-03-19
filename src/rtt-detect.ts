import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";

const execFileAsync = promisify(execFile);

/** Parse the _SEGGER_RTT address from `nm` output. */
export function parseRttAddressFromNmOutput(nmOutput: string): number | null {
  for (const line of nmOutput.split("\n")) {
    const match = line.match(/^([0-9a-fA-F]+)\s+\w\s+_SEGGER_RTT$/);
    if (match) {
      return Number.parseInt(match[1], 16);
    }
  }
  return null;
}

/** Search workspace for a Zephyr ELF file. */
export async function findZephyrElf(workspaceRoot: string): Promise<string | null> {
  const buildDir = path.join(workspaceRoot, "build");
  try {
    // Check build/*/zephyr/zephyr.elf (multi-build layout)
    const dir = await fs.promises.opendir(buildDir);
    for await (const entry of dir) {
      if (entry.isDirectory()) {
        const candidate = path.join(buildDir, entry.name, "zephyr", "zephyr.elf");
        if (fs.existsSync(candidate)) return candidate;
      }
    }
    // Check build/zephyr/zephyr.elf (single-build layout)
    const direct = path.join(buildDir, "zephyr", "zephyr.elf");
    if (fs.existsSync(direct)) return direct;
  } catch {
    // build/ directory doesn't exist
  }
  return null;
}

/** Extract RTT address from a Zephyr ELF using nm. */
export async function detectRttAddressFromElf(elfPath: string): Promise<number | null> {
  const nmCandidates = ["arm-zephyr-eabi-nm", "arm-none-eabi-nm", "nm"];
  for (const nm of nmCandidates) {
    try {
      const { stdout } = await execFileAsync(nm, [elfPath]);
      const addr = parseRttAddressFromNmOutput(stdout);
      if (addr !== null) return addr;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Auto-detect RTT address. Tries ELF parsing first, returns null if not found.
 */
export async function autoDetectRttAddress(workspaceRoot: string): Promise<{ address: number; source: string } | null> {
  const elf = await findZephyrElf(workspaceRoot);
  if (!elf) return null;
  const address = await detectRttAddressFromElf(elf);
  if (address === null) return null;
  return { address, source: `ELF: ${path.basename(path.dirname(path.dirname(elf)))}` };
}
