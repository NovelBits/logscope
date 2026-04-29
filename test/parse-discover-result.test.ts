import { parseDiscoverResult } from "../src/transport/nrfutil-rtt";

describe("parseDiscoverResult", () => {
  it("returns devices from valid JSON stdout", () => {
    const stdout = JSON.stringify({
      devices: [
        { serial: 1057721387, targetName: "nRF54L15", device: "NRF54L15_M33" },
      ],
    });
    const result = parseDiscoverResult(stdout, "", 0);
    expect(result.devices).toHaveLength(1);
    expect(result.devices[0].serial).toBe(1057721387);
    expect(result.error).toBeUndefined();
  });

  it("returns empty devices and helper error from JSON error field", () => {
    const stdout = JSON.stringify({
      error: "SEGGER J-Link Software not found at /Applications/SEGGER/",
      devices: [],
    });
    const result = parseDiscoverResult(stdout, "", 0);
    expect(result.devices).toEqual([]);
    expect(result.error).toContain("SEGGER J-Link Software not found");
  });

  it("returns empty devices for valid empty-array JSON", () => {
    const result = parseDiscoverResult(JSON.stringify({ devices: [] }), "", 0);
    expect(result.devices).toEqual([]);
    expect(result.error).toBeUndefined();
  });

  // Regression: this was the v0.5.7-v0.5.9 bug. os._exit() bypassed stdout flush,
  // so the helper exited with code 0 + empty stdout, and the user saw a useless
  // "Using J-Link DLL: ..." stderr line treated as if it were the error.
  it("flags exit-0 + empty stdout as a likely bug, not a 'no devices' state", () => {
    const stderr = "Using J-Link DLL: /Applications/SEGGER/JLink_V924a/libjlinkarm.dylib";
    const result = parseDiscoverResult("", stderr, 0);
    expect(result.devices).toEqual([]);
    expect(result.error).toContain("Discovery helper produced no output");
    expect(result.error).toContain("LogScope bug");
    expect(result.error).toContain("github.com/NovelBits/logscope/issues");
  });

  it("flags exit-0 + whitespace-only stdout as a likely bug too", () => {
    const result = parseDiscoverResult("   \n\n  ", "", 0);
    expect(result.error).toContain("Discovery helper produced no output");
  });

  it("surfaces ERROR: stderr line when stdout is invalid JSON", () => {
    const stdout = "not-valid-json";
    const stderr = "Using J-Link DLL: /Applications/SEGGER/JLink_V924a/libjlinkarm.dylib\nERROR: SEGGER J-Link Software not found at /Applications/SEGGER/";
    const result = parseDiscoverResult(stdout, stderr, 5);
    expect(result.error).toContain("SEGGER J-Link Software not found");
  });

  it("surfaces Python Traceback line when stderr has one", () => {
    const stderr = "Some preamble\nTraceback (most recent call last):\n  File ...\nValueError: bad input";
    const result = parseDiscoverResult("", stderr, 1);
    expect(result.error).toContain("Traceback");
  });

  it("falls back to last non-empty stderr line", () => {
    const stderr = "first line\n\n  \nlast line";
    const result = parseDiscoverResult("", stderr, 1);
    expect(result.error).toBe("last line");
  });

  it("uses generic message when stdout is invalid JSON and stderr is empty (and exit non-zero so we don't trigger the bug detector)", () => {
    const result = parseDiscoverResult("garbage", "", 1);
    expect(result.error).toBe("Device discovery failed");
  });

  it("does NOT flag empty-stdout when exit code is non-zero (process crashed, real failure)", () => {
    const result = parseDiscoverResult("", "Segmentation fault", 139);
    expect(result.error).not.toContain("Discovery helper produced no output");
    expect(result.error).toBe("Segmentation fault");
  });
});
