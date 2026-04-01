export class TransportError extends Error {
  exitCode?: number;
  reason?: string;

  constructor(message: string, exitCode?: number, reason?: string) {
    super(message);
    this.name = "TransportError";
    this.exitCode = exitCode;
    this.reason = reason;
    // Restore prototype chain (required when extending built-in classes in TypeScript)
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface ErrorAction {
  label: string;
  command: string;
  args?: unknown[];
}

export interface LogScopeError {
  code: string;
  headline: string;
  detail: string;
  actions: ErrorAction[];
  severity: "error" | "warning";
}

const ACTION_RESCAN: ErrorAction = { label: "Rescan", command: "rescan" };
const ACTION_RETRY: ErrorAction = { label: "Retry", command: "retry" };
const ACTION_RECONNECT: ErrorAction = { label: "Reconnect", command: "reconnect" };
const ACTION_DOWNLOAD_PYTHON: ErrorAction = { label: "Download Python", command: "downloadPython" };

function makeResetDeviceAction(serialNumber?: string): ErrorAction {
  const validSerial = serialNumber && /^\d+$/.test(serialNumber) ? serialNumber : undefined;
  return validSerial
    ? { label: "Reset Device", command: "resetDevice", args: [validSerial] }
    : { label: "Reset Device", command: "resetDevice" };
}

function sanitizeErrorDetail(message: string): string {
  let sanitized = message.replace(/\/Users\/\S+/g, "<path>");
  sanitized = sanitized.replace(/\/Applications\/\S+/g, "<path>");
  sanitized = sanitized.replace(/[A-Z]:\\[\w\\]+/g, "<path>");
  sanitized = sanitized.replace(/\/home\/\S+/g, "<path>");
  sanitized = sanitized.replace(/\/tmp\/\S+/g, "<path>");
  if (sanitized.length > 250) {
    sanitized = sanitized.substring(0, 250) + "...";
  }
  return sanitized;
}

export function classifyError(
  message: string,
  exitCode?: number,
  serialNumber?: string
): LogScopeError {
  const msg = message;
  const msgLower = message.toLowerCase();

  // ── Message patterns (most specific, checked first) ──────────────────────

  if (msg.includes("Python 3 not found")) {
    return {
      code: "NO_PYTHON",
      headline: "Python 3 required",
      detail:
        "LogScope needs Python 3 for device communication.",
      actions: [ACTION_DOWNLOAD_PYTHON],
      severity: "error",
    };
  }

  if (msg.includes("Failed to create Python venv") || msg.includes("Failed to install")) {
    return {
      code: "VENV_FAILED",
      headline: "Setup failed",
      detail:
        "LogScope couldn't install required Python packages. Check your internet connection and try again.",
      actions: [ACTION_RETRY],
      severity: "warning",
    };
  }

  if (msgLower.includes("timed out")) {
    return {
      code: "TIMEOUT",
      headline: "Connection timed out",
      detail:
        "The device didn't respond within 15 seconds. Check that firmware is running and the board isn't halted by another debugger.",
      actions: [ACTION_RETRY],
      severity: "warning",
    };
  }

  if (msg.includes("RTT magic mismatch")) {
    return {
      code: "RTT_ADDR_INVALID",
      headline: "RTT address invalid",
      detail:
        "Found data at the RTT address but it's not a valid RTT control block. The firmware may use a non-standard RTT address — check your build configuration.",
      actions: [ACTION_RESCAN],
      severity: "warning",
    };
  }

  if (msg.includes("no longer connected") || msg.includes("No J-Link probes connected")) {
    return {
      code: "PROBE_UNPLUGGED",
      headline: "Device disconnected",
      detail: "The J-Link probe was physically disconnected.",
      actions: [ACTION_RESCAN],
      severity: "error",
    };
  }

  if (
    msg.includes("too many failed reconnect attempts") ||
    msg.includes("giving up after repeated failures")
  ) {
    return {
      code: "RECONNECT_FAILED",
      headline: "Connection lost",
      detail:
        "LogScope lost the connection and couldn't recover after multiple attempts. Try resetting the board or reconnecting the USB cable.",
      actions: [ACTION_RECONNECT],
      severity: "warning",
    };
  }

  if (msg.includes("No serial ports found")) {
    return {
      code: "NO_SERIAL_PORTS",
      headline: "No serial ports found",
      detail:
        "No USB serial devices detected. Connect your board and check that the USB cable supports data (not charge-only).",
      actions: [ACTION_RESCAN],
      severity: "warning",
    };
  }

  // Check "disconnected" patterns before "open failed" — a message like
  // "could not open port...No such file or directory" means the device is
  // gone, not that the port is busy.
  if (
    msg.includes("Serial device disconnected") ||
    msgLower.includes("no such file or directory")
  ) {
    return {
      code: "UART_DISCONNECTED",
      headline: "Serial device disconnected",
      detail: "The USB serial device was unplugged or powered off.",
      actions: [ACTION_RESCAN],
      severity: "error",
    };
  }

  if (
    msg.includes("port is already open") ||
    msgLower.includes("permission denied") ||
    msgLower.includes("cannot open") ||
    msgLower.includes("could not open port")
  ) {
    return {
      code: "UART_OPEN_FAILED",
      headline: "Could not open serial port",
      detail:
        "The port may be in use by another application (e.g., another terminal, VS Code Serial Monitor). Close other connections and try again.",
      actions: [ACTION_RETRY],
      severity: "warning",
    };
  }

  // ── Exit code fallback ────────────────────────────────────────────────────

  if (exitCode === 3) {
    return {
      code: "NO_PROBE",
      headline: "No J-Link probe found",
      detail:
        "Connect your board via USB and make sure the debug probe is powered on.",
      actions: [ACTION_RESCAN],
      severity: "error",
    };
  }

  if (exitCode === 2) {
    return {
      code: "NO_RTT",
      headline: "No RTT control block found",
      detail:
        "The J-Link probe connected to the target successfully, but no RTT control block was found in memory. This means the firmware on the device does not include SEGGER RTT logging, or the RTT search range does not cover the control block address. If your firmware has RTT enabled, try resetting the device or adjusting the RTT search range in settings (logscope.jlink.rttSearchRanges).",
      actions: [makeResetDeviceAction(serialNumber), ACTION_RESCAN],
      severity: "warning",
    };
  }

  if (exitCode === 4) {
    return {
      code: "RECONNECT_FAILED",
      headline: "Connection lost",
      detail:
        "LogScope lost the connection and couldn't recover after multiple attempts. Try resetting the board or reconnecting the USB cable.",
      actions: [ACTION_RECONNECT],
      severity: "warning",
    };
  }

  // ── Generic fallback ──────────────────────────────────────────────────────

  return {
    code: "GENERIC",
    headline: "Connection error",
    detail: sanitizeErrorDetail(message),
    actions: [ACTION_RETRY],
    severity: "warning",
  };
}
