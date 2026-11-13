// Integration test for issue #54: runs the real extension in a real VS Code,
// twice on the same profile (settings files are kept between runs). No hardware.
//
//   npm run test:integration
//
// Isolation: a temporary user-data-dir and extensions-dir, telemetry off.
// HOME stays real: macOS finds the keychain through HOME, and a temporary HOME
// makes VS Code ask to create a keychain ("Keychain Not Found"). The device scan
// uses the existing ~/.logscope/venv read-only when its packages are installed.
// The test opens a visible VS Code window twice (under a minute each).
//
// Optional hardware phase (B1-B3), a third window: a J-Link board flashed with RTT
// firmware (samples/prebuilt/nrf54l15dk-generic-demo.hex on an nRF54L15-DK). The
// test connects and disconnects; it does not flash.
//   LOGSCOPE_IT_PROBE=<J-Link SN> LOGSCOPE_IT_PORT=<serial port path> npm run test:integration
//
// Limit: during extension tests VS Code keeps extension state in memory only
// (useInMemoryStorage when extensionTestsLocationURI is set, seen in 1.146.0), so
// phase 2 starts with NO saved state. It checks the fresh-clone case, not that
// state survives a reload. The read order (state before settings) is covered by
// test/settings-scope.test.ts; saving state across a reload is VS Code's Memento.
import { runTests } from "@vscode/test-electron";
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const suiteOut = join(root, ".vscode-test", "it-build", "suite.js");

await build({
  entryPoints: [join(root, "test-integration", "suite.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["vscode"],
  outfile: suiteOut,
  logLevel: "warning",
});

// realpath: on macOS the temp dir is a symlink (/var -> /private/var), and VS Code
// does not see file edits made through the other path.
const base = realpathSync(mkdtempSync(join(tmpdir(), "logscope-it-")));
const userData = join(base, "user-data");
const extensions = join(base, "extensions");
const workspace = join(base, "workspace");
for (const d of [join(userData, "User"), extensions, join(workspace, ".vscode")]) mkdirSync(d, { recursive: true });

writeFileSync(
  join(userData, "User", "settings.json"),
  JSON.stringify({ "telemetry.telemetryLevel": "off", "workbench.startupEditor": "none" }, null, 2),
);

// The workspace as LogScope 0.6.7 left it: committed values in .vscode/settings.json.
const git = (...args) =>
  execFileSync("git", ["-C", workspace, "-c", "user.name=it", "-c", "user.email=it@example.invalid", ...args], {
    encoding: "utf8",
  });
git("init", "-q");
writeFileSync(
  join(workspace, ".vscode", "settings.json"),
  '{\n  "logscope.transport": "uart",\n  "logscope.lastDevice": "123456789"\n}\n',
);
git("add", "-A");
git("commit", "-qm", "settings as 0.6.7 left them");

let failed = false;
const probe = process.env.LOGSCOPE_IT_PROBE ?? "";
const port = process.env.LOGSCOPE_IT_PORT ?? "";
const phases = probe && port ? ["1", "2", "3"] : ["1", "2"];
if (phases.length === 2) console.log("No LOGSCOPE_IT_PROBE/LOGSCOPE_IT_PORT: skipping the hardware phase.");
for (const phase of phases) {
  console.log(`\n=== Phase ${phase} ===`);
  try {
    await runTests({
      extensionDevelopmentPath: root,
      extensionTestsPath: suiteOut,
      launchArgs: [workspace, `--user-data-dir=${userData}`, `--extensions-dir=${extensions}`, "--disable-workspace-trust"],
      extensionTestsEnv: { LOGSCOPE_IT_PHASE: phase, LOGSCOPE_IT_WORKSPACE: workspace, LOGSCOPE_IT_PROBE: probe, LOGSCOPE_IT_PORT: port },
    });
  } catch (err) {
    console.error(`Phase ${phase} failed:`, err?.message ?? err);
    failed = true;
    break;
  }
}

if (!failed) rmSync(base, { recursive: true, force: true });
else console.error(`Kept the test folders for inspection: ${base}`);
process.exit(failed ? 1 : 0);
