import { Session, serializeSession, deserializeSession, exportAsText } from "../../src/model/session";
import type { LogEntry } from "../../src/parser/types";

function makeEntry(timestamp: number, message: string): LogEntry {
  return {
    timestamp,
    source: "log",
    severity: "inf",
    module: "test",
    message,
    metadata: {},
  };
}

describe("Session", () => {
  test("creates session with id and start time", () => {
    const session = new Session("device-1", "rtt");
    expect(session.id).toBeDefined();
    expect(session.deviceName).toBe("device-1");
    expect(session.transport).toBe("rtt");
    expect(session.startTime).toBeInstanceOf(Date);
  });

  test("tracks modules from added entries", () => {
    const session = new Session("device-1", "rtt");
    session.addEntry(makeEntry(1, "hello"));
    session.addEntry({ ...makeEntry(2, "world"), module: "ble" });
    expect(session.modules).toEqual(new Set(["test", "ble"]));
  });
});

describe("serializeSession / deserializeSession", () => {
  test("round-trips session entries to NDJSON", () => {
    const entries = [
      makeEntry(1000, "first"),
      makeEntry(2000, "second"),
    ];
    const ndjson = serializeSession(entries);
    const lines = ndjson.trim().split("\n");
    expect(lines).toHaveLength(2);

    const parsed = deserializeSession(ndjson);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].message).toBe("first");
    expect(parsed[1].timestamp).toBe(2000);
  });
});

describe("exportAsText", () => {
  test("formats entries as readable text lines", () => {
    const entries = [
      makeEntry(1_000_000, "Connected"),
      { ...makeEntry(2_500_000, "Timeout"), severity: "err" as const, module: "ble" },
    ];
    const text = exportAsText(entries);
    expect(text).toContain("[00:00:01.000000]");
    expect(text).toContain("[INF]");
    expect(text).toContain("Connected");
    expect(text).toContain("[ERR]");
    expect(text).toContain("[ble]");
  });
});
