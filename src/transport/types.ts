import { EventEmitter } from "events";

export interface Transport extends EventEmitter {
  connect(): Promise<void>;
  disconnect(): void;
  readonly connected: boolean;
}

// Events emitted by Transport:
// "data" - (chunk: Buffer) raw bytes received
// "connected" - connection established
// "disconnected" - connection lost
// "error" - (err: Error) connection error
