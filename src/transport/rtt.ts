import { EventEmitter } from "events";
import * as net from "net";
import type { Transport } from "./types";

export class RttTransport extends EventEmitter implements Transport {
  private socket: net.Socket | null = null;
  private _connected = false;
  private readonly host: string;
  private readonly port: number;

  constructor(host: string, port: number) {
    super();
    this.host = host;
    this.port = port;
  }

  get connected(): boolean {
    return this._connected;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = new net.Socket();

      this.socket.on("connect", () => {
        this._connected = true;
        this.emit("connected");
        resolve();
      });

      this.socket.on("data", (chunk: Buffer) => {
        this.emit("data", chunk);
      });

      this.socket.on("close", () => {
        this._connected = false;
        this.emit("disconnected");
      });

      this.socket.on("error", (err: Error) => {
        this._connected = false;
        this.emit("error", err);
        reject(err);
      });

      this.socket.connect(this.port, this.host);
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
      this._connected = false;
    }
  }
}
