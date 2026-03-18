import { ZephyrLogParser } from "../../src/parser/zephyr-log";

describe("ZephyrLogParser", () => {
  const parser = new ZephyrLogParser();

  test("parses standard Zephyr log line", () => {
    const entries = parser.parse("[00:00:05.123,456] <inf> ble_conn: Connected to AA:BB:CC:DD:EE:FF\n");
    expect(entries).toHaveLength(1);
    expect(entries[0].severity).toBe("inf");
    expect(entries[0].module).toBe("ble_conn");
    expect(entries[0].message).toBe("Connected to AA:BB:CC:DD:EE:FF");
    expect(entries[0].source).toBe("log");
  });

  test("extracts timestamp as microseconds", () => {
    const entries = parser.parse("[00:00:05.123,456] <inf> test: msg\n");
    // 5 seconds + 123ms + 456us = 5,123,456 us
    expect(entries[0].timestamp).toBe(5_123_456);
  });

  test("parses all severity levels", () => {
    const levels = ["err", "wrn", "inf", "dbg"] as const;
    for (const level of levels) {
      const entries = parser.parse(`[00:00:00.000,000] <${level}> mod: msg\n`);
      expect(entries[0].severity).toBe(level);
    }
  });

  test("handles multi-line input", () => {
    const input = [
      "[00:00:01.000,000] <inf> a: first",
      "[00:00:02.000,000] <err> b: second",
      "",
    ].join("\n");
    const entries = parser.parse(input);
    expect(entries).toHaveLength(2);
    expect(entries[0].module).toBe("a");
    expect(entries[1].module).toBe("b");
  });

  test("skips non-matching lines", () => {
    const input = "some random text\n[00:00:01.000,000] <inf> mod: real log\nmore noise\n";
    const entries = parser.parse(input);
    expect(entries).toHaveLength(1);
    expect(entries[0].message).toBe("real log");
  });

  test("handles module names with underscores and dots", () => {
    const entries = parser.parse("[00:00:00.000,000] <inf> bt_hci_core: HCI init\n");
    expect(entries[0].module).toBe("bt_hci_core");
  });

  test("handles empty message after module", () => {
    const entries = parser.parse("[00:00:00.000,000] <dbg> mod:\n");
    expect(entries).toHaveLength(1);
    expect(entries[0].message).toBe("");
  });

  test("handles colons in message text", () => {
    const entries = parser.parse("[00:00:00.000,000] <inf> net: Addr: 192.168.1.1:8080\n");
    expect(entries[0].message).toBe("Addr: 192.168.1.1:8080");
  });

  test("handles partial line in buffer (no newline)", () => {
    const entries = parser.parse("[00:00:00.000,000] <inf> mod: partial");
    expect(entries).toHaveLength(1);
  });

  test("parses hours correctly", () => {
    const entries = parser.parse("[01:30:00.000,000] <inf> mod: after 1.5 hours\n");
    // 1h30m = 5400s = 5,400,000,000 us
    expect(entries[0].timestamp).toBe(5_400_000_000);
  });
});
