/**
 * Parser for Zephyr BT Monitor protocol (RTT Channel 1).
 *
 * Wire format per packet:
 *   [data_len:2 LE][opcode:2 LE][flags:1][hdr_len:1][ext_hdr:N][payload:M]
 *   where M = data_len - 4 - hdr_len
 *
 * Opcodes: 2=Command, 3=Event, 4=ACL TX, 5=ACL RX, 12=System Note, 13=User Log
 */

import type { LogEntry } from "./types";
import { commandName, eventName } from "./hci-opcodes";
import { decodeCommand, decodeEvent, decodeAcl } from "./hci-decoders";
import { HciConnectionTracker } from "./hci-connection-tracker";

// BT Monitor opcodes
const OP_NEW_INDEX = 0;
const OP_COMMAND = 2;
const OP_EVENT = 3;
const OP_ACL_TX = 4;
const OP_ACL_RX = 5;
const OP_SCO_TX = 6;
const OP_SCO_RX = 7;
const OP_SYSTEM_NOTE = 12;
const OP_USER_LOGGING = 13;
const OP_ISO_TX = 18;
const OP_ISO_RX = 19;

// Extended header types
const EXT_TS32 = 8;

export class HciParser {
  private buffer = Buffer.alloc(0);
  private tracker = new HciConnectionTracker();

  /**
   * Feed raw binary data from RTT Channel 1.
   * Returns parsed HCI log entries (may be empty if incomplete packet buffered).
   */
  parse(data: Buffer): LogEntry[] {
    this.buffer = Buffer.concat([this.buffer, data]);
    const entries: LogEntry[] = [];

    while (this.buffer.length >= 6) {
      // Need at least 2 bytes for data_len
      const dataLen = this.buffer.readUInt16LE(0);

      // Total packet size = 2 (data_len field) + dataLen
      const totalLen = 2 + dataLen;
      if (this.buffer.length < totalLen) break; // wait for more data

      // Extract packet
      const packet = this.buffer.subarray(0, totalLen);
      this.buffer = this.buffer.subarray(totalLen);

      const entry = this.parsePacket(packet);
      if (entry) entries.push(entry);
    }

    // Prevent unbounded buffer growth on corrupt data
    if (this.buffer.length > 65536) {
      this.buffer = Buffer.alloc(0);
    }

    return entries;
  }

  private parsePacket(packet: Buffer): LogEntry | null {
    if (packet.length < 6) return null;

    const dataLen = packet.readUInt16LE(0);
    const opcode = packet.readUInt16LE(2);
    const flags = packet[4];
    const hdrLen = packet[5];

    // Extract timestamp from extended header
    let timestamp = 0;
    if (hdrLen >= 5 && packet.length > 6) {
      const extType = packet[6];
      if (extType === EXT_TS32 && hdrLen >= 5) {
        // TS32: 4 bytes LE, units of 1/10 ms (100 us)
        const ts32 = packet.readUInt32LE(7);
        timestamp = ts32 * 100; // convert to microseconds
      }
    }

    // Payload starts after base header + extended header
    const payloadOffset = 6 + hdrLen;
    const payloadLen = dataLen - 4 - hdrLen;
    if (payloadLen < 0 || payloadOffset + payloadLen > packet.length) return null;

    const payload = packet.subarray(payloadOffset, payloadOffset + payloadLen);

    return this.makeEntry(opcode, timestamp, payload);
  }

  private makeEntry(opcode: number, timestamp: number, payload: Buffer): LogEntry | null {
    let direction: string;
    let pktType: string;
    let message: string;
    let severity: "inf" | "dbg" | "wrn" | "err" = "dbg";
    let decoded: import("./types").DecodedPacket | null = null;

    switch (opcode) {
      case OP_COMMAND: {
        direction = "TX";
        pktType = "CMD";
        if (payload.length >= 3) {
          const cmdOpcode = payload.readUInt16LE(0);
          const paramLen = payload[2];
          decoded = decodeCommand(cmdOpcode, payload);
          if (decoded?.summary) {
            message = `${direction} ${pktType} ${commandName(cmdOpcode)} ${decoded.summary}`;
          } else {
            message = `${direction} ${pktType} ${commandName(cmdOpcode)} (${paramLen}B)`;
          }
        } else {
          message = `${direction} ${pktType} (${payload.length}B)`;
        }
        severity = "inf";
        break;
      }

      case OP_EVENT: {
        direction = "RX";
        pktType = "EVT";
        if (payload.length >= 2) {
          const evtCode = payload[0];
          const evtParamLen = payload[1];
          const evtPayload = payload.subarray(2);
          decoded = decodeEvent(evtCode, payload);
          if (decoded?.summary) {
            message = `${direction} ${pktType} ${eventName(evtCode, evtPayload)} ${decoded.summary}`;
          } else {
            message = `${direction} ${pktType} ${eventName(evtCode, evtPayload)} (${evtParamLen}B)`;
          }

          // Track connections: LE Connection Complete or LE Enhanced Connection Complete
          if (decoded && evtCode === 0x3e && payload.length >= 3) {
            const subevent = payload[2];
            if (subevent === 0x01 || subevent === 0x0a) {
              // Extract handle, address, and role from decoded fields
              const handleField = decoded.fields.find((f) => f.name === "Handle");
              const addrField = decoded.fields.find((f) => f.name === "Peer Address");
              const roleField = decoded.fields.find((f) => f.name === "Role");
              const statusField = decoded.fields.find((f) => f.name === "Status");
              if (handleField && addrField && roleField && statusField?.value === "Success") {
                const h = parseInt(handleField.value, 16);
                this.tracker.onConnectionComplete(h, addrField.value, roleField.value);
              }
            }
          }

          // Track disconnections
          if (decoded && evtCode === 0x05) {
            const handleField = decoded.fields.find((f) => f.name === "Handle");
            if (handleField) {
              const h = parseInt(handleField.value, 16);
              this.tracker.onDisconnection(h);
            }
          }

          // Highlight errors in events
          if (evtCode === 0x0F) { // Command Status
            const status = evtPayload.length > 0 ? evtPayload[0] : 0;
            if (status !== 0) severity = "err";
            else severity = "inf";
          } else {
            severity = "inf";
          }
        } else {
          message = `${direction} ${pktType} (${payload.length}B)`;
          severity = "inf";
        }
        break;
      }

      case OP_ACL_TX: {
        direction = "TX";
        pktType = "ACL";
        decoded = decodeAcl(payload, this.tracker);
        if (decoded?.summary) {
          message = `${direction} ${pktType} ${decoded.summary}`;
        } else {
          const aclLen = payload.length >= 4 ? payload.readUInt16LE(2) : payload.length;
          message = `${direction} ${pktType} (${aclLen}B)`;
        }
        break;
      }

      case OP_ACL_RX: {
        direction = "RX";
        pktType = "ACL";
        decoded = decodeAcl(payload, this.tracker);
        if (decoded?.summary) {
          message = `${direction} ${pktType} ${decoded.summary}`;
        } else {
          const aclLen = payload.length >= 4 ? payload.readUInt16LE(2) : payload.length;
          message = `${direction} ${pktType} (${aclLen}B)`;
        }
        break;
      }

      case OP_SCO_TX:
      case OP_ISO_TX: {
        direction = "TX";
        pktType = opcode === OP_SCO_TX ? "SCO" : "ISO";
        message = `${direction} ${pktType} (${payload.length}B)`;
        break;
      }

      case OP_SCO_RX:
      case OP_ISO_RX: {
        direction = "RX";
        pktType = opcode === OP_SCO_RX ? "SCO" : "ISO";
        message = `${direction} ${pktType} (${payload.length}B)`;
        break;
      }

      case OP_SYSTEM_NOTE: {
        const note = payload.toString("utf-8").replace(/\0+$/, "");
        message = `SYS ${note}`;
        severity = "wrn";
        break;
      }

      case OP_USER_LOGGING: {
        // Zephyr log messages mirrored to BT Monitor channel.
        // These duplicate Channel 0 entries but we show them as a filterable
        // "MON" category so users can toggle them. Hidden by default via UI.
        if (payload.length < 2) return null;
        const priority = payload[0];
        const identLen = payload[1];
        const ident = payload.subarray(2, 2 + identLen).toString("utf-8").replace(/\0+$/, "");
        const msg = payload.subarray(2 + identLen).toString("utf-8").replace(/\0+$/, "");
        message = `[${ident}] ${msg}`;
        pktType = "MON";
        severity = priority <= 3 ? "err" : priority <= 4 ? "wrn" : priority <= 6 ? "inf" : "dbg";
        break;
      }

      case OP_NEW_INDEX: {
        if (payload.length >= 16) {
          const name = payload.subarray(8, 16).toString("utf-8").replace(/\0+$/, "");
          message = `HCI Index: ${name}`;
        } else {
          message = "HCI Index registered";
        }
        severity = "inf";
        break;
      }

      default: {
        // Show unknown opcodes rather than silently dropping
        direction = "";
        pktType = "SYS";
        message = `BT Monitor opcode 0x${opcode.toString(16).padStart(2, "0")} (${payload.length}B)`;
        severity = "dbg";
        break;
      }
    }

    const meta: Record<string, unknown> = {
      opcode,
      direction: opcode >= 2 && opcode <= 7 ? (opcode % 2 === 0 ? "tx" : "rx") : "",
    };
    if (decoded) meta.decoded = decoded;

    return {
      timestamp,
      source: "hci",
      severity,
      module: pktType || "hci",
      message,
      raw: new Uint8Array(payload),
      metadata: meta,
    };
  }
}
