import { RingBuffer } from "../../src/model/ring-buffer";
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

describe("RingBuffer", () => {
  test("stores entries up to capacity", () => {
    const buf = new RingBuffer(3);
    buf.push(makeEntry(1, "a"));
    buf.push(makeEntry(2, "b"));
    buf.push(makeEntry(3, "c"));
    expect(buf.size).toBe(3);
    expect(buf.getAll().map((e) => e.message)).toEqual(["a", "b", "c"]);
  });

  test("evicts oldest when full", () => {
    const buf = new RingBuffer(3);
    buf.push(makeEntry(1, "a"));
    buf.push(makeEntry(2, "b"));
    buf.push(makeEntry(3, "c"));
    buf.push(makeEntry(4, "d"));
    expect(buf.size).toBe(3);
    expect(buf.getAll().map((e) => e.message)).toEqual(["b", "c", "d"]);
  });

  test("tracks eviction count", () => {
    const buf = new RingBuffer(2);
    buf.push(makeEntry(1, "a"));
    buf.push(makeEntry(2, "b"));
    buf.push(makeEntry(3, "c"));
    expect(buf.evictedCount).toBe(1);
  });

  test("returns entries in insertion order", () => {
    const buf = new RingBuffer(5);
    buf.push(makeEntry(3, "c"));
    buf.push(makeEntry(1, "a"));
    buf.push(makeEntry(2, "b"));
    expect(buf.getAll().map((e) => e.message)).toEqual(["c", "a", "b"]);
  });

  test("clear resets buffer", () => {
    const buf = new RingBuffer(5);
    buf.push(makeEntry(1, "a"));
    buf.push(makeEntry(2, "b"));
    buf.clear();
    expect(buf.size).toBe(0);
    expect(buf.evictedCount).toBe(0);
  });

  test("getAll returns copy, not reference", () => {
    const buf = new RingBuffer(5);
    buf.push(makeEntry(1, "a"));
    const all = buf.getAll();
    buf.push(makeEntry(2, "b"));
    expect(all.length).toBe(1);
  });

  test("truncates messages exceeding max size", () => {
    const buf = new RingBuffer(5, 10); // 10-char max message
    buf.push(makeEntry(1, "short"));
    buf.push(makeEntry(2, "this is a very long message that exceeds the limit"));
    const entries = buf.getAll();
    expect(entries[0].message).toBe("short");
    expect(entries[1].message.endsWith("[truncated]")).toBe(true);
    expect(entries[1].message.length).toBeLessThanOrEqual(10 + "[truncated]".length);
  });
});
