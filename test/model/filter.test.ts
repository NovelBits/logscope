import { FilterState, applyFilters } from "../../src/model/filter";
import type { LogEntry } from "../../src/parser/types";

function makeEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    timestamp: 0,
    source: "log",
    severity: "inf",
    module: "test",
    message: "hello world",
    metadata: {},
    ...overrides,
  };
}

describe("applyFilters", () => {
  const defaultFilter: FilterState = {
    severities: new Set(["err", "wrn", "inf", "dbg", "trace"]),
    modules: null,
    searchText: "",
    sources: new Set(["log", "rtos", "hci"]),
  };

  test("returns all entries with default filter", () => {
    const entries = [makeEntry(), makeEntry({ message: "second" })];
    expect(applyFilters(entries, defaultFilter)).toHaveLength(2);
  });

  test("filters by severity", () => {
    const entries = [
      makeEntry({ severity: "err" }),
      makeEntry({ severity: "inf" }),
      makeEntry({ severity: "dbg" }),
    ];
    const filter = { ...defaultFilter, severities: new Set(["err"]) as FilterState["severities"] };
    const result = applyFilters(entries, filter);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe("err");
  });

  test("filters by module", () => {
    const entries = [
      makeEntry({ module: "ble" }),
      makeEntry({ module: "spi" }),
      makeEntry({ module: "ble" }),
    ];
    const filter = { ...defaultFilter, modules: new Set(["ble"]) };
    expect(applyFilters(entries, filter)).toHaveLength(2);
  });

  test("filters by text search (case-insensitive)", () => {
    const entries = [
      makeEntry({ message: "Connection established" }),
      makeEntry({ message: "Timeout occurred" }),
      makeEntry({ message: "Connected to peer" }),
    ];
    const filter = { ...defaultFilter, searchText: "connect" };
    expect(applyFilters(entries, filter)).toHaveLength(2);
  });

  test("filters by source", () => {
    const entries = [
      makeEntry({ source: "log" }),
      makeEntry({ source: "rtos" }),
    ];
    const filter = { ...defaultFilter, sources: new Set(["log"]) as FilterState["sources"] };
    expect(applyFilters(entries, filter)).toHaveLength(1);
  });

  test("combines multiple filters (AND logic)", () => {
    const entries = [
      makeEntry({ severity: "err", module: "ble", message: "timeout" }),
      makeEntry({ severity: "err", module: "spi", message: "timeout" }),
      makeEntry({ severity: "inf", module: "ble", message: "connected" }),
    ];
    const filter: FilterState = {
      severities: new Set(["err"]),
      modules: new Set(["ble"]),
      searchText: "timeout",
      sources: new Set(["log", "rtos", "hci"]),
    };
    const result = applyFilters(entries, filter);
    expect(result).toHaveLength(1);
    expect(result[0].module).toBe("ble");
  });

  test("empty search text matches all", () => {
    const entries = [makeEntry(), makeEntry()];
    const filter = { ...defaultFilter, searchText: "" };
    expect(applyFilters(entries, filter)).toHaveLength(2);
  });

  test("search matches severity/level", () => {
    const entries = [
      makeEntry({ severity: "err", message: "something" }),
      makeEntry({ severity: "wrn", message: "something" }),
      makeEntry({ severity: "inf", message: "something" }),
    ];
    const filter = { ...defaultFilter, searchText: "err" };
    expect(applyFilters(entries, filter)).toHaveLength(1);
    expect(applyFilters(entries, filter)[0].severity).toBe("err");
  });

  test("search matches HCI source as level", () => {
    const entries = [
      makeEntry({ source: "hci", severity: "inf", message: "LE Connection Complete" }),
      makeEntry({ source: "log", severity: "inf", message: "hello" }),
    ];
    const filter = { ...defaultFilter, searchText: "hci" };
    expect(applyFilters(entries, filter)).toHaveLength(1);
    expect(applyFilters(entries, filter)[0].source).toBe("hci");
  });

  test("search matches severity case-insensitively", () => {
    const entries = [
      makeEntry({ severity: "err", message: "fail" }),
      makeEntry({ severity: "inf", message: "ok" }),
    ];
    const filter = { ...defaultFilter, searchText: "ERR" };
    expect(applyFilters(entries, filter)).toHaveLength(1);
  });
});
