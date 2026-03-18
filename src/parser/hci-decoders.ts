/**
 * HCI packet decoders for Bluetooth LE command, event, and ACL packets.
 * Quick-look decoding: shows essential developer-relevant fields only.
 */

import { DecodedField, DecodedPacket } from "./types";
import {
  formatAddress,
  formatAddressType,
  formatPhyName,
  formatRole,
  formatInterval,
  formatTimeout,
  hciErrorCode,
  attOpcodeName,
} from "./hci-field-types";
import { commandName } from "./hci-opcodes";
import { HciConnectionTracker } from "./hci-connection-tracker";

const COLOR_ERROR = "#f44747";
const COLOR_ADDRESS = "#3794ff";

/** Create a DecodedField, optionally with a color */
function field(name: string, value: string, color?: string): DecodedField {
  return color ? { name, value, color } : { name, value };
}

/** Format a 16-bit handle as 0xNNNN */
function fmtHandle(h: number): string {
  return `0x${h.toString(16).toUpperCase().padStart(4, "0")}`;
}

/** Create a status field with red color for non-zero */
function statusField(name: string, code: number): DecodedField {
  const text = hciErrorCode(code);
  return code !== 0x00 ? field(name, text, COLOR_ERROR) : field(name, text);
}

// ---------------------------------------------------------------------------
// AD Structure decoding for Bluetooth LE advertising data
// ---------------------------------------------------------------------------

/** Decode AD flags byte into a human-readable string */
function decodeAdFlags(flags: number): string {
  const parts: string[] = [];
  if (flags & 0x01) parts.push("LE Limited Discoverable");
  if (flags & 0x02) parts.push("LE General Discoverable");
  if (flags & 0x04) parts.push("BR/EDR Not Supported");
  if (flags & 0x08) parts.push("LE+BR/EDR Controller");
  if (flags & 0x10) parts.push("LE+BR/EDR Host");
  return parts.length > 0 ? parts.join(", ") : `0x${flags.toString(16).toUpperCase().padStart(2, "0")}`;
}

/** Format a 128-bit UUID from a 16-byte LE buffer segment */
function format128BitUuid(buf: Buffer, offset: number): string {
  // UUID stored in LE; convert to standard big-endian string format
  const hex = Array.from(buf.subarray(offset, offset + 16))
    .reverse()
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Decode AD structures from Bluetooth LE advertising/scan response data.
 * Each AD structure: [length:1][type:1][data:length-1].
 * Returns DecodedField[] for each recognized AD type plus an optional device name.
 */
export function decodeAdStructures(
  data: Buffer,
  startOffset: number,
  length: number
): DecodedField[] {
  const fields: DecodedField[] = [];
  let pos = startOffset;
  const endOffset = startOffset + length;

  while (pos < endOffset) {
    if (pos >= data.length) break;
    const adLen = data[pos];
    if (adLen === 0) break; // zero-length terminates
    if (pos + adLen >= data.length || pos + adLen >= endOffset) break; // bounds check

    const adType = data[pos + 1];
    const adDataStart = pos + 2;
    const adDataLen = adLen - 1;

    switch (adType) {
      // Flags
      case 0x01: {
        if (adDataLen >= 1) {
          fields.push(field("AD Flags", decodeAdFlags(data[adDataStart])));
        }
        break;
      }

      // 16-bit UUID lists (Incomplete / Complete)
      case 0x02:
      case 0x03: {
        const uuids: string[] = [];
        for (let i = 0; i + 1 < adDataLen; i += 2) {
          if (adDataStart + i + 1 < data.length) {
            const uuid16 = data.readUInt16LE(adDataStart + i);
            uuids.push(`0x${uuid16.toString(16).toUpperCase().padStart(4, "0")}`);
          }
        }
        const label = adType === 0x02 ? "16-bit UUIDs (Incomplete)" : "16-bit UUIDs (Complete)";
        fields.push(field(label, uuids.join(", ")));
        break;
      }

      // 128-bit UUID lists (Incomplete / Complete)
      case 0x06:
      case 0x07: {
        const uuids: string[] = [];
        for (let i = 0; i + 15 < adDataLen; i += 16) {
          if (adDataStart + i + 15 < data.length) {
            uuids.push(format128BitUuid(data, adDataStart + i));
          }
        }
        const label = adType === 0x06 ? "128-bit UUIDs (Incomplete)" : "128-bit UUIDs (Complete)";
        fields.push(field(label, uuids.join(", ")));
        break;
      }

      // Shortened / Complete Local Name
      case 0x08:
      case 0x09: {
        const end = Math.min(adDataStart + adDataLen, data.length);
        const name = data.subarray(adDataStart, end).toString("utf-8");
        const label = adType === 0x08 ? "Shortened Local Name" : "Complete Local Name";
        fields.push(field(label, `"${name}"`));
        break;
      }

      // TX Power Level
      case 0x0a: {
        if (adDataLen >= 1 && adDataStart < data.length) {
          const txPower = data.readInt8(adDataStart);
          fields.push(field("TX Power Level", `${txPower} dBm`));
        }
        break;
      }

      // Manufacturer Specific Data
      case 0xff: {
        if (adDataLen >= 2 && adDataStart + 1 < data.length) {
          const companyId = data.readUInt16LE(adDataStart);
          const companyHex = `0x${companyId.toString(16).toUpperCase().padStart(4, "0")}`;
          const msdEnd = Math.min(adDataStart + adDataLen, data.length);
          const msdData = Array.from(data.subarray(adDataStart + 2, msdEnd))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join(" ");
          fields.push(
            field("Manufacturer Data", `Company: ${companyHex}, Data: ${msdData || "(empty)"}`)
          );
        }
        break;
      }

      default: {
        // Unknown AD type — show raw hex
        const rawEnd = Math.min(adDataStart + adDataLen, data.length);
        const rawHex = Array.from(data.subarray(adDataStart, rawEnd))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join(" ");
        fields.push(
          field(
            `AD Type 0x${adType.toString(16).toUpperCase().padStart(2, "0")}`,
            rawHex || "(empty)"
          )
        );
        break;
      }
    }

    pos += adLen + 1;
  }

  return fields;
}

/**
 * Internal helper for the LE Advertising Report decoder.
 * Returns parsed AD structures with an optional extracted device name.
 */
function parseAdStructures(
  data: Buffer,
  startOffset: number,
  endOffset: number
): { fields: DecodedField[]; name?: string }[] {
  const adFields = decodeAdStructures(data, startOffset, endOffset - startOffset);
  // Extract device name from Complete/Shortened Local Name fields
  let name: string | undefined;
  for (const f of adFields) {
    if (f.name === "Complete Local Name" || f.name === "Shortened Local Name") {
      // Strip surrounding quotes
      name = f.value.replace(/^"|"$/g, "");
      break;
    }
  }
  return [{ fields: adFields, name }];
}

// ---------------------------------------------------------------------------
// Command decoders
// ---------------------------------------------------------------------------

type CommandDecoder = (payload: Buffer) => DecodedPacket | null;

const commandDecoders: Record<number, CommandDecoder> = {
  // Disconnect
  0x0406: (p) => {
    if (p.length < 6) return null;
    const handle = p.readUInt16LE(3) & 0x0fff;
    const reason = p[5];
    return {
      summary: `(handle: ${fmtHandle(handle)}, reason: ${hciErrorCode(reason)})`,
      fields: [
        field("Handle", fmtHandle(handle)),
        statusField("Reason", reason),
      ],
    };
  },

  // LE Create Connection
  0x200d: (p) => {
    if (p.length < 24) return null;
    const scanInterval = p.readUInt16LE(3);
    const scanWindow = p.readUInt16LE(5);
    const filterPolicy = p[7];
    const peerAddrType = p[8];
    const peerAddr = formatAddress(p, 9);
    const ownAddrType = p[15];
    const connIntervalMin = p.readUInt16LE(16);
    const connIntervalMax = p.readUInt16LE(18);
    const latency = p.readUInt16LE(20);
    const timeout = p.readUInt16LE(22);
    return {
      summary: `(addr: ${peerAddr}, interval: ${formatInterval(connIntervalMin)}-${formatInterval(connIntervalMax)})`,
      fields: [
        field("Scan Interval", scanInterval.toString()),
        field("Scan Window", scanWindow.toString()),
        field("Filter Policy", filterPolicy.toString()),
        field("Peer Address Type", formatAddressType(peerAddrType)),
        field("Peer Address", peerAddr, COLOR_ADDRESS),
        field("Own Address Type", formatAddressType(ownAddrType)),
        field("Conn Interval Min", formatInterval(connIntervalMin)),
        field("Conn Interval Max", formatInterval(connIntervalMax)),
        field("Latency", latency.toString()),
        field("Supervision Timeout", formatTimeout(timeout)),
      ],
    };
  },

  // LE Set Advertising Parameters
  0x2006: (p) => {
    if (p.length < 8) return null;
    const advIntervalMin = p.readUInt16LE(3);
    const advIntervalMax = p.readUInt16LE(5);
    const advType = p[7];
    return {
      summary: `(interval: ${advIntervalMin}-${advIntervalMax}, type: ${advType})`,
      fields: [
        field("Adv Interval Min", advIntervalMin.toString()),
        field("Adv Interval Max", advIntervalMax.toString()),
        field("Adv Type", advType.toString()),
      ],
    };
  },

  // LE Set PHY
  0x2032: (p) => {
    if (p.length < 8) return null;
    const handle = p.readUInt16LE(3) & 0x0fff;
    const allPhys = p[5];
    const txPhy = p[6];
    const rxPhy = p[7];
    return {
      summary: `(tx: ${formatPhyName(txPhy)}, rx: ${formatPhyName(rxPhy)})`,
      fields: [
        field("Handle", fmtHandle(handle)),
        field("All PHYs", `0x${allPhys.toString(16).toUpperCase().padStart(2, "0")}`),
        field("TX PHY", formatPhyName(txPhy)),
        field("RX PHY", formatPhyName(rxPhy)),
      ],
    };
  },

  // LE Set Random Address
  0x2005: (p) => {
    if (p.length < 9) return null;
    const addr = formatAddress(p, 3);
    return {
      summary: `(addr: ${addr})`,
      fields: [field("Address", addr, COLOR_ADDRESS)],
    };
  },
};

/**
 * Decode an HCI command packet.
 * Payload starts with opcode(2) + paramLen(1), parameters at offset 3.
 */
export function decodeCommand(
  cmdOpcode: number,
  payload: Buffer
): DecodedPacket | null {
  const decoder = commandDecoders[cmdOpcode];
  if (!decoder) return null;
  return decoder(payload);
}

// ---------------------------------------------------------------------------
// Event decoders
// ---------------------------------------------------------------------------

type EventDecoder = (payload: Buffer) => DecodedPacket | null;

/** Decode LE Meta subevents */
function decodeLeMetaEvent(payload: Buffer): DecodedPacket | null {
  if (payload.length < 3) return null;
  const subevent = payload[2];

  switch (subevent) {
    // LE Connection Complete
    case 0x01: {
      if (payload.length < 19) return null;
      const status = payload[3];
      const handle = payload.readUInt16LE(4) & 0x0fff;
      const role = payload[6];
      const peerAddrType = payload[7];
      const peerAddr = formatAddress(payload, 8);
      const interval = payload.readUInt16LE(14);
      const latency = payload.readUInt16LE(16);
      const timeout = payload.readUInt16LE(18);
      return {
        summary: `(handle: ${fmtHandle(handle)}, addr: ${peerAddr}, role: ${formatRole(role)})`,
        fields: [
          statusField("Status", status),
          field("Handle", fmtHandle(handle)),
          field("Role", formatRole(role)),
          field("Peer Address Type", formatAddressType(peerAddrType)),
          field("Peer Address", peerAddr, COLOR_ADDRESS),
          field("Conn Interval", formatInterval(interval)),
          field("Latency", latency.toString()),
          field("Supervision Timeout", formatTimeout(timeout)),
        ],
      };
    }

    // LE Advertising Report
    case 0x02: {
      if (payload.length < 13) return null;
      const numReports = payload[3];
      const eventType = payload[4];
      const addrType = payload[5];
      const addr = formatAddress(payload, 6);
      const dataLen = payload[12];
      const rssiOffset = 13 + dataLen;
      const rssi =
        payload.length > rssiOffset
          ? payload.readInt8(rssiOffset)
          : undefined;
      const rssiStr = rssi !== undefined ? `${rssi} dBm` : "N/A";

      // Decode AD structures from the advertising data
      const adFields: DecodedField[] = [];
      let deviceName: string | undefined;
      const adStart = 13;
      const adEnd = 13 + dataLen;
      if (adEnd <= payload.length) {
        const adStructures = parseAdStructures(payload, adStart, adEnd);
        for (const ad of adStructures) {
          adFields.push(...ad.fields);
          if (ad.name) deviceName = ad.name;
        }
      }

      const summaryName = deviceName ? `, name: "${deviceName}"` : "";
      return {
        summary: `(addr: ${addr}${summaryName}, RSSI: ${rssiStr})`,
        fields: [
          field("Num Reports", numReports.toString()),
          field("Event Type", eventType.toString()),
          field("Address Type", formatAddressType(addrType)),
          field("Address", addr, COLOR_ADDRESS),
          field("Data Length", dataLen.toString()),
          ...adFields,
          ...(rssi !== undefined ? [field("RSSI", rssiStr)] : []),
        ],
      };
    }

    // LE Data Length Change
    case 0x07: {
      if (payload.length < 13) return null;
      const handle = payload.readUInt16LE(3) & 0x0fff;
      const maxTxOctets = payload.readUInt16LE(5);
      const maxTxTime = payload.readUInt16LE(7);
      const maxRxOctets = payload.readUInt16LE(9);
      const maxRxTime = payload.readUInt16LE(11);
      return {
        summary: `(tx: ${maxTxOctets} bytes/${maxTxTime}us, rx: ${maxRxOctets} bytes/${maxRxTime}us)`,
        fields: [
          field("Handle", fmtHandle(handle)),
          field("Max TX Octets", maxTxOctets.toString()),
          field("Max TX Time", `${maxTxTime} us`),
          field("Max RX Octets", maxRxOctets.toString()),
          field("Max RX Time", `${maxRxTime} us`),
        ],
      };
    }

    // LE Enhanced Connection Complete
    case 0x0a: {
      if (payload.length < 32) return null;
      const status = payload[3];
      const handle = payload.readUInt16LE(4) & 0x0fff;
      const role = payload[6];
      const peerAddrType = payload[7];
      const peerAddr = formatAddress(payload, 8);
      const interval = payload.readUInt16LE(14);
      const latency = payload.readUInt16LE(16);
      const timeout = payload.readUInt16LE(18);
      const localRpa = formatAddress(payload, 20);
      const peerRpa = formatAddress(payload, 26);
      return {
        summary: `(handle: ${fmtHandle(handle)}, addr: ${peerAddr}, role: ${formatRole(role)})`,
        fields: [
          statusField("Status", status),
          field("Handle", fmtHandle(handle)),
          field("Role", formatRole(role)),
          field("Peer Address Type", formatAddressType(peerAddrType)),
          field("Peer Address", peerAddr, COLOR_ADDRESS),
          field("Conn Interval", formatInterval(interval)),
          field("Latency", latency.toString()),
          field("Supervision Timeout", formatTimeout(timeout)),
          field("Local RPA", localRpa, COLOR_ADDRESS),
          field("Peer RPA", peerRpa, COLOR_ADDRESS),
        ],
      };
    }

    // LE PHY Update Complete
    case 0x0c: {
      if (payload.length < 8) return null;
      const status = payload[3];
      const handle = payload.readUInt16LE(4) & 0x0fff;
      const txPhy = payload[6];
      const rxPhy = payload[7];
      return {
        summary: `(tx: ${formatPhyName(txPhy)}, rx: ${formatPhyName(rxPhy)})`,
        fields: [
          statusField("Status", status),
          field("Handle", fmtHandle(handle)),
          field("TX PHY", formatPhyName(txPhy)),
          field("RX PHY", formatPhyName(rxPhy)),
        ],
      };
    }

    default:
      return null;
  }
}

const eventDecoders: Record<number, EventDecoder> = {
  // Disconnection Complete
  0x05: (p) => {

    if (p.length < 6) return null;
    const status = p[2];
    const handle = p.readUInt16LE(3) & 0x0fff;
    const reason = p[5];
    return {
      summary: `(handle: ${fmtHandle(handle)}, reason: ${hciErrorCode(reason)})`,
      fields: [
        statusField("Status", status),
        field("Handle", fmtHandle(handle)),
        statusField("Reason", reason),
      ],
    };
  },

  // Encryption Change
  0x08: (p) => {
    if (p.length < 6) return null;
    const status = p[2];
    const handle = p.readUInt16LE(3) & 0x0fff;
    const encEnabled = p.length > 5 ? p[5] : 0;
    const encStr = encEnabled ? "Enabled" : "Disabled";
    return {
      summary: `(handle: ${fmtHandle(handle)}, encryption: ${encStr})`,
      fields: [
        statusField("Status", status),
        field("Handle", fmtHandle(handle)),
        field("Encryption", encStr),
      ],
    };
  },

  // Command Complete
  0x0e: (p) => {
    if (p.length < 5) return null;
    const numPackets = p[2];
    const opcode = p.readUInt16LE(3);
    const name = commandName(opcode);
    const fields: DecodedField[] = [
      field("Num Packets", numPackets.toString()),
      field("Command", name),
    ];
    let statusStr = "";
    if (p.length >= 6) {
      const status = p[5];
      fields.push(statusField("Status", status));
      statusStr = ` (status: ${hciErrorCode(status)})`;
    }

    // Decode return parameters for known commands (start at offset 6)
    if (p.length >= 6 && p[5] === 0x00) {
      switch (opcode) {
        // Read BD ADDR: 6-byte address at offset 6
        case 0x1009: {
          if (p.length >= 12) {
            const addr = formatAddress(p, 6);
            fields.push(field("BD ADDR", addr, COLOR_ADDRESS));
          }
          break;
        }

        // Read Local Version Information
        case 0x1001: {
          if (p.length >= 14) {
            const hciVersion = p[6];
            const hciRevision = p.readUInt16LE(7);
            const lmpVersion = p[9];
            const manufacturer = p.readUInt16LE(10);
            const lmpSubversion = p.readUInt16LE(12);
            fields.push(field("HCI Version", hciVersion.toString()));
            fields.push(field("HCI Revision", `0x${hciRevision.toString(16).toUpperCase().padStart(4, "0")}`));
            fields.push(field("LMP Version", lmpVersion.toString()));
            fields.push(field("Manufacturer", `0x${manufacturer.toString(16).toUpperCase().padStart(4, "0")}`));
            fields.push(field("LMP Subversion", `0x${lmpSubversion.toString(16).toUpperCase().padStart(4, "0")}`));
          }
          break;
        }

        // LE Read Buffer Size: le_data_pkt_len(2) + total_num_le_pkts(1)
        case 0x2002: {
          if (p.length >= 9) {
            const leDataPktLen = p.readUInt16LE(6);
            const totalNumLePkts = p[8];
            fields.push(field("LE Data Packet Length", leDataPktLen.toString()));
            fields.push(field("Total LE Packets", totalNumLePkts.toString()));
          }
          break;
        }
      }
    }

    return {
      summary: `${name}${statusStr}`,
      fields,
    };
  },

  // Command Status
  0x0f: (p) => {
    if (p.length < 6) return null;
    const status = p[2];
    const numPackets = p[3];
    const opcode = p.readUInt16LE(4);
    const name = commandName(opcode);
    return {
      summary: `${name} (status: ${hciErrorCode(status)})`,
      fields: [
        statusField("Status", status),
        field("Num Packets", numPackets.toString()),
        field("Command", name),
      ],
    };
  },

  // LE Meta Event
  0x3e: decodeLeMetaEvent,
};

/**
 * Decode an HCI event packet.
 * Payload starts with eventCode(1) + paramLen(1), parameters at offset 2.
 */
export function decodeEvent(
  eventCode: number,
  payload: Buffer
): DecodedPacket | null {
  const decoder = eventDecoders[eventCode];
  if (!decoder) return null;
  return decoder(payload);
}

// ---------------------------------------------------------------------------
// ACL decoder (flat decode to ATT)
// ---------------------------------------------------------------------------

/**
 * Decode an HCI ACL data packet.
 * Payload: handle(2, lower 12 bits) + dataLen(2) + L2CAP data.
 * If L2CAP CID is 0x0004 (ATT), decodes the ATT layer.
 */
export function decodeAcl(payload: Buffer, tracker?: HciConnectionTracker): DecodedPacket | null {
  if (payload.length < 8) return null;

  const handle = payload.readUInt16LE(0) & 0x0fff;
  const aclDataLen = payload.readUInt16LE(2);
  const handleStr = fmtHandle(handle);

  // Look up peer info from connection tracker
  const conn = tracker?.getConnection(handle);

  // L2CAP header at offset 4
  const l2capLen = payload.readUInt16LE(4);
  const cid = payload.readUInt16LE(6);

  // Non-ATT CID: show basic info
  if (cid !== 0x0004) {
    const nonAttFields = [
      field("Handle", handleStr),
      ...(conn ? [field("Peer", conn.address, COLOR_ADDRESS)] : []),
      field("L2CAP Length", l2capLen.toString()),
      field("CID", `0x${cid.toString(16).toUpperCase().padStart(4, "0")}`),
    ];
    return {
      summary: `handle:${handleStr} L2CAP CID:0x${cid.toString(16).toUpperCase().padStart(4, "0")} (${l2capLen} bytes)`,
      fields: nonAttFields,
    };
  }

  // ATT decoding at offset 8
  if (payload.length < 9) return null;
  const attOpcode = payload[8];
  const attName = attOpcodeName(attOpcode);

  const fields: DecodedField[] = [field("Handle", handleStr)];
  if (conn) {
    fields.push(field("Peer", conn.address, COLOR_ADDRESS));
  }

  switch (attOpcode) {
    // Read Request
    case 0x0a: {
      if (payload.length < 11) break;
      const attHandle = payload.readUInt16LE(9);
      fields.push(field("ATT Handle", fmtHandle(attHandle)));
      return {
        summary: `handle:${handleStr} ATT Read Request (handle: ${fmtHandle(attHandle)})`,
        fields,
      };
    }

    // Read Response
    case 0x0b: {
      const respData = payload.subarray(9);
      const respHex = Array.from(respData).map(b => b.toString(16).padStart(2, "0")).join(" ");
      // Try to show as UTF-8 if it looks like text
      let respDisplay = respHex;
      if (respData.length > 0 && respData.every(b => b >= 0x20 && b <= 0x7e)) {
        respDisplay = `"${Buffer.from(respData).toString("utf-8")}" (${respHex})`;
      }
      fields.push(field("Data", respDisplay || "(empty)"));
      return {
        summary: `handle:${handleStr} ATT Read Response (${respData.length} bytes)`,
        fields,
      };
    }

    // Write Request
    case 0x12: {
      if (payload.length < 11) break;
      const attHandle12 = payload.readUInt16LE(9);
      const value12 = payload.subarray(11);
      const valueHex12 = Array.from(value12).map(b => b.toString(16).padStart(2, "0")).join(" ");
      fields.push(field("ATT Handle", fmtHandle(attHandle12)));
      fields.push(field("Value", valueHex12 || "(empty)"));
      return {
        summary: `handle:${handleStr} ATT Write Request (handle: ${fmtHandle(attHandle12)})`,
        fields,
      };
    }

    // Write Command
    case 0x52: {
      if (payload.length < 11) break;
      const attHandle52 = payload.readUInt16LE(9);
      const value52 = payload.subarray(11);
      const valueHex52 = Array.from(value52).map(b => b.toString(16).padStart(2, "0")).join(" ");
      fields.push(field("ATT Handle", fmtHandle(attHandle52)));
      fields.push(field("Value", valueHex52 || "(empty)"));
      return {
        summary: `handle:${handleStr} ATT Write Command (handle: ${fmtHandle(attHandle52)})`,
        fields,
      };
    }

    // Handle Value Notification
    case 0x1b: {
      if (payload.length < 11) break;
      const attHandle1b = payload.readUInt16LE(9);
      const value1b = payload.subarray(11);
      const valueHex1b = Array.from(value1b).map(b => b.toString(16).padStart(2, "0")).join(" ");
      fields.push(field("ATT Handle", fmtHandle(attHandle1b)));
      fields.push(field("Value", valueHex1b || "(empty)"));
      return {
        summary: `handle:${handleStr} ATT Notification (handle: ${fmtHandle(attHandle1b)})`,
        fields,
      };
    }

    // Exchange MTU Request
    case 0x02: {
      if (payload.length < 11) break;
      const mtu = payload.readUInt16LE(9);
      fields.push(field("MTU", mtu.toString()));
      return {
        summary: `handle:${handleStr} ATT Exchange MTU (mtu: ${mtu})`,
        fields,
      };
    }

    // Exchange MTU Response
    case 0x03: {
      if (payload.length < 11) break;
      const mtu = payload.readUInt16LE(9);
      fields.push(field("MTU", mtu.toString()));
      return {
        summary: `handle:${handleStr} ATT Exchange MTU (mtu: ${mtu})`,
        fields,
      };
    }
  }

  // Default: just show the ATT opcode name
  fields.push(field("ATT Opcode", attName));
  return {
    summary: `handle:${handleStr} ATT ${attName}`,
    fields,
  };
}
