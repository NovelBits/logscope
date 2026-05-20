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
import { lookupHciError, lookupAttError, lookupCompanyId } from "@novelbits/ble-spec";

const COLOR_ERROR = "#f44747";
const COLOR_ADDRESS = "#3794ff";

/** Create a DecodedField, optionally with a color */
function field(name: string, value: string, color?: string): DecodedField {
  return color ? { name, value, color } : { name, value };
}

/**
 * Create a DecodedField with a Bluetooth Core Spec section reference.
 * Used for status / error codes and similar spec-defined values where
 * we want the user to see "this is defined in the Core Spec at §X.Y.Z".
 */
function fieldWithSpec(name: string, value: string, specRef: string, color?: string): DecodedField {
  const f: DecodedField = { name, value, specRef };
  if (color) f.color = color;
  return f;
}

/** Format raw bytes as hex + ASCII (e.g., "01 00 48 65  ..He") */
function formatValueBytes(bytes: Uint8Array | Buffer): string {
  if (bytes.length === 0) return "(empty)";
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join(" ");
  const ascii = Array.from(bytes).map(b => b >= 0x20 && b <= 0x7e ? String.fromCodePoint(b) : ".").join("");
  return `${hex}  ${ascii}`;
}

/** Format a 16-bit handle as 0xNNNN */
function fmtHandle(h: number): string {
  return `0x${h.toString(16).toUpperCase().padStart(4, "0")}`;
}

/**
 * Create a status field with red color for non-zero codes. For error
 * codes (non-zero) we also attach a Bluetooth Core Spec section
 * reference so the user sees where to look up the meaning. The
 * Success (0x00) case stays clean — no spec ref noise on the happy
 * path. Falls back gracefully when the code is unknown: renders the
 * legacy "Unknown (0xNN)" string without a spec ref.
 */
function statusField(name: string, code: number): DecodedField {
  if (code === 0x00) {
    const entry = lookupHciError(code);
    return field(name, entry ? entry.name : hciErrorCode(code));
  }
  const entry = lookupHciError(code);
  if (entry) {
    return fieldWithSpec(name, entry.name, entry.specRef, COLOR_ERROR);
  }
  return field(name, hciErrorCode(code), COLOR_ERROR);
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

// ---------------------------------------------------------------------------
// AD type decoder helpers (one per AD type group)
// ---------------------------------------------------------------------------

function decodeAdFlags16BitUuids(data: Buffer, adDataStart: number, adDataLen: number, adType: number): DecodedField {
  const uuids: string[] = [];
  for (let i = 0; i + 1 < adDataLen; i += 2) {
    if (adDataStart + i + 1 < data.length) {
      const uuid16 = data.readUInt16LE(adDataStart + i);
      uuids.push(`0x${uuid16.toString(16).toUpperCase().padStart(4, "0")}`);
    }
  }
  const label = adType === 0x02 ? "16-bit UUIDs (Incomplete)" : "16-bit UUIDs (Complete)";
  return field(label, uuids.join(", "));
}

function decodeAd128BitUuids(data: Buffer, adDataStart: number, adDataLen: number, adType: number): DecodedField {
  const uuids: string[] = [];
  for (let i = 0; i + 15 < adDataLen; i += 16) {
    if (adDataStart + i + 15 < data.length) {
      uuids.push(format128BitUuid(data, adDataStart + i));
    }
  }
  const label = adType === 0x06 ? "128-bit UUIDs (Incomplete)" : "128-bit UUIDs (Complete)";
  return field(label, uuids.join(", "));
}

function decodeAdLocalName(data: Buffer, adDataStart: number, adDataLen: number, adType: number): DecodedField {
  const end = Math.min(adDataStart + adDataLen, data.length);
  const name = data.subarray(adDataStart, end).toString("utf-8");
  const label = adType === 0x08 ? "Shortened Local Name" : "Complete Local Name";
  return field(label, `"${name}"`);
}

function decodeAdManufacturerSpecific(data: Buffer, adDataStart: number, adDataLen: number): DecodedField | null {
  if (adDataLen < 2 || adDataStart + 1 >= data.length) return null;
  const companyId = data.readUInt16LE(adDataStart);
  const companyHex = `0x${companyId.toString(16).toUpperCase().padStart(4, "0")}`;
  const companyName = lookupCompanyId(companyId);
  const companyDisplay = companyName ? `${companyName} (${companyHex})` : companyHex;
  const msdEnd = Math.min(adDataStart + adDataLen, data.length);
  const msdData = Array.from(data.subarray(adDataStart + 2, msdEnd))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(" ");
  return field("Manufacturer Data", `Company: ${companyDisplay}, Data: ${msdData || "(empty)"}`);
}

function decodeAdUnknown(data: Buffer, adDataStart: number, adDataLen: number, adType: number): DecodedField {
  const rawEnd = Math.min(adDataStart + adDataLen, data.length);
  const rawHex = Array.from(data.subarray(adDataStart, rawEnd))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(" ");
  return field(
    `AD Type 0x${adType.toString(16).toUpperCase().padStart(2, "0")}`,
    rawHex || "(empty)"
  );
}

/** Decode one AD structure entry and push any resulting fields into the output array */
function decodeOneAdStructure(
  data: Buffer,
  adType: number,
  adDataStart: number,
  adDataLen: number,
  fields: DecodedField[]
): void {
  switch (adType) {
    case 0x01:
      if (adDataLen >= 1) fields.push(field("AD Flags", decodeAdFlags(data[adDataStart])));
      break;
    case 0x02:
    case 0x03:
      fields.push(decodeAdFlags16BitUuids(data, adDataStart, adDataLen, adType));
      break;
    case 0x06:
    case 0x07:
      fields.push(decodeAd128BitUuids(data, adDataStart, adDataLen, adType));
      break;
    case 0x08:
    case 0x09:
      fields.push(decodeAdLocalName(data, adDataStart, adDataLen, adType));
      break;
    case 0x0a:
      if (adDataLen >= 1 && adDataStart < data.length)
        fields.push(field("TX Power Level", `${data.readInt8(adDataStart)} dBm`));
      break;
    case 0xff: {
      const msdField = decodeAdManufacturerSpecific(data, adDataStart, adDataLen);
      if (msdField) fields.push(msdField);
      break;
    }
    default:
      fields.push(decodeAdUnknown(data, adDataStart, adDataLen, adType));
      break;
  }
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

    decodeOneAdStructure(data, adType, adDataStart, adDataLen, fields);

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
      name = f.value.replaceAll(/^"|"$/g, "");
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

// ---------------------------------------------------------------------------
// LE Meta subevent helpers
// ---------------------------------------------------------------------------

function decodeLeConnectionComplete(payload: Buffer): DecodedPacket | null {
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

function decodeLeAdvertisingReport(payload: Buffer): DecodedPacket | null {
  if (payload.length < 13) return null;
  const numReports = payload[3];
  const eventType = payload[4];
  const addrType = payload[5];
  const addr = formatAddress(payload, 6);
  const dataLen = payload[12];
  const rssiOffset = 13 + dataLen;
  const rssi = payload.length > rssiOffset ? payload.readInt8(rssiOffset) : undefined;
  const rssiStr = rssi === undefined ? "N/A" : `${rssi} dBm`;

  const adFields: DecodedField[] = [];
  let deviceName: string | undefined;
  const adEnd = 13 + dataLen;
  if (adEnd <= payload.length) {
    for (const ad of parseAdStructures(payload, 13, adEnd)) {
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
      ...(rssi === undefined ? [] : [field("RSSI", rssiStr)]),
    ],
  };
}

function decodeLeDataLengthChange(payload: Buffer): DecodedPacket | null {
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

function decodeLeEnhancedConnectionComplete(payload: Buffer): DecodedPacket | null {
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

function decodeLePhyUpdateComplete(payload: Buffer): DecodedPacket | null {
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

/** Decode LE Meta subevents */
function decodeLeMetaEvent(payload: Buffer): DecodedPacket | null {
  if (payload.length < 3) return null;
  switch (payload[2]) {
    case 0x01: return decodeLeConnectionComplete(payload);
    case 0x02: return decodeLeAdvertisingReport(payload);
    case 0x07: return decodeLeDataLengthChange(payload);
    case 0x0a: return decodeLeEnhancedConnectionComplete(payload);
    case 0x0c: return decodeLePhyUpdateComplete(payload);
    default:   return null;
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
            fields.push(
              field("HCI Version", hciVersion.toString()),
              field("HCI Revision", `0x${hciRevision.toString(16).toUpperCase().padStart(4, "0")}`),
              field("LMP Version", lmpVersion.toString()),
              field("Manufacturer", `0x${manufacturer.toString(16).toUpperCase().padStart(4, "0")}`),
              field("LMP Subversion", `0x${lmpSubversion.toString(16).toUpperCase().padStart(4, "0")}`),
            );
          }
          break;
        }

        // LE Read Buffer Size: le_data_pkt_len(2) + total_num_le_pkts(1)
        case 0x2002: {
          if (p.length >= 9) {
            const leDataPktLen = p.readUInt16LE(6);
            const totalNumLePkts = p[8];
            fields.push(
              field("LE Data Packet Length", leDataPktLen.toString()),
              field("Total LE Packets", totalNumLePkts.toString()),
            );
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

// ---------------------------------------------------------------------------
// ATT opcode decoder helpers
// ---------------------------------------------------------------------------

/**
 * Decoder for a single ATT opcode. Receives the full ACL payload (so it can
 * read fields at known byte offsets), the formatted connection handle string,
 * and the shared fields array which it mutates. Returns a DecodedPacket on
 * success, or null when the payload is too short to decode (in which case the
 * caller falls back to the default ATT opcode-name display).
 */
type AttDecoder = (
  payload: Buffer,
  handleStr: string,
  fields: DecodedField[]
) => DecodedPacket | null;

/**
 * ATT Error Response (opcode 0x01): Request Opcode (1B) + Attribute Handle
 * In Error (2B) + Error Code (1B). Core Spec v6.0 Vol 3 Part F §3.4.1.1.
 */
function decodeAttErrorResponse(
  payload: Buffer,
  handleStr: string,
  fields: DecodedField[]
): DecodedPacket | null {
  if (payload.length < 13) return null;
  const reqOpcode = payload[9];
  const reqOpcodeName = attOpcodeName(reqOpcode);
  const attHandle = payload.readUInt16LE(10);
  const errCode = payload[12];
  const errEntry = lookupAttError(errCode);
  const errText = errEntry
    ? errEntry.name
    : `Unknown (0x${errCode.toString(16).toUpperCase().padStart(2, "0")})`;
  fields.push(
    field("Request In Error", reqOpcodeName),
    field("ATT Handle In Error", fmtHandle(attHandle)),
  );
  if (errEntry) {
    fields.push(fieldWithSpec("Error Code", errEntry.name, errEntry.specRef, COLOR_ERROR));
  } else {
    fields.push(field("Error Code", errText, COLOR_ERROR));
  }
  return {
    summary: `handle:${handleStr} ATT Error Response (${reqOpcodeName} -> ${errText})`,
    fields,
  };
}

/** ATT Exchange MTU Request (0x02) / Response (0x03). */
function decodeAttExchangeMtu(
  payload: Buffer,
  handleStr: string,
  fields: DecodedField[]
): DecodedPacket | null {
  if (payload.length < 11) return null;
  const mtu = payload.readUInt16LE(9);
  fields.push(field("MTU", mtu.toString()));
  return { summary: `handle:${handleStr} ATT Exchange MTU (mtu: ${mtu})`, fields };
}

/** ATT Read Request (0x0a). */
function decodeAttReadRequest(
  payload: Buffer,
  handleStr: string,
  fields: DecodedField[]
): DecodedPacket | null {
  if (payload.length < 11) return null;
  const attHandle = payload.readUInt16LE(9);
  fields.push(field("ATT Handle", fmtHandle(attHandle)));
  return { summary: `handle:${handleStr} ATT Read Request (handle: ${fmtHandle(attHandle)})`, fields };
}

/** ATT Read Response (0x0b) — variable-length value, no minimum beyond the opcode byte. */
function decodeAttReadResponse(
  payload: Buffer,
  handleStr: string,
  fields: DecodedField[]
): DecodedPacket | null {
  const respData = payload.subarray(9);
  fields.push(field("Data", formatValueBytes(respData)));
  return { summary: `handle:${handleStr} ATT Read Response (${respData.length} bytes)`, fields };
}

/**
 * ATT Write Request (0x12) / Write Command (0x52) / Notification (0x1b).
 * Shared decoder — the ATT opcode is read from payload[8] for label selection
 * only; the parsing layout is identical across the three.
 */
function decodeAttWriteOrNotify(
  payload: Buffer,
  handleStr: string,
  fields: DecodedField[]
): DecodedPacket | null {
  if (payload.length < 11) return null;
  const attOpcode = payload[8];
  const attHandle = payload.readUInt16LE(9);
  const value = payload.subarray(11);
  fields.push(field("ATT Handle", fmtHandle(attHandle)), field("Value", formatValueBytes(value)));
  const label =
    attOpcode === 0x12 ? "ATT Write Request" :
    attOpcode === 0x52 ? "ATT Write Command" :
    "ATT Notification";
  return { summary: `handle:${handleStr} ${label} (handle: ${fmtHandle(attHandle)})`, fields };
}

const attDecoders: Record<number, AttDecoder> = {
  0x01: decodeAttErrorResponse,
  0x02: decodeAttExchangeMtu,
  0x03: decodeAttExchangeMtu,
  0x0a: decodeAttReadRequest,
  0x0b: decodeAttReadResponse,
  0x12: decodeAttWriteOrNotify,
  0x52: decodeAttWriteOrNotify,
  0x1b: decodeAttWriteOrNotify,
};

/** Decode an ATT read/write/notify/mtu opcode, mutating fields and returning a packet. */
function decodeAttOpcode(
  attOpcode: number,
  attName: string,
  payload: Buffer,
  handleStr: string,
  fields: DecodedField[]
): DecodedPacket {
  const decoder = attDecoders[attOpcode];
  if (decoder) {
    const result = decoder(payload, handleStr, fields);
    if (result) return result;
  }
  // Default: just show the ATT opcode name (also the fallback when the
  // payload is too short for the matched decoder to produce a result).
  fields.push(field("ATT Opcode", attName));
  return { summary: `handle:${handleStr} ATT ${attName}`, fields };
}

/**
 * Decode an HCI ACL data packet.
 * Payload: handle(2, lower 12 bits) + dataLen(2) + L2CAP data.
 * If L2CAP CID is 0x0004 (ATT), decodes the ATT layer.
 */
export function decodeAcl(payload: Buffer, tracker?: HciConnectionTracker): DecodedPacket | null {
  if (payload.length < 8) return null;

  const handle = payload.readUInt16LE(0) & 0x0fff;
  const handleStr = fmtHandle(handle);

  // Look up peer info from connection tracker
  const conn = tracker?.getConnection(handle);

  // L2CAP header at offset 4
  const l2capLen = payload.readUInt16LE(4);
  const cid = payload.readUInt16LE(6);

  // Non-ATT CID: show basic info
  if (cid !== 0x0004) {
    return {
      summary: `handle:${handleStr} L2CAP CID:0x${cid.toString(16).toUpperCase().padStart(4, "0")} (${l2capLen} bytes)`,
      fields: [
        field("Handle", handleStr),
        ...(conn ? [field("Peer", conn.address, COLOR_ADDRESS)] : []),
        field("L2CAP Length", l2capLen.toString()),
        field("CID", `0x${cid.toString(16).toUpperCase().padStart(4, "0")}`),
      ],
    };
  }

  // ATT decoding at offset 8
  if (payload.length < 9) return null;
  const attOpcode = payload[8];
  const attName = attOpcodeName(attOpcode);

  const fields: DecodedField[] = [field("Handle", handleStr)];
  if (conn) fields.push(field("Peer", conn.address, COLOR_ADDRESS));

  return decodeAttOpcode(attOpcode, attName, payload, handleStr, fields);
}
