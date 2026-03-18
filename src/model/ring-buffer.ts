import type { LogEntry } from "../parser/types";

const DEFAULT_MAX_MESSAGE_SIZE = 4096; // 4 KB

export class RingBuffer {
  private buffer: LogEntry[];
  private head = 0;
  private count = 0;
  private readonly capacity: number;
  private readonly maxMessageSize: number;
  private _evictedCount = 0;

  constructor(capacity: number, maxMessageSize = DEFAULT_MAX_MESSAGE_SIZE) {
    this.capacity = capacity;
    this.maxMessageSize = maxMessageSize;
    this.buffer = new Array(capacity);
  }

  get size(): number {
    return this.count;
  }

  get evictedCount(): number {
    return this._evictedCount;
  }

  push(entry: LogEntry): void {
    const truncated = this.truncateIfNeeded(entry);
    const index = (this.head + this.count) % this.capacity;

    if (this.count === this.capacity) {
      this.head = (this.head + 1) % this.capacity;
      this._evictedCount++;
    } else {
      this.count++;
    }

    this.buffer[index] = truncated;
  }

  getAll(): LogEntry[] {
    const result: LogEntry[] = [];
    for (let i = 0; i < this.count; i++) {
      result.push(this.buffer[(this.head + i) % this.capacity]);
    }
    return result;
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
    this._evictedCount = 0;
    this.buffer = new Array(this.capacity);
  }

  private truncateIfNeeded(entry: LogEntry): LogEntry {
    if (entry.message.length <= this.maxMessageSize) {
      return entry;
    }
    return {
      ...entry,
      message: entry.message.slice(0, this.maxMessageSize) + "[truncated]",
    };
  }
}
