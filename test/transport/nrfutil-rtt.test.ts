import { execFileSync } from "child_process";

jest.mock("child_process", () => ({
  execFileSync: jest.fn(),
  spawn: jest.fn(),
  execFile: jest.fn(),
}));

jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  existsSync: jest.fn().mockReturnValue(false),
  readdirSync: jest.fn().mockReturnValue([]),
  mkdirSync: jest.fn(),
}));

const mockExecFileSync = execFileSync as jest.MockedFunction<typeof execFileSync>;

import { resolveSystemPython, NrfutilRttTransport, discoverDevices } from "../../src/transport/nrfutil-rtt";
import { classifyError } from "../../src/errors";

describe("resolveSystemPython", () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
  });

  it("returns python3 path when python3 is found via which", () => {
    mockExecFileSync.mockImplementation((_cmd, args) => {
      if (args?.[0] === "python3") return "/usr/bin/python3\n";
      throw new Error("not found");
    });
    const result = resolveSystemPython();
    expect(result).toBe("/usr/bin/python3");
  });

  it("falls back to python when python3 not found", () => {
    mockExecFileSync.mockImplementation((_cmd, args) => {
      if (args?.[0] === "python") return "/usr/bin/python\n";
      throw new Error("not found");
    });
    const result = resolveSystemPython();
    expect(result).toBe("/usr/bin/python");
  });

  it("throws when no python is found anywhere", () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("not found");
    });
    expect(() => resolveSystemPython()).toThrow(/Python 3 not found/);
  });

  it("takes first line when which returns multiple paths", () => {
    mockExecFileSync.mockImplementation((_cmd, args) => {
      if (args?.[0] === "python3") return "/usr/local/bin/python3\n/usr/bin/python3\n";
      throw new Error("not found");
    });
    const result = resolveSystemPython();
    expect(result).toBe("/usr/local/bin/python3");
  });

  it("trims whitespace from resolved path", () => {
    mockExecFileSync.mockImplementation((_cmd, args) => {
      if (args?.[0] === "python3") return "  /usr/bin/python3  \n";
      throw new Error("not found");
    });
    const result = resolveSystemPython();
    expect(result).toBe("/usr/bin/python3");
  });

  it("skips WindowsApps stub paths", () => {
    mockExecFileSync.mockImplementation((_cmd, args) => {
      if (args?.[0] === "python3") return "C:\\Users\\user\\AppData\\Local\\Microsoft\\WindowsApps\\python3.exe\n";
      if (args?.[0] === "python") return "C:\\Python311\\python.exe\n";
      throw new Error("not found");
    });
    const result = resolveSystemPython();
    expect(result).toBe("C:\\Python311\\python.exe");
  });

  it("falls back to well-known paths when which fails", () => {
    const fs = require("fs");
    // which/where fails for all candidates
    let whichCallCount = 0;
    mockExecFileSync.mockImplementation((cmd: unknown, args: unknown) => {
      const cmdStr = String(cmd);
      if (cmdStr === "which") {
        whichCallCount++;
        throw new Error("not found");
      }
      // Called with a well-known path + --version
      if (Array.isArray(args) && args[0] === "--version") return "Python 3.12.0\n";
      throw new Error("not found");
    });
    fs.existsSync.mockReturnValue(true);

    const result = resolveSystemPython();
    // On macOS (darwin), first well-known path is /opt/homebrew/bin/python3
    // On Linux, it's /usr/bin/python3
    expect(result).toMatch(/python3$/);
    expect(whichCallCount).toBe(2); // tried python3 and python

    fs.existsSync.mockReturnValue(false);
  });
});

describe("device discovery JSON parsing", () => {
  it("parses valid device list JSON", () => {
    const stdout = JSON.stringify({
      devices: [
        { serial: 1057789294, product: "J-Link", device: "nRF54L15_M33" },
        { serial: 1050243197, product: "J-Link", device: "nRF52840_XXAA" },
      ],
    });
    const parsed = JSON.parse(stdout);
    expect(parsed.devices).toHaveLength(2);
    expect(parsed.devices[0].serial).toBe(1057789294);
    expect(parsed.devices[0].product).toBe("J-Link");
    expect(parsed.devices[1].device).toBe("nRF52840_XXAA");
  });

  it("returns empty array when devices key is missing", () => {
    const stdout = JSON.stringify({ other: "data" });
    const parsed = JSON.parse(stdout);
    expect(parsed.devices ?? []).toEqual([]);
  });

  it("returns empty array on invalid JSON", () => {
    const stdout = "not valid json{";
    let result: unknown[] = [];
    try {
      result = JSON.parse(stdout).devices ?? [];
    } catch {
      result = [];
    }
    expect(result).toEqual([]);
  });

  it("returns empty array when devices is null", () => {
    const stdout = JSON.stringify({ devices: null });
    const parsed = JSON.parse(stdout);
    expect(parsed.devices ?? []).toEqual([]);
  });

  it("handles empty devices array", () => {
    const stdout = JSON.stringify({ devices: [] });
    const parsed = JSON.parse(stdout);
    expect(parsed.devices ?? []).toEqual([]);
  });

  it("parses devices with optional fields", () => {
    const stdout = JSON.stringify({
      devices: [
        { serial: 123456, product: "J-Link", core: "Cortex-M33", device: "nRF54L15", jlinkProduct: "J-Link OB" },
      ],
    });
    const parsed = JSON.parse(stdout);
    expect(parsed.devices[0].core).toBe("Cortex-M33");
    expect(parsed.devices[0].jlinkProduct).toBe("J-Link OB");
  });

  it("returns empty on empty stdout", () => {
    const stdout = "";
    let result: unknown[] = [];
    try {
      result = JSON.parse(stdout).devices ?? [];
    } catch {
      result = [];
    }
    expect(result).toEqual([]);
  });
});

describe("_handleStderrLine: CHANNEL_NAME parsing", () => {
  it("emits channelName event for CHANNEL_NAME 0 Terminal", (done) => {
    const transport = new NrfutilRttTransport({ device: "Cortex-M33" });
    transport.on("channelName", ({ index, name }) => {
      expect(index).toBe(0);
      expect(name).toBe("Terminal");
      done();
    });
    transport._handleStderrLine("CHANNEL_NAME 0 Terminal");
  });

  it("emits channelName event for CHANNEL_NAME 1 SysView", (done) => {
    const transport = new NrfutilRttTransport({ device: "Cortex-M33" });
    transport.on("channelName", ({ index, name }) => {
      expect(index).toBe(1);
      expect(name).toBe("SysView");
      done();
    });
    transport._handleStderrLine("CHANNEL_NAME 1 SysView");
  });

  it("handles channel names with spaces", (done) => {
    const transport = new NrfutilRttTransport({ device: "Cortex-M33" });
    transport.on("channelName", ({ index, name }) => {
      expect(index).toBe(0);
      expect(name).toBe("Some Channel With Spaces");
      done();
    });
    transport._handleStderrLine("CHANNEL_NAME 0 Some Channel With Spaces");
  });

  it("does not emit channelName for non-matching lines", (done) => {
    const transport = new NrfutilRttTransport({ device: "Cortex-M33" });
    let emitted = false;
    transport.on("channelName", () => { emitted = true; });
    transport._handleStderrLine("RTT_READY buffers=2 hci=yes");
    transport._handleStderrLine("J-Link connected to nRF54L15_M33");
    setTimeout(() => {
      expect(emitted).toBe(false);
      done();
    }, 50);
  });
});

// ── Regression: Python bootstrap failure must not escape discoverDevices() ──
//
// discoverDevices() (nrfutil-rtt.ts) awaits ensurePythonEnv() OUTSIDE its own
// Promise and without a try/catch, so a bootstrap failure REJECTS instead of
// resolving with {devices: [], error}.
//
// That breaks the contract every caller assumes, and which parseDiscoverResult
// is already tested against ("returns empty devices and helper error..."):
// discovery problems are REPORTED, not thrown.
//
// Consequences at the two call sites:
//   • extension.ts:1026 — scanDevices() wraps the call in try/finally with NO
//     catch, and extension.ts:1083 invokes it as a floating promise. The
//     QuickPick is left on "Scanning..." with qp.busy = true, permanently.
//     The user closes it, which records connect_flow_abandoned("device").
//   • extension.ts:691 — the bare await rejects out of the connect command.
//
// Neither path reaches telemetry.trackConnectFailed (extension.ts:639 is its
// only call site), which is why NO_SEGGER and VENV_FAILED have zero recorded
// events despite being implemented error codes.
describe("discoverDevices: Python bootstrap failure (regression)", () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
  });

  it("resolves with an actionable error when Python cannot be found, instead of rejecting", async () => {
    // Nothing executable anywhere: the which/where lookup and every --version
    // probe fail. fs.existsSync is already mocked false at module scope, so
    // neither the managed venv nor any well-known install path is found.
    mockExecFileSync.mockImplementation(() => {
      throw new Error("not found");
    });

    await expect(discoverDevices()).resolves.toEqual({
      devices: [],
      error: expect.stringMatching(/Python 3 not found/),
    });
  });

  it("resolves with an actionable error when the pylink install fails (blocked PyPI)", async () => {
    // The likelier real-world trigger: Python exists, but pip cannot reach
    // PyPI (corporate proxy, offline first run). Walk ensurePythonEnv through
    // to step 4 and fail only the install.
    mockExecFileSync.mockImplementation((cmd, args) => {
      const argv = (args ?? []) as string[];
      if (cmd === "which" || cmd === "where") return "/usr/bin/python3\n";
      if (argv[0] === "-m" && argv[1] === "venv") return "";           // venv creation succeeds
      if (argv[0] === "install") {
        throw new Error("Could not fetch URL https://pypi.org/simple/pylink-square/");
      }
      if (argv[0] === "-c") {
        throw new Error("ModuleNotFoundError: No module named 'pylink'");
      }
      return "";
    });

    await expect(discoverDevices()).resolves.toEqual({
      devices: [],
      error: expect.stringMatching(/Failed to install pylink-square/),
    });
  });

  it("returns an error string that classifyError maps to a specific code, not GENERIC", async () => {
    // Ties the fix to the telemetry blind spot: as long as the bootstrap error
    // never reaches classifyError, NO_PYTHON/VENV_FAILED can never be recorded.
    mockExecFileSync.mockImplementation(() => {
      throw new Error("not found");
    });

    const { error } = await discoverDevices();
    expect(classifyError(error ?? "").code).toBe("NO_PYTHON");
  });
});
