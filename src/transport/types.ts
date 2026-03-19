import { EventEmitter } from "events";

export interface Transport extends EventEmitter {
  connect(): Promise<void>;
  disconnect(): void;
  readonly connected: boolean;
}

// Events emitted by Transport:
// "data" - (chunk: Buffer) raw bytes received
// "hci" - (chunk: Buffer) HCI packet data (RTT channel 1 only)
// "connected" - connection established
// "disconnected" - connection lost
// "error" - (err: Error) connection error
// "reset" - device reset detected

export type TransportType = "rtt" | "uart";

/** Config sent from the webview when user clicks Connect */
export interface ConnectConfig {
  transport: TransportType;
  /** J-Link device name for RTT, or serial port path for UART */
  device: string;
  /** Baud rate for UART transport (default 115200) */
  baudRate?: number;
}
