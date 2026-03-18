import {
  decodeCommand,
  decodeEvent,
  decodeAcl,
  decodeAdStructures,
} from "../../src/parser/hci-decoders";
import { HciConnectionTracker } from "../../src/parser/hci-connection-tracker";

// ---------------------------------------------------------------------------
// Command decoders
// ---------------------------------------------------------------------------

describe("decodeCommand", () => {
  it("decodes Disconnect command", () => {
    // opcode 0x0406, paramLen=3, handle=0x0040, reason=0x13 (Remote User Terminated)
    const payload = Buffer.from([
      0x06, 0x04, // opcode LE
      0x03, // param length
      0x40, 0x00, // handle
      0x13, // reason
    ]);
    const result = decodeCommand(0x0406, payload);
    expect(result).not.toBeNull();
    expect(result!.summary).toContain("0x0040");
    expect(result!.summary).toContain("Remote User Terminated");
    expect(result!.fields.find((f) => f.name === "Handle")?.value).toBe(
      "0x0040"
    );
    // Non-zero reason should have error color
    const reasonField = result!.fields.find((f) => f.name === "Reason");
    expect(reasonField?.color).toBe("#f44747");
  });

  it("decodes LE Set PHY command", () => {
    // opcode 0x2032, paramLen=7, handle=0x0001, allPhys=0x00, txPhy=2 (2M), rxPhy=2 (2M)
    const payload = Buffer.from([
      0x32, 0x20, // opcode LE
      0x07, // param length
      0x01, 0x00, // handle
      0x00, // all phys
      0x02, // tx phy: 2M
      0x02, // rx phy: 2M
    ]);
    const result = decodeCommand(0x2032, payload);
    expect(result).not.toBeNull();
    expect(result!.summary).toBe("(tx: 2M, rx: 2M)");
    expect(result!.fields.find((f) => f.name === "TX PHY")?.value).toBe("2M");
    expect(result!.fields.find((f) => f.name === "RX PHY")?.value).toBe("2M");
  });

  it("decodes LE Set Random Address command", () => {
    const payload = Buffer.from([
      0x05, 0x20, // opcode LE
      0x06, // param length
      0x11, 0x22, 0x33, 0x44, 0x55, 0x66, // address (LE byte order)
    ]);
    const result = decodeCommand(0x2005, payload);
    expect(result).not.toBeNull();
    expect(result!.summary).toContain("66:55:44:33:22:11");
    expect(result!.fields[0].color).toBe("#3794ff");
  });

  it("returns null for unrecognized command opcode", () => {
    const payload = Buffer.from([0x00, 0x00, 0x00]);
    expect(decodeCommand(0x9999, payload)).toBeNull();
  });

  it("returns null for truncated Disconnect payload", () => {
    const payload = Buffer.from([0x06, 0x04, 0x03, 0x40]);
    expect(decodeCommand(0x0406, payload)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Event decoders
// ---------------------------------------------------------------------------

describe("decodeEvent", () => {
  it("decodes Disconnection Complete event", () => {
    const payload = Buffer.from([
      0x05, // event code
      0x04, // param length
      0x00, // status: Success
      0x40, 0x00, // handle: 0x0040
      0x16, // reason: Connection Terminated by Local Host
    ]);
    const result = decodeEvent(0x05, payload);
    expect(result).not.toBeNull();
    expect(result!.summary).toContain("0x0040");
    expect(result!.summary).toContain("Connection Terminated by Local Host");
    // Success status should have no color
    const statusField = result!.fields.find((f) => f.name === "Status");
    expect(statusField?.color).toBeUndefined();
    // Non-zero reason should have error color
    const reasonField = result!.fields.find((f) => f.name === "Reason");
    expect(reasonField?.color).toBe("#f44747");
  });

  it("decodes Command Complete event", () => {
    const payload = Buffer.from([
      0x0e, // event code
      0x04, // param length
      0x01, // num packets
      0x03, 0x0c, // opcode: Reset (0x0C03)
      0x00, // status: Success
    ]);
    const result = decodeEvent(0x0e, payload);
    expect(result).not.toBeNull();
    expect(result!.summary).toContain("Reset");
    expect(result!.summary).toContain("Success");
  });

  it("decodes Command Status event with error", () => {
    const payload = Buffer.from([
      0x0f, // event code
      0x04, // param length
      0x0c, // status: Command Disallowed
      0x01, // num packets
      0x0d, 0x20, // opcode: LE Create Connection (0x200D)
    ]);
    const result = decodeEvent(0x0f, payload);
    expect(result).not.toBeNull();
    expect(result!.summary).toContain("LE Create Connection");
    expect(result!.summary).toContain("Command Disallowed");
    const statusField = result!.fields.find((f) => f.name === "Status");
    expect(statusField?.color).toBe("#f44747");
  });

  it("decodes LE Connection Complete event", () => {
    const payload = Buffer.from([
      0x3e, // event code: LE Meta
      0x13, // param length
      0x01, // subevent: Connection Complete
      0x00, // status: Success
      0x40, 0x00, // handle: 0x0040
      0x01, // role: Peripheral
      0x01, // peer addr type: Random
      0x27, 0xd3, 0xc7, 0x90, 0xa4, 0x74, // peer address (LE byte order)
      0x18, 0x00, // interval: 24
      0x00, 0x00, // latency: 0
      0x48, 0x00, // timeout: 72
      0x00, // clock accuracy
    ]);
    const result = decodeEvent(0x3e, payload);
    expect(result).not.toBeNull();
    expect(result!.summary).toContain("0x0040");
    expect(result!.fields.find((f) => f.name === "Role")?.value).toBe(
      "Peripheral"
    );
    expect(
      result!.fields.find((f) => f.name === "Peer Address")?.value
    ).toBe("74:A4:90:C7:D3:27");
    expect(
      result!.fields.find((f) => f.name === "Peer Address")?.color
    ).toBe("#3794ff");
  });

  it("decodes LE PHY Update Complete event", () => {
    const payload = Buffer.from([
      0x3e, // event code: LE Meta
      0x06, // param length
      0x0c, // subevent: PHY Update Complete
      0x00, // status: Success
      0x40, 0x00, // handle: 0x0040
      0x02, // tx phy: 2M
      0x01, // rx phy: 1M
    ]);
    const result = decodeEvent(0x3e, payload);
    expect(result).not.toBeNull();
    expect(result!.summary).toBe("(tx: 2M, rx: 1M)");
    expect(result!.fields.find((f) => f.name === "TX PHY")?.value).toBe("2M");
    expect(result!.fields.find((f) => f.name === "RX PHY")?.value).toBe("1M");
  });

  it("decodes LE Data Length Change event", () => {
    const payload = Buffer.from([
      0x3e, // event code: LE Meta
      0x0b, // param length
      0x07, // subevent: Data Length Change
      0x40, 0x00, // handle: 0x0040
      0xfb, 0x00, // max tx octets: 251
      0x48, 0x08, // max tx time: 2120
      0xfb, 0x00, // max rx octets: 251
      0x48, 0x08, // max rx time: 2120
    ]);
    const result = decodeEvent(0x3e, payload);
    expect(result).not.toBeNull();
    expect(result!.summary).toContain("251 bytes/2120us");
  });

  it("decodes LE Advertising Report event", () => {
    const payload = Buffer.from([
      0x3e, // event code: LE Meta
      0x0f, // param length
      0x02, // subevent: Advertising Report
      0x01, // num reports
      0x00, // event type
      0x01, // addr type: Random
      0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, // address (LE byte order)
      0x02, // data length
      0x01, 0x06, // ad data
      0xc8, // RSSI: -56 dBm (signed)
    ]);
    const result = decodeEvent(0x3e, payload);
    expect(result).not.toBeNull();
    expect(result!.summary).toContain("FF:EE:DD:CC:BB:AA");
    expect(result!.summary).toContain("-56 dBm");
  });

  it("returns null for unrecognized event code", () => {
    const payload = Buffer.from([0xaa, 0x00]);
    expect(decodeEvent(0xaa, payload)).toBeNull();
  });

  it("returns null for unrecognized LE Meta subevent", () => {
    const payload = Buffer.from([0x3e, 0x01, 0xff]);
    expect(decodeEvent(0x3e, payload)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ACL decoder
// ---------------------------------------------------------------------------

describe("decodeAcl", () => {
  it("decodes ATT Write Request", () => {
    const payload = Buffer.from([
      0x40, 0x00, // handle: 0x0040
      0x09, 0x00, // ACL data length: 9
      0x05, 0x00, // L2CAP length: 5
      0x04, 0x00, // CID: 0x0004 (ATT)
      0x12, // ATT opcode: Write Request
      0x15, 0x00, // ATT handle: 0x0015
      0x01, 0x00, // value: [0x01, 0x00]
    ]);
    const result = decodeAcl(payload);
    expect(result).not.toBeNull();
    expect(result!.summary).toContain("handle:0x0040");
    expect(result!.summary).toContain("ATT Write Request");
    expect(result!.summary).toContain("0x0015");
    expect(result!.fields.find((f) => f.name === "ATT Handle")?.value).toBe(
      "0x0015"
    );
    expect(
      result!.fields.find((f) => f.name === "Value")?.value
    ).toBe("01 00");
  });

  it("decodes ATT Exchange MTU Request", () => {
    const payload = Buffer.from([
      0x40, 0x00, // handle: 0x0040
      0x05, 0x00, // ACL data length: 5
      0x03, 0x00, // L2CAP length: 3
      0x04, 0x00, // CID: 0x0004 (ATT)
      0x02, // ATT opcode: Exchange MTU Request
      0xf7, 0x00, // MTU: 247
    ]);
    const result = decodeAcl(payload);
    expect(result).not.toBeNull();
    expect(result!.summary).toContain("ATT Exchange MTU");
    expect(result!.summary).toContain("247");
  });

  it("decodes ATT Handle Value Notification", () => {
    const payload = Buffer.from([
      0x40, 0x00, // handle: 0x0040
      0x07, 0x00, // ACL data length
      0x05, 0x00, // L2CAP length
      0x04, 0x00, // CID: ATT
      0x1b, // ATT opcode: Handle Value Notification
      0x16, 0x00, // ATT handle: 0x0016
      0xab, 0xcd, // notification data
    ]);
    const result = decodeAcl(payload);
    expect(result).not.toBeNull();
    expect(result!.summary).toContain("ATT Notification");
    expect(result!.summary).toContain("0x0016");
  });

  it("decodes non-ATT L2CAP CID", () => {
    const payload = Buffer.from([
      0x40, 0x00, // handle: 0x0040
      0x06, 0x00, // ACL data length
      0x02, 0x00, // L2CAP length: 2
      0x05, 0x00, // CID: 0x0005 (LE Signaling)
      0x12, 0x34, // data
    ]);
    const result = decodeAcl(payload);
    expect(result).not.toBeNull();
    expect(result!.summary).toContain("L2CAP CID:0x0005");
    expect(result!.summary).toContain("2 bytes");
  });

  it("decodes unknown ATT opcode gracefully", () => {
    const payload = Buffer.from([
      0x40, 0x00, // handle
      0x05, 0x00, // ACL data length
      0x01, 0x00, // L2CAP length
      0x04, 0x00, // CID: ATT
      0xff, // unknown ATT opcode
    ]);
    const result = decodeAcl(payload);
    expect(result).not.toBeNull();
    expect(result!.summary).toContain("handle:0x0040");
    expect(result!.summary).toContain("ATT");
  });

  it("returns null for truncated ACL packet", () => {
    const payload = Buffer.from([0x40, 0x00, 0x05]);
    expect(decodeAcl(payload)).toBeNull();
  });

  it("includes Peer field when tracker has connection info", () => {
    const tracker = new HciConnectionTracker();
    tracker.onConnectionComplete(0x0040, "74:A4:90:C7:D3:27", "Peripheral");

    const payload = Buffer.from([
      0x40, 0x00, // handle: 0x0040
      0x05, 0x00, // ACL data length
      0x03, 0x00, // L2CAP length
      0x04, 0x00, // CID: ATT
      0x02, // ATT opcode: Exchange MTU Request
      0xf7, 0x00, // MTU: 247
    ]);
    const result = decodeAcl(payload, tracker);
    expect(result).not.toBeNull();
    const peerField = result!.fields.find((f) => f.name === "Peer");
    expect(peerField).toBeDefined();
    expect(peerField!.value).toBe("74:A4:90:C7:D3:27");
    expect(peerField!.color).toBe("#3794ff");
  });

  it("omits Peer field when tracker has no connection info", () => {
    const tracker = new HciConnectionTracker();

    const payload = Buffer.from([
      0x40, 0x00, // handle: 0x0040
      0x05, 0x00, // ACL data length
      0x03, 0x00, // L2CAP length
      0x04, 0x00, // CID: ATT
      0x02, // ATT opcode: Exchange MTU Request
      0xf7, 0x00, // MTU: 247
    ]);
    const result = decodeAcl(payload, tracker);
    expect(result).not.toBeNull();
    expect(result!.fields.find((f) => f.name === "Peer")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// AD Structure decoding
// ---------------------------------------------------------------------------

describe("decodeAdStructures", () => {
  it("decodes Flags + Complete Local Name + TX Power Level", () => {
    // AD: Flags (0x01) = 0x06 (LE General Discoverable, BR/EDR Not Supported)
    // AD: Complete Local Name (0x09) = "Test"
    // AD: TX Power Level (0x0A) = -4 dBm
    const ad = Buffer.from([
      0x02, 0x01, 0x06, // Flags: len=2, type=0x01, data=0x06
      0x05, 0x09, 0x54, 0x65, 0x73, 0x74, // Complete Name: len=5, type=0x09, "Test"
      0x02, 0x0a, 0xfc, // TX Power: len=2, type=0x0A, -4 (signed)
    ]);
    const fields = decodeAdStructures(ad, 0, ad.length);
    expect(fields.length).toBe(3);

    // Flags
    expect(fields[0].name).toBe("AD Flags");
    expect(fields[0].value).toContain("LE General Discoverable");
    expect(fields[0].value).toContain("BR/EDR Not Supported");

    // Complete Local Name
    expect(fields[1].name).toBe("Complete Local Name");
    expect(fields[1].value).toBe('"Test"');

    // TX Power Level
    expect(fields[2].name).toBe("TX Power Level");
    expect(fields[2].value).toBe("-4 dBm");
  });

  it("decodes 16-bit UUID list", () => {
    const ad = Buffer.from([
      0x05, 0x03, // Complete 16-bit UUID list, len=5
      0x0d, 0x18, // 0x180D (Heart Rate)
      0x0f, 0x18, // 0x180F (Battery)
    ]);
    const fields = decodeAdStructures(ad, 0, ad.length);
    expect(fields.length).toBe(1);
    expect(fields[0].name).toBe("16-bit UUIDs (Complete)");
    expect(fields[0].value).toContain("0x180D");
    expect(fields[0].value).toContain("0x180F");
  });

  it("decodes 128-bit UUID", () => {
    // A 128-bit UUID in LE byte order
    const ad = Buffer.from([
      0x11, 0x07, // Complete 128-bit UUID list, len=17
      0xfb, 0x34, 0x9b, 0x5f, 0x80, 0x00, 0x00, 0x80,
      0x00, 0x10, 0x00, 0x00, 0x0d, 0x18, 0x00, 0x00,
    ]);
    const fields = decodeAdStructures(ad, 0, ad.length);
    expect(fields.length).toBe(1);
    expect(fields[0].name).toBe("128-bit UUIDs (Complete)");
    // Should be formatted as standard UUID string
    expect(fields[0].value).toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/
    );
  });

  it("decodes Manufacturer Specific Data", () => {
    const ad = Buffer.from([
      0x05, 0xff, // Manufacturer Specific, len=5
      0x4c, 0x00, // Company ID: 0x004C (Apple)
      0x01, 0x02, // data
    ]);
    const fields = decodeAdStructures(ad, 0, ad.length);
    expect(fields.length).toBe(1);
    expect(fields[0].name).toBe("Manufacturer Data");
    expect(fields[0].value).toContain("0x004C");
    expect(fields[0].value).toContain("01 02");
  });

  it("handles empty data gracefully", () => {
    const ad = Buffer.alloc(0);
    const fields = decodeAdStructures(ad, 0, 0);
    expect(fields).toEqual([]);
  });

  it("handles truncated AD structure gracefully", () => {
    // Length says 5 but buffer ends after 3 bytes
    const ad = Buffer.from([0x05, 0x09, 0x41]);
    const fields = decodeAdStructures(ad, 0, ad.length);
    // Should stop parsing without crashing
    expect(fields).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Encryption Change event
// ---------------------------------------------------------------------------

describe("Encryption Change event", () => {
  it("decodes encryption enabled", () => {
    const payload = Buffer.from([
      0x08, // event code
      0x04, // param length
      0x00, // status: Success
      0x40, 0x00, // handle: 0x0040
      0x01, // encryption enabled
    ]);
    const result = decodeEvent(0x08, payload);
    expect(result).not.toBeNull();
    expect(result!.summary).toContain("0x0040");
    expect(result!.summary).toContain("Enabled");
    expect(result!.fields.find((f) => f.name === "Encryption")?.value).toBe(
      "Enabled"
    );
    // Success status should have no error color
    const statusField = result!.fields.find((f) => f.name === "Status");
    expect(statusField?.color).toBeUndefined();
  });

  it("decodes encryption disabled with error status", () => {
    const payload = Buffer.from([
      0x08, // event code
      0x04, // param length
      0x05, // status: Authentication Failure
      0x40, 0x00, // handle: 0x0040
      0x00, // encryption disabled
    ]);
    const result = decodeEvent(0x08, payload);
    expect(result).not.toBeNull();
    expect(result!.summary).toContain("Disabled");
    const statusField = result!.fields.find((f) => f.name === "Status");
    expect(statusField?.color).toBe("#f44747");
  });

  it("returns null for truncated Encryption Change", () => {
    const payload = Buffer.from([0x08, 0x04, 0x00, 0x40]);
    expect(decodeEvent(0x08, payload)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Command Complete return parameters
// ---------------------------------------------------------------------------

describe("Command Complete return parameters", () => {
  it("decodes Read BD ADDR return params", () => {
    const payload = Buffer.from([
      0x0e, // event code
      0x0a, // param length
      0x01, // num packets
      0x09, 0x10, // opcode: Read BD ADDR (0x1009)
      0x00, // status: Success
      0x11, 0x22, 0x33, 0x44, 0x55, 0x66, // BD ADDR (LE byte order)
    ]);
    const result = decodeEvent(0x0e, payload);
    expect(result).not.toBeNull();
    const addrField = result!.fields.find((f) => f.name === "BD ADDR");
    expect(addrField).toBeDefined();
    expect(addrField!.value).toBe("66:55:44:33:22:11");
    expect(addrField!.color).toBe("#3794ff");
  });

  it("decodes Read Local Version Info return params", () => {
    const payload = Buffer.from([
      0x0e, // event code
      0x0c, // param length
      0x01, // num packets
      0x01, 0x10, // opcode: Read Local Version Info (0x1001)
      0x00, // status: Success
      0x0c, // HCI version: 12
      0x34, 0x12, // HCI revision: 0x1234
      0x0c, // LMP version: 12
      0x0d, 0x00, // manufacturer: 0x000D
      0xab, 0xcd, // LMP subversion: 0xCDAB
    ]);
    const result = decodeEvent(0x0e, payload);
    expect(result).not.toBeNull();
    expect(result!.fields.find((f) => f.name === "HCI Version")?.value).toBe(
      "12"
    );
    expect(
      result!.fields.find((f) => f.name === "HCI Revision")?.value
    ).toBe("0x1234");
    expect(
      result!.fields.find((f) => f.name === "Manufacturer")?.value
    ).toBe("0x000D");
    expect(
      result!.fields.find((f) => f.name === "LMP Subversion")?.value
    ).toBe("0xCDAB");
  });

  it("decodes LE Read Buffer Size return params", () => {
    const payload = Buffer.from([
      0x0e, // event code
      0x07, // param length
      0x01, // num packets
      0x02, 0x20, // opcode: LE Read Buffer Size (0x2002)
      0x00, // status: Success
      0xfb, 0x00, // LE data packet length: 251
      0x0a, // total LE packets: 10
    ]);
    const result = decodeEvent(0x0e, payload);
    expect(result).not.toBeNull();
    expect(
      result!.fields.find((f) => f.name === "LE Data Packet Length")?.value
    ).toBe("251");
    expect(
      result!.fields.find((f) => f.name === "Total LE Packets")?.value
    ).toBe("10");
  });

  it("does not decode return params on non-success status", () => {
    const payload = Buffer.from([
      0x0e, // event code
      0x0a, // param length
      0x01, // num packets
      0x09, 0x10, // opcode: Read BD ADDR (0x1009)
      0x01, // status: Unknown HCI Command (non-zero)
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // garbage address
    ]);
    const result = decodeEvent(0x0e, payload);
    expect(result).not.toBeNull();
    // Should NOT have a BD ADDR field since status is non-zero
    expect(result!.fields.find((f) => f.name === "BD ADDR")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// HciConnectionTracker
// ---------------------------------------------------------------------------

describe("HciConnectionTracker", () => {
  it("tracks connections and provides lookup", () => {
    const tracker = new HciConnectionTracker();
    tracker.onConnectionComplete(0x0040, "74:A4:90:C7:D3:27", "Peripheral");

    const conn = tracker.getConnection(0x0040);
    expect(conn).toBeDefined();
    expect(conn!.address).toBe("74:A4:90:C7:D3:27");
    expect(conn!.role).toBe("Peripheral");
  });

  it("returns undefined for unknown handle", () => {
    const tracker = new HciConnectionTracker();
    expect(tracker.getConnection(0x0040)).toBeUndefined();
  });

  it("removes connection on disconnection", () => {
    const tracker = new HciConnectionTracker();
    tracker.onConnectionComplete(0x0040, "74:A4:90:C7:D3:27", "Peripheral");
    tracker.onDisconnection(0x0040);
    expect(tracker.getConnection(0x0040)).toBeUndefined();
  });

  it("tracks multiple connections independently", () => {
    const tracker = new HciConnectionTracker();
    tracker.onConnectionComplete(0x0040, "AA:BB:CC:DD:EE:FF", "Central");
    tracker.onConnectionComplete(0x0041, "11:22:33:44:55:66", "Peripheral");

    expect(tracker.getConnection(0x0040)!.address).toBe("AA:BB:CC:DD:EE:FF");
    expect(tracker.getConnection(0x0041)!.address).toBe("11:22:33:44:55:66");

    tracker.onDisconnection(0x0040);
    expect(tracker.getConnection(0x0040)).toBeUndefined();
    expect(tracker.getConnection(0x0041)).toBeDefined();
  });

  it("clears all connections on reset", () => {
    const tracker = new HciConnectionTracker();
    tracker.onConnectionComplete(0x0040, "AA:BB:CC:DD:EE:FF", "Central");
    tracker.onConnectionComplete(0x0041, "11:22:33:44:55:66", "Peripheral");
    tracker.reset();
    expect(tracker.getConnection(0x0040)).toBeUndefined();
    expect(tracker.getConnection(0x0041)).toBeUndefined();
  });
});
