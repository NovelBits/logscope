import { WatchMatcher } from "../src/watch-matcher";
import type { LogEntry } from "../src/parser/types";

function makeEntry(message: string, module = "app"): LogEntry {
  return {
    timestamp: 0,
    source: "log",
    severity: "inf",
    module,
    message,
    metadata: {},
  };
}

describe("WatchMatcher", () => {
  let matcher: WatchMatcher;

  beforeEach(() => {
    matcher = new WatchMatcher();
  });

  describe("loadPatterns", () => {
    it("compiles substring patterns case-insensitively", () => {
      matcher.loadPatterns([{ name: "Test", pattern: "hello" }]);
      const entry = makeEntry("Hello World");
      matcher.match(entry);
      expect(entry.metadata.watchHits).toHaveLength(1);
    });

    it("compiles regex patterns", () => {
      matcher.loadPatterns([{ name: "Test", pattern: "err|warn", regex: true }]);
      const entry = makeEntry("Got an error here");
      matcher.match(entry);
      expect(entry.metadata.watchHits).toHaveLength(1);
    });

    it("escapes special regex characters in substring mode", () => {
      matcher.loadPatterns([{ name: "Test", pattern: "value (123)" }]);
      const entry = makeEntry("the value (123) is set");
      matcher.match(entry);
      expect(entry.metadata.watchHits).toHaveLength(1);
    });

    it("resets counters when patterns are reloaded", () => {
      matcher.loadPatterns([{ name: "A", pattern: "x" }]);
      matcher.match(makeEntry("x"));
      expect(matcher.getCounters()[0].count).toBe(1);
      matcher.loadPatterns([{ name: "A", pattern: "x" }]);
      expect(matcher.getCounters()[0].count).toBe(0);
    });
  });

  describe("match", () => {
    it("does not mutate metadata when no patterns match", () => {
      matcher.loadPatterns([{ name: "Test", pattern: "xyz" }]);
      const entry = makeEntry("no match here");
      matcher.match(entry);
      expect(entry.metadata.watchHits).toBeUndefined();
    });

    it("attaches watchHits with name and color", () => {
      matcher.loadPatterns([{ name: "Heart", pattern: "heartbeat", color: "#ff0000" }]);
      const entry = makeEntry("Heartbeat 5: running");
      matcher.match(entry);
      expect(entry.metadata.watchHits).toEqual([
        { name: "Heart", color: "#ff0000" },
      ]);
    });

    it("matches multiple patterns on one entry", () => {
      matcher.loadPatterns([
        { name: "A", pattern: "hello", color: "#aaa" },
        { name: "B", pattern: "world", color: "#bbb" },
      ]);
      const entry = makeEntry("hello world");
      matcher.match(entry);
      expect(entry.metadata.watchHits).toHaveLength(2);
    });

    it("respects module scope", () => {
      matcher.loadPatterns([{ name: "Test", pattern: "fail", module: "crypto_mgr" }]);
      const crypto = makeEntry("MAC verification failed", "crypto_mgr");
      const flash = makeEntry("Flash write failed", "flash_mgr");
      matcher.match(crypto);
      matcher.match(flash);
      expect(crypto.metadata.watchHits).toHaveLength(1);
      expect(flash.metadata.watchHits).toBeUndefined();
    });

    it("module scope is case-insensitive", () => {
      matcher.loadPatterns([{ name: "Test", pattern: "fail", module: "Crypto_Mgr" }]);
      const entry = makeEntry("failed", "crypto_mgr");
      matcher.match(entry);
      expect(entry.metadata.watchHits).toHaveLength(1);
    });
  });

  describe("counters", () => {
    it("increments counter on each match", () => {
      matcher.loadPatterns([{ name: "Count", pattern: "tick", color: "#000" }]);
      matcher.match(makeEntry("tick 1"));
      matcher.match(makeEntry("tick 2"));
      matcher.match(makeEntry("no match"));
      const counters = matcher.getCounters();
      expect(counters).toEqual([{ name: "Count", count: 2, color: "#000" }]);
    });

    it("resets counters to zero", () => {
      matcher.loadPatterns([{ name: "Count", pattern: "tick" }]);
      matcher.match(makeEntry("tick"));
      matcher.resetCounters();
      expect(matcher.getCounters()[0].count).toBe(0);
    });

    it("returns empty array when no patterns loaded", () => {
      expect(matcher.getCounters()).toEqual([]);
    });
  });

  describe("auto-assigned colors", () => {
    it("assigns colors from palette when color is omitted", () => {
      matcher.loadPatterns([
        { name: "A", pattern: "a" },
        { name: "B", pattern: "b" },
      ]);
      const counters = matcher.getCounters();
      expect(counters[0].color).toBe("#4caf50");
      expect(counters[1].color).toBe("#2196f3");
    });

    it("cycles palette for more than 8 patterns", () => {
      const patterns = Array.from({ length: 9 }, (_, i) => ({
        name: `P${i}`,
        pattern: `p${i}`,
      }));
      matcher.loadPatterns(patterns);
      const counters = matcher.getCounters();
      expect(counters[8].color).toBe(counters[0].color);
    });

    it("uses explicit color when provided", () => {
      matcher.loadPatterns([{ name: "A", pattern: "a", color: "#custom" }]);
      expect(matcher.getCounters()[0].color).toBe("#custom");
    });
  });

  describe("with no patterns loaded", () => {
    it("match is a no-op", () => {
      const entry = makeEntry("anything");
      matcher.match(entry);
      expect(entry.metadata.watchHits).toBeUndefined();
    });
  });
});
