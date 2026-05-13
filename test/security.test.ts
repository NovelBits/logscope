import { classifyError } from "../src/errors";

describe("Security: error message sanitization", () => {
  it("generic fallback does not expose file system paths", () => {
    const error = classifyError("/Users/mafaneh/.logscope/venv/bin/python3: No such file");
    // "No such file" triggers UART_DISCONNECTED via "no such file or directory" check,
    // but a path-only message without that pattern should hit GENERIC
    const pathOnly = classifyError("/Users/mafaneh/.logscope/venv/bin/python3 crashed unexpectedly");
    expect(pathOnly.code).toBe("GENERIC");
    expect(pathOnly.detail).not.toContain("/Users/");
  });

  it("generic fallback does not expose DLL paths", () => {
    const error = classifyError("Error loading /Applications/SEGGER/JLink_V924a/libjlinkarm.dylib");
    expect(error.code).toBe("GENERIC");
    expect(error.detail).not.toContain("/Applications/");
  });

  it("generic fallback does not expose Windows paths", () => {
    const error = classifyError("Error loading C:\\Program\\SEGGER\\jlink.dll");
    expect(error.code).toBe("GENERIC");
    expect(error.detail).not.toContain("C:\\");
  });

  it("generic fallback does not expose Linux home paths", () => {
    const error = classifyError("Crash in /home/user/.logscope/venv/bin/python3");
    expect(error.code).toBe("GENERIC");
    expect(error.detail).not.toContain("/home/");
  });

  it("generic fallback does not expose /tmp paths", () => {
    const error = classifyError("Error reading /tmp/logscope-session-abc123");
    expect(error.code).toBe("GENERIC");
    expect(error.detail).not.toContain("/tmp/");
  });

  it("generic fallback truncates very long error messages", () => {
    const longMsg = "x".repeat(1000);
    const error = classifyError(longMsg);
    expect(error.code).toBe("GENERIC");
    expect(error.detail.length).toBeLessThanOrEqual(253); // 250 + "..."
  });

  it("generic fallback preserves short safe messages as-is", () => {
    const error = classifyError("some completely unknown error text");
    expect(error.code).toBe("GENERIC");
    expect(error.detail).toBe("some completely unknown error text");
  });
});

describe("Security: serial number validation", () => {
  it("passes valid numeric serial to Reset Device action", () => {
    const error = classifyError("some error", 2, "1057789294");
    const resetAction = error.actions.find((a) => a.command === "resetDevice");
    expect(resetAction?.args).toEqual(["1057789294"]);
  });

  it("strips non-numeric serial from Reset Device action", () => {
    const error = classifyError("some error", 2, "1234; rm -rf /");
    const resetAction = error.actions.find((a) => a.command === "resetDevice");
    expect(resetAction?.args).toBeUndefined();
  });

  it("handles empty serial gracefully", () => {
    const error = classifyError("some error", 2, "");
    const resetAction = error.actions.find((a) => a.command === "resetDevice");
    expect(resetAction?.args).toBeUndefined();
  });

  it("rejects serial with spaces", () => {
    const error = classifyError("some error", 2, "1234 5678");
    const resetAction = error.actions.find((a) => a.command === "resetDevice");
    expect(resetAction?.args).toBeUndefined();
  });

  it("allows alphanumeric identifiers (hex, hostnames)", () => {
    const error1 = classifyError("some error", 2, "0x1234ABCD");
    const resetAction1 = error1.actions.find((a) => a.command === "resetDevice");
    expect(resetAction1?.args).toEqual(["0x1234ABCD"]);

    const error2 = classifyError("some error", 2, "192.168.1.100:19020");
    const resetAction2 = error2.actions.find((a) => a.command === "resetDevice");
    expect(resetAction2?.args).toEqual(["192.168.1.100:19020"]);
  });
});

describe("Security: action command allowlist", () => {
  it("only known action commands exist in error objects", () => {
    const ALLOWED = ["rescan", "reconnect", "retry", "resetDevice", "downloadPython", "downloadSegger", "setJlinkDevice"];
    const testMessages = [
      "Python 3 not found",
      "Failed to install",
      "timed out",
      "no longer connected",
      "too many failed reconnect attempts",
      "No serial ports found",
      "Serial device disconnected",
      "Could not connect",
      "RTT magic mismatch",
    ];
    for (const msg of testMessages) {
      const error = classifyError(msg);
      for (const action of error.actions) {
        expect(ALLOWED).toContain(action.command);
      }
    }
  });

  it("exit code paths also use only allowed commands", () => {
    const ALLOWED = ["rescan", "reconnect", "retry", "resetDevice", "downloadPython", "downloadSegger", "setJlinkDevice"];
    for (const code of [2, 3, 4]) {
      const error = classifyError("unknown", code);
      for (const action of error.actions) {
        expect(ALLOWED).toContain(action.command);
      }
    }
  });
});
