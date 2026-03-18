/**
 * Pure utility functions for formatting HCI field values
 * used in Bluetooth LE packet decoding.
 */

/** Format a 6-byte little-endian Bluetooth LE address as XX:XX:XX:XX:XX:XX */
export function formatAddress(buf: Buffer, offset: number): string {
  const bytes: string[] = [];
  for (let i = 5; i >= 0; i--) {
    bytes.push(buf[offset + i].toString(16).toUpperCase().padStart(2, "0"));
  }
  return bytes.join(":");
}

/** Map address type byte to a human-readable string */
export function formatAddressType(type: number): string {
  switch (type) {
    case 0x00:
      return "Public";
    case 0x01:
      return "Random";
    default:
      return `Unknown (0x${type.toString(16).toUpperCase().padStart(2, "0")})`;
  }
}

/** Map PHY code to a human-readable name */
export function formatPhyName(phy: number): string {
  switch (phy) {
    case 1:
      return "1M";
    case 2:
      return "2M";
    case 3:
      return "Coded";
    default:
      return `Unknown (0x${phy.toString(16).toUpperCase().padStart(2, "0")})`;
  }
}

/** Map connection role byte to Central/Peripheral */
export function formatRole(role: number): string {
  switch (role) {
    case 0x00:
      return "Central";
    case 0x01:
      return "Peripheral";
    default:
      return `Unknown (0x${role.toString(16).toUpperCase().padStart(2, "0")})`;
  }
}

/** Format a connection interval raw value (units of 1.25 ms) */
export function formatInterval(raw: number): string {
  const ms = (raw * 1.25).toFixed(2);
  return `${raw} (${ms} ms)`;
}

/** Format a supervision timeout raw value (units of 10 ms) */
export function formatTimeout(raw: number): string {
  const ms = raw * 10;
  return `${raw} (${ms} ms)`;
}

const HCI_ERROR_CODES: Record<number, string> = {
  0x00: "Success",
  0x01: "Unknown HCI Command",
  0x02: "Unknown Connection Identifier",
  0x05: "Authentication Failure",
  0x06: "PIN or Key Missing",
  0x07: "Memory Capacity Exceeded",
  0x08: "Connection Timeout",
  0x0c: "Command Disallowed",
  0x11: "Unsupported Feature",
  0x12: "Invalid HCI Command Parameters",
  0x13: "Remote User Terminated Connection",
  0x16: "Connection Terminated by Local Host",
  0x1a: "Unsupported Remote Feature",
  0x22: "LMP Response Timeout",
  0x28: "Instant Passed",
  0x2a: "Different Transaction Collision",
  0x3b: "Unacceptable Connection Parameters",
  0x3e: "Connection Failed to be Established",
};

/** Look up an HCI error/status code */
export function hciErrorCode(code: number): string {
  return (
    HCI_ERROR_CODES[code] ??
    `Unknown (0x${code.toString(16).toUpperCase().padStart(2, "0")})`
  );
}

const ATT_OPCODES: Record<number, string> = {
  0x01: "Error Response",
  0x02: "Exchange MTU Request",
  0x03: "Exchange MTU Response",
  0x04: "Find Information Request",
  0x05: "Find Information Response",
  0x06: "Find By Type Value Request",
  0x07: "Find By Type Value Response",
  0x08: "Read By Type Request",
  0x09: "Read By Type Response",
  0x0a: "Read Request",
  0x0b: "Read Response",
  0x10: "Find By Group Type Request",
  0x11: "Find By Group Type Response",
  0x12: "Write Request",
  0x13: "Write Response",
  0x1b: "Handle Value Notification",
  0x1d: "Handle Value Indication",
  0x1e: "Handle Value Confirmation",
  0x52: "Write Command",
};

/** Look up an ATT opcode name */
export function attOpcodeName(opcode: number): string {
  return (
    ATT_OPCODES[opcode] ??
    `ATT 0x${opcode.toString(16).toUpperCase().padStart(2, "0")}`
  );
}
