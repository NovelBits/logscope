import { spawn, spawnSync } from "node:child_process";
import * as path from "node:path";

/**
 * Smoke test for the Python RTT helper.
 *
 * This test exists to catch one specific regression class: the helper
 * silently producing no stdout (which LogScope interprets as "no devices
 * found"). The v0.5.7→v0.5.10 incident was triggered when os._exit() was
 * added to bypass a libjlinkarm destructor crash; os._exit() does NOT
 * flush stdio buffers, so the discover JSON was lost. This test would
 * have caught it on the next CI run.
 *
 * The test does NOT need a real probe or pylink-square installed:
 *   - If pylink isn't installed → helper takes the ImportError branch and
 *     prints {"error": "pylink not installed", "devices": []}.
 *   - If pylink is installed but no SEGGER tools → helper prints an
 *     {"error": "SEGGER J-Link Software not found...", "devices": []}.
 *   - If everything's installed → helper prints the real device list.
 * In all three cases we expect valid JSON with a `devices` key. If the
 * exit-without-flush bug ever returns, every branch produces empty stdout.
 */
describe("rtt-helper.py discover (smoke)", () => {
  const helperPath = path.resolve(__dirname, "..", "src", "transport", "rtt-helper.py");

  // Skip the test if python3 isn't available (e.g. some CI matrices). We
  // never want this test to fail because of a missing interpreter — it's
  // here to catch our regressions, not infrastructure issues.
  const python3Available = (() => {
    try {
      const result = spawnSync("python3", ["--version"], { timeout: 5000 });
      return result.status === 0;
    } catch {
      return false;
    }
  })();

  const itIfPython = python3Available ? it : it.skip;

  itIfPython("emits valid JSON with a 'devices' array key, regardless of pylink availability", async () => {
    const result = await new Promise<{ stdout: string; exitCode: number | null }>((resolve, reject) => {
      const proc = spawn("python3", [helperPath, "discover"], {
        timeout: 30_000,
      });
      let stdout = "";
      proc.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf-8");
      });
      proc.on("error", reject);
      proc.on("exit", (code) => {
        resolve({ stdout, exitCode: code });
      });
    });

    // The single most important assertion: stdout must not be empty when
    // the helper exits with code 0. If it is, we've reintroduced the
    // os._exit-without-flush bug (or some equivalent regression).
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).not.toBe("");

    // And the output must parse as JSON with the documented contract.
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toHaveProperty("devices");
    expect(Array.isArray(parsed.devices)).toBe(true);
  }, 35_000);
});
