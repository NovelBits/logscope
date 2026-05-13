import { TransportError, classifyError } from "../src/errors";

describe("TransportError", () => {
  it("preserves message, exitCode, and reason", () => {
    const err = new TransportError("something went wrong", 3, "probe missing");
    expect(err.message).toBe("something went wrong");
    expect(err.exitCode).toBe(3);
    expect(err.reason).toBe("probe missing");
    expect(err.name).toBe("TransportError");
  });

  it("defaults exitCode and reason to undefined when not provided", () => {
    const err = new TransportError("oops");
    expect(err.exitCode).toBeUndefined();
    expect(err.reason).toBeUndefined();
  });
});

describe("classifyError — message pattern matching", () => {
  it("maps 'Python 3 not found' to NO_PYTHON", () => {
    const result = classifyError("Python 3 not found on this system");
    expect(result.code).toBe("NO_PYTHON");
    expect(result.severity).toBe("error");
    expect(result.actions.some((a) => a.command === "downloadPython")).toBe(true);
  });

  it("maps 'Failed to create Python venv' to VENV_FAILED", () => {
    const result = classifyError("Failed to create Python venv in /tmp/logscope");
    expect(result.code).toBe("VENV_FAILED");
    expect(result.severity).toBe("warning");
    expect(result.actions.some((a) => a.command === "retry")).toBe(true);
  });

  it("maps 'Failed to install' to VENV_FAILED", () => {
    const result = classifyError("Failed to install pylink-square");
    expect(result.code).toBe("VENV_FAILED");
    expect(result.severity).toBe("warning");
  });

  it("maps 'timed out' (case-insensitive) to TIMEOUT", () => {
    const result = classifyError("Connection Timed Out after 15 seconds");
    expect(result.code).toBe("TIMEOUT");
    expect(result.severity).toBe("warning");
    expect(result.actions.some((a) => a.command === "retry")).toBe(true);
  });

  it("maps 'RTT magic mismatch' to RTT_ADDR_INVALID", () => {
    const result = classifyError("RTT magic mismatch at address 0x20004050");
    expect(result.code).toBe("RTT_ADDR_INVALID");
    expect(result.severity).toBe("warning");
    expect(result.actions.some((a) => a.command === "rescan")).toBe(true);
  });

  it("maps 'no longer connected' to PROBE_UNPLUGGED", () => {
    const result = classifyError("Device is no longer connected");
    expect(result.code).toBe("PROBE_UNPLUGGED");
    expect(result.severity).toBe("error");
    expect(result.actions.some((a) => a.command === "rescan")).toBe(true);
  });

  it("maps 'No J-Link probes connected' to PROBE_UNPLUGGED", () => {
    const result = classifyError("No J-Link probes connected");
    expect(result.code).toBe("PROBE_UNPLUGGED");
    expect(result.severity).toBe("error");
  });

  it("maps 'too many failed reconnect attempts' to RECONNECT_FAILED", () => {
    const result = classifyError("too many failed reconnect attempts");
    expect(result.code).toBe("RECONNECT_FAILED");
    expect(result.severity).toBe("warning");
    expect(result.actions.some((a) => a.command === "reconnect")).toBe(true);
  });

  it("maps 'giving up after repeated failures' to RECONNECT_FAILED", () => {
    const result = classifyError("giving up after repeated failures");
    expect(result.code).toBe("RECONNECT_FAILED");
  });

  it("maps 'No serial ports found' to NO_SERIAL_PORTS", () => {
    const result = classifyError("No serial ports found on this system");
    expect(result.code).toBe("NO_SERIAL_PORTS");
    expect(result.severity).toBe("warning");
    expect(result.actions.some((a) => a.command === "rescan")).toBe(true);
  });

  it("maps 'port is already open' to UART_OPEN_FAILED", () => {
    const result = classifyError("port is already open");
    expect(result.code).toBe("UART_OPEN_FAILED");
    expect(result.severity).toBe("warning");
    expect(result.actions.some((a) => a.command === "retry")).toBe(true);
  });

  it("maps 'Permission denied' (case-insensitive) to UART_OPEN_FAILED", () => {
    const result = classifyError("Permission denied: /dev/ttyUSB0");
    expect(result.code).toBe("UART_OPEN_FAILED");
  });

  it("maps 'cannot open' (case-insensitive) to UART_OPEN_FAILED", () => {
    const result = classifyError("Cannot open /dev/ttyACM0");
    expect(result.code).toBe("UART_OPEN_FAILED");
  });

  it("maps 'could not open port' to UART_OPEN_FAILED", () => {
    const result = classifyError("[Errno 2] could not open port /dev/cu.usbmodem0010502431971: [Errno 2] No such file or directory");
    expect(result.code).toBe("UART_DISCONNECTED");
  });

  it("maps 'No such file or directory' to UART_DISCONNECTED", () => {
    const result = classifyError("No such file or directory: '/dev/ttyUSB0'");
    expect(result.code).toBe("UART_DISCONNECTED");
  });

  it("maps 'Serial device disconnected' to UART_DISCONNECTED", () => {
    const result = classifyError("Serial device disconnected");
    expect(result.code).toBe("UART_DISCONNECTED");
    expect(result.severity).toBe("error");
    expect(result.actions.some((a) => a.command === "rescan")).toBe(true);
  });

  it("maps 'JLinkReadException: Unspecified error' to JLINK_READ_FAILED with set-device action", () => {
    const traceback =
      "Traceback (most recent call last):\n" +
      '  File "rtt-helper.py", line 995, in run_pylink_direct\n' +
      "    session.attach(search_ranges)\n" +
      "pylink.errors.JLinkReadException: Unspecified error.";
    const result = classifyError(traceback, 1);
    expect(result.code).toBe("JLINK_READ_FAILED");
    expect(result.severity).toBe("error");
    expect(result.actions.some((a) => a.command === "setJlinkDevice")).toBe(true);
    expect(result.actions.some((a) => a.command === "retry")).toBe(true);
  });

  it("NO_RTT (exit code 2) offers setJlinkDevice as a remediation action", () => {
    const result = classifyError("", 2);
    expect(result.code).toBe("NO_RTT");
    expect(result.actions.some((a) => a.command === "setJlinkDevice")).toBe(true);
  });
});

describe("classifyError — exit code fallback", () => {
  it("maps exit code 3 to NO_PROBE", () => {
    const result = classifyError("some generic error", 3);
    expect(result.code).toBe("NO_PROBE");
    expect(result.severity).toBe("error");
    expect(result.actions.some((a) => a.command === "rescan")).toBe(true);
  });

  it("NO_PROBE detail lists common causes including contention", () => {
    const result = classifyError("", 3);
    expect(result.detail).toContain("Common causes");
    expect(result.detail).toContain("nRF Connect");
    expect(result.detail).toContain("USB");
  });

  it("maps exit code 5 to NO_SEGGER with download action", () => {
    const result = classifyError("", 5);
    expect(result.code).toBe("NO_SEGGER");
    expect(result.severity).toBe("error");
    expect(result.actions.some((a) => a.command === "downloadSegger")).toBe(true);
  });

  it("matches 'SEGGER J-Link Software not found' message text to NO_SEGGER", () => {
    const result = classifyError("ERROR: SEGGER J-Link Software not found at /Applications/SEGGER/");
    expect(result.code).toBe("NO_SEGGER");
  });

  it("maps exit code 2 to NO_RTT", () => {
    const result = classifyError("some generic error", 2);
    expect(result.code).toBe("NO_RTT");
    expect(result.severity).toBe("warning");
    expect(result.actions.some((a) => a.command === "resetDevice")).toBe(true);
    expect(result.actions.some((a) => a.command === "rescan")).toBe(true);
  });

  it("maps exit code 4 to RECONNECT_FAILED", () => {
    const result = classifyError("some generic error", 4);
    expect(result.code).toBe("RECONNECT_FAILED");
    expect(result.severity).toBe("warning");
    expect(result.actions.some((a) => a.command === "reconnect")).toBe(true);
  });
});

describe("classifyError — NO_RTT serialNumber injection", () => {
  it("injects serialNumber as args on resetDevice action when provided", () => {
    const result = classifyError("no rtt", 2, "000682123456");
    const resetAction = result.actions.find((a) => a.command === "resetDevice");
    expect(resetAction).toBeDefined();
    expect(resetAction!.args).toEqual(["000682123456"]);
  });

  it("leaves resetDevice args undefined when no serialNumber provided", () => {
    const result = classifyError("no rtt", 2);
    const resetAction = result.actions.find((a) => a.command === "resetDevice");
    expect(resetAction).toBeDefined();
    expect(resetAction!.args).toBeUndefined();
  });
});

describe("classifyError — generic fallback", () => {
  it("falls back to GENERIC and passes raw message as detail", () => {
    const result = classifyError("some completely unknown error text");
    expect(result.code).toBe("GENERIC");
    expect(result.severity).toBe("warning");
    expect(result.detail).toBe("some completely unknown error text");
    expect(result.actions.some((a) => a.command === "retry")).toBe(true);
  });
});

describe("classifyError — message pattern wins over exit code", () => {
  it("uses message pattern when both message matches and exit code are present", () => {
    // Message matches TIMEOUT, exit code 3 would be NO_PROBE
    const result = classifyError("Connection timed out", 3);
    expect(result.code).toBe("TIMEOUT");
  });

  it("uses NO_PYTHON message pattern over exit code 2", () => {
    const result = classifyError("Python 3 not found", 2);
    expect(result.code).toBe("NO_PYTHON");
  });
});

describe("classifyError — LogScopeError shape", () => {
  it("returns a complete LogScopeError with all required fields", () => {
    const result = classifyError("some generic error", 3);
    expect(typeof result.code).toBe("string");
    expect(typeof result.headline).toBe("string");
    expect(typeof result.detail).toBe("string");
    expect(Array.isArray(result.actions)).toBe(true);
    expect(result.severity === "error" || result.severity === "warning").toBe(true);
  });

  it("each action has label and command properties", () => {
    const result = classifyError("No serial ports found");
    for (const action of result.actions) {
      expect(typeof action.label).toBe("string");
      expect(typeof action.command).toBe("string");
    }
  });
});
