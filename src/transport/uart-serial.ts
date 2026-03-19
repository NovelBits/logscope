import { EventEmitter } from "events";
import { ChildProcess, spawn } from "child_process";
import * as path from "path";
import type { Transport } from "./types";

// Reuse the same Python environment setup from the RTT transport
// (ensurePythonWithPylink checks for system python3 or managed venv)

/** Configuration for UART serial transport */
export interface UartTransportConfig {
  /** Serial port path (e.g., "/dev/cu.usbmodem...", "COM3") */
  port: string;
  /** Baud rate (default 115200) */
  baudRate?: number;
}

/** A serial port discovered on the system */
export interface DiscoveredSerialPort {
  path: string;
  manufacturer?: string;
  serialNumber?: string;
}

/**
 * Discover available serial ports via the Python uart-helper.
 * Filters out Bluetooth and debug virtual ports.
 */
export async function discoverSerialPorts(): Promise<DiscoveredSerialPort[]> {
  const helperPath = path.join(__dirname, "uart-helper.py");

  return new Promise((resolve) => {
    const proc = spawn("python3", [helperPath, "discover"], {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10_000,
    });

    let stdout = "";
    proc.stdout!.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });

    proc.on("exit", () => {
      try {
        const result = JSON.parse(stdout);
        console.log(`[LogScope] Serial port scan found ${result.ports?.length ?? 0} ports`);
        resolve(result.ports ?? []);
      } catch {
        console.error("[LogScope] Failed to parse serial port scan output");
        resolve([]);
      }
    });

    proc.on("error", (err) => {
      console.error("[LogScope] Serial port scan failed:", err.message);
      resolve([]);
    });
  });
}

/**
 * UART serial transport for log streaming.
 *
 * Spawns a Python helper (uart-helper.py) that reads from a serial port
 * using pyserial and pipes raw bytes to stdout. Same subprocess pattern
 * as the RTT transport.
 *
 * No HCI framing — UART is log-only.
 *
 * Events: connected, disconnected, data, error
 */
export class UartTransport extends EventEmitter implements Transport {
  private _connected = false;
  private helper: ChildProcess | null = null;
  private readonly portPath: string;
  private readonly baudRate: number;

  constructor(config: UartTransportConfig) {
    super();
    this.portPath = config.port;
    this.baudRate = config.baudRate ?? 115200;
  }

  get connected(): boolean {
    return this._connected;
  }

  async connect(): Promise<void> {
    if (this._connected) {
      return Promise.reject(new Error("Already connected"));
    }

    const helperPath = path.join(__dirname, "uart-helper.py");

    return new Promise<void>((resolve, reject) => {
      const proc = spawn("python3", [
        helperPath,
        this.portPath,
        String(this.baudRate),
      ], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      this.helper = proc;
      let stderrBuf = "";
      let resolved = false;

      proc.stderr!.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf-8");
        stderrBuf += text;

        for (const line of text.split("\n")) {
          const trimmed = line.trim();
          if (trimmed) {
            console.log(`[LogScope uart-helper] ${trimmed}`);
          }
        }

        if (!resolved && stderrBuf.includes("SERIAL_READY")) {
          resolved = true;
          this._connected = true;
          this.emit("connected");
          resolve();
        }

        if (!resolved && stderrBuf.includes("ERROR:")) {
          resolved = true;
          const errLine = stderrBuf.split("\n").find(l => l.includes("ERROR:")) ?? "Unknown error";
          reject(new Error(errLine.replace(/^ERROR:\s*/i, "")));
        }
      });

      // Raw stdout — no framing (unlike RTT which uses channel framing)
      proc.stdout!.on("data", (chunk: Buffer) => {
        if (this._connected) {
          this.emit("data", chunk);
        }
      });

      proc.on("exit", (code) => {
        const wasConnected = this._connected;
        this._connected = false;
        this.helper = null;

        if (!resolved) {
          resolved = true;
          reject(new Error(`UART helper exited with code ${code} before connecting`));
        } else if (wasConnected) {
          this.emit("disconnected");
        }
      });

      proc.on("error", (err) => {
        this._connected = false;
        this.helper = null;
        if (!resolved) {
          resolved = true;
          reject(err);
        } else {
          this.emit("error", err);
        }
      });

      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          proc.kill();
          reject(new Error(`Timed out opening serial port ${this.portPath}`));
        }
      }, 10_000);
    });
  }

  disconnect(): void {
    if (this.helper) {
      this.helper.kill();
      this.helper = null;
    }
    this._connected = false;
    this.emit("disconnected");
  }
}
