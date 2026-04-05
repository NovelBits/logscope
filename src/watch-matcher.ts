import type { LogEntry } from "./parser/types";

export interface WatchPatternConfig {
  name: string;
  pattern: string;
  regex?: boolean;
  module?: string;
  color?: string;
}

export interface WatchHit {
  name: string;
  color: string;
}

const COLOR_PALETTE = [
  "#4caf50", "#2196f3", "#ff9800", "#9c27b0",
  "#00bcd4", "#e91e63", "#8bc34a", "#ff5722",
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface CompiledPattern {
  name: string;
  regex: RegExp;
  module: string | null;
  color: string;
}

export class WatchMatcher {
  private patterns: CompiledPattern[] = [];
  private counters = new Map<string, number>();

  loadPatterns(configs: WatchPatternConfig[]): void {
    this.patterns = configs.map((cfg, i) => {
      const source = cfg.regex ? cfg.pattern : escapeRegex(cfg.pattern);
      return {
        name: cfg.name,
        regex: new RegExp(source, "i"),
        module: cfg.module ? cfg.module.toLowerCase() : null,
        color: cfg.color || COLOR_PALETTE[i % COLOR_PALETTE.length],
      };
    });
    this.counters = new Map(this.patterns.map(p => [p.name, 0]));
  }

  match(entry: LogEntry): void {
    if (this.patterns.length === 0) return;

    const hits: WatchHit[] = [];
    const entryModule = entry.module.toLowerCase();

    for (const p of this.patterns) {
      if (p.module && p.module !== entryModule) continue;
      if (p.regex.test(entry.message)) {
        hits.push({ name: p.name, color: p.color });
        this.counters.set(p.name, (this.counters.get(p.name) ?? 0) + 1);
      }
    }

    if (hits.length > 0) {
      entry.metadata.watchHits = hits;
    }
  }

  getCounters(): { name: string; count: number; color: string }[] {
    return this.patterns.map(p => ({
      name: p.name,
      count: this.counters.get(p.name) ?? 0,
      color: p.color,
    }));
  }

  resetCounters(): void {
    for (const key of this.counters.keys()) {
      this.counters.set(key, 0);
    }
  }
}
