import { HciConnectionTracker } from "../../src/parser/hci-connection-tracker";

describe("HciConnectionTracker", () => {
  let tracker: HciConnectionTracker;

  beforeEach(() => {
    tracker = new HciConnectionTracker();
  });

  it("tracks a new connection", () => {
    tracker.onConnectionComplete(0x0040, "AA:BB:CC:DD:EE:FF", "Central");
    expect(tracker.getConnection(0x0040)).toEqual({ address: "AA:BB:CC:DD:EE:FF", role: "Central" });
  });

  it("returns undefined for unknown handle", () => {
    expect(tracker.getConnection(0x0040)).toBeUndefined();
  });

  it("removes connection on disconnect", () => {
    tracker.onConnectionComplete(0x0040, "AA:BB:CC:DD:EE:FF", "Central");
    tracker.onDisconnection(0x0040);
    expect(tracker.getConnection(0x0040)).toBeUndefined();
  });

  it("tracks multiple connections", () => {
    tracker.onConnectionComplete(0x0040, "AA:BB:CC:DD:EE:FF", "Central");
    tracker.onConnectionComplete(0x0041, "11:22:33:44:55:66", "Peripheral");
    expect(tracker.getConnection(0x0040)).toEqual({ address: "AA:BB:CC:DD:EE:FF", role: "Central" });
    expect(tracker.getConnection(0x0041)).toEqual({ address: "11:22:33:44:55:66", role: "Peripheral" });
  });

  it("updates address on reconnection with same handle", () => {
    tracker.onConnectionComplete(0x0040, "AA:BB:CC:DD:EE:FF", "Central");
    tracker.onConnectionComplete(0x0040, "11:22:33:44:55:66", "Peripheral");
    expect(tracker.getConnection(0x0040)).toEqual({ address: "11:22:33:44:55:66", role: "Peripheral" });
  });

  it("resets all connections", () => {
    tracker.onConnectionComplete(0x0040, "AA:BB:CC:DD:EE:FF", "Central");
    tracker.onConnectionComplete(0x0041, "11:22:33:44:55:66", "Peripheral");
    tracker.reset();
    expect(tracker.getConnection(0x0040)).toBeUndefined();
    expect(tracker.getConnection(0x0041)).toBeUndefined();
  });

  it("disconnect of unknown handle is a no-op", () => {
    tracker.onDisconnection(0x9999);
    expect(tracker.getConnection(0x9999)).toBeUndefined();
  });
});
