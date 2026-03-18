import type { LogEntry, Severity, Source } from "../parser/types";

export interface FilterState {
  severities: Set<Severity>;
  modules: Set<string> | null; // null = show all modules
  searchText: string;
  sources: Set<Source>;
}

export function createDefaultFilter(): FilterState {
  return {
    severities: new Set(["err", "wrn", "inf", "dbg", "trace"]),
    modules: null,
    searchText: "",
    sources: new Set(["log", "rtos", "hci"]),
  };
}

export function applyFilters(entries: LogEntry[], filter: FilterState): LogEntry[] {
  return entries.filter((entry) => {
    if (!filter.severities.has(entry.severity)) return false;
    if (!filter.sources.has(entry.source)) return false;
    if (filter.modules !== null && !filter.modules.has(entry.module)) return false;
    if (filter.searchText) {
      const search = filter.searchText.toLowerCase();
      const matchesMessage = entry.message.toLowerCase().includes(search);
      const matchesModule = entry.module.toLowerCase().includes(search);
      if (!matchesMessage && !matchesModule) return false;
    }
    return true;
  });
}
