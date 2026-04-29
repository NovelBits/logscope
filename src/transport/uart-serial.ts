import { EventEmitter } from "node:events";
import { ChildProcess, spawn } from "node:child_process";
import * as path from "node:path";
import type { Transport } from "./types";
import { ensurePythonEnv } from "./nrfutil-rtt";
import { TransportError } from "../errors";
import { log, logError, logFromHelper } from "../logger";

/** Configuration for UART serial transport */
export interface UartTransportConfig {
  /** Serial port path (e.g., "/dev/cu.usbmodem...", "COM3") */
  port: string;
  /** Baud rate (default 115200) */
  baudRate?: number;
  /** Data bits per frame (default 8) */
  dataBits?: 5 | 6 | 7 | 8;
  /** Stop bits per frame (default "1"); string because of "1.5" */
  stopBits?: "1" | "1.5" | "2";
  /** Parity (default "none") */
  parity?: "none" | "odd" | "even" | "mark" | "space";
}

/** A serial port discovered on the system */
export interface DiscoveredSerialPort {
  path: string;
  manufacturer?: string;
  serialNumber?: string;
  description?: string;
  product?: string;
  portNumber?: number;
}

/**
 * Discover available serial ports via the Python uart-helper.
 * Filters out Bluetooth and debug virtual ports.
 */
export async function discoverSerialPorts(): Promise<DiscoveredSerialPort[]> {
  const helperPath = path.join(__dirname, "uart-helper.py");

  const pythonPath = await ensurePythonEnv(["pyserial"]);
  return new Promise((resolve) => {
    const proc = spawn(pythonPath, [helperPath, "discover"], {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10_000,
    });

    let stdout = "";
    proc.stdout!.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });

    proc.on("exit", () => {
      try {
        const result = JSON.parse(stdout);
        log(`Serial port scan found ${result.ports?.length ?? 0} ports`);
        resolve(result.ports ?? []);
      } catch {
        logError("Failed to parse serial port scan output");
        resolve([]);
      }
    });

    proc.on("error", (err) => {
      logError("Serial port scan failed", err);
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
  private portWatcher: ReturnType<typeof setInterval> | null = null;
  private readonly portPath: string;
  private readonly baudRate: number;
  private readonly dataBits: 5 | 6 | 7 | 8;
  private readonly stopBits: "1" | "1.5" | "2";
  private readonly parity: "none" | "odd" | "even" | "mark" | "space";

  constructor(config: UartTransportConfig) {
    super();
    this.portPath = config.port;
    this.baudRate = config.baudRate ?? 115200;
    this.dataBits = config.dataBits ?? 8;
    this.stopBits = config.stopBits ?? "1";
    this.parity = config.parity ?? "none";
  }

  get connected(): boolean {
    return this._connected;
  }

  async connect(): Promise<void> {
    if (this._connected) {
      throw new Error("Already connected");
    }

    const helperPath = path.join(__dirname, "uart-helper.py");
    const pythonPath = await ensurePythonEnv(["pyserial"]);

    return new Promise<void>((resolve, reject) => {
      const proc = spawn(pythonPath, [
        helperPath,
        this.portPath,
        String(this.baudRate),
        String(this.dataBits),
        this.stopBits,
        this.parity,
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
            logFromHelper("uart-helper", trimmed);
          }
        }

        if (!resolved && stderrBuf.includes("SERIAL_READY")) {
          resolved = true;
          this._connected = true;
          this.emit("connected");
          // Start monitoring for port disappearance (Windows unplug detection).
          // On Windows, ser.read() blocks indefinitely after unplug and the
          // Python process never exits, so we detect it from the Node side
          // by re-scanning ports every 2 seconds.
          this.startPortWatcher();
          resolve();
        }

        if (!resolved && stderrBuf.includes("ERROR:")) {
          resolved = true;
          const errLine = stderrBuf.split("\n").find(l => l.includes("ERROR:")) ?? "Unknown error";
          reject(new TransportError(errLine.replace(/^ERROR:\s*/i, "")));
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
          reject(new TransportError(`UART helper exited with code ${code} before connecting`, code ?? undefined));
        } else if (wasConnected) {
          this.emit("disconnected", { reason: "UART_DISCONNECTED" });
        }
      });

      proc.on("error", (err) => {
        this._connected = false;
        this.helper = null;
        if (resolved) {
          this.emit("error", err);
        } else {
          resolved = true;
          reject(err);
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

  private startPortWatcher(): void {
    if (process.platform !== "win32") return; // macOS/Linux handle this in the Python helper
    this.portWatcher = setInterval(async () => {
      if (!this._connected) {
        this.stopPortWatcher();
        return;
      }
      try {
        const ports = await discoverSerialPorts();
        const portPaths = ports.map(p => p.path);
        if (!portPaths.includes(this.portPath)) {
          log(`Port ${this.portPath} disappeared — device unplugged`);
          this.disconnect();
        }
      } catch {
        // Scan failed — ignore
      }
    }, 2000);
  }

  private stopPortWatcher(): void {
    if (this.portWatcher) {
      clearInterval(this.portWatcher);
      this.portWatcher = null;
    }
  }

  disconnect(): void {
    this.stopPortWatcher();
    if (this.helper) {
      this.helper.kill();
      this.helper = null;
    }
    this._connected = false;
    this.emit("disconnected");
  }
}
