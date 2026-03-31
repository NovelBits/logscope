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

import { resolveSystemPython } from "../../src/transport/nrfutil-rtt";

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
