import { EventEmitter } from "events";
import { ChildProcess, spawn, execFileSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import type { Transport } from "./types";

/** Directory for LogScope's auto-managed Python venv */
const LOGSCOPE_VENV_DIR = path.join(os.homedir(), ".logscope", "venv");
const VENV_PYTHON = path.join(LOGSCOPE_VENV_DIR, process.platform === "win32" ? "Scripts/python.exe" : "bin/python3");

/**
 * Ensure a Python environment with pylink-square is available.
 * Creates a venv at ~/.logscope/venv/ if needed and installs pylink.
 */
async function ensurePythonWithPylink(): Promise<string> {
  // 1. Check if our managed venv already exists and has pylink
  if (fs.existsSync(VENV_PYTHON)) {
    try {
      execFileSync(VENV_PYTHON, ["-c", "import pylink"], { timeout: 5000 });
      return VENV_PYTHON;
    } catch {
      // venv exists but pylink missing — reinstall below
    }
  }

  // 2. Check if system python3 has pylink
  try {
    execFileSync("python3", ["-c", "import pylink"], { timeout: 5000 });
    return "python3";
  } catch {
    // Not available — need to install
  }

  // 3. Create venv and install pylink
  console.log("[LogScope] Setting up Python environment (one-time setup)...");

  // Ensure ~/.logscope/ exists
  fs.mkdirSync(path.dirname(LOGSCOPE_VENV_DIR), { recursive: true });

  // Create venv
  try {
    execFileSync("python3", ["-m", "venv", LOGSCOPE_VENV_DIR], { timeout: 30000 });
  } catch (err) {
    throw new Error(
      `Failed to create Python venv. Ensure python3 is installed.\n${err instanceof Error ? err.message : err}`
    );
  }

  // Install pylink-square
  const pip = path.join(LOGSCOPE_VENV_DIR, process.platform === "win32" ? "Scripts/pip.exe" : "bin/pip");
  try {
    execFileSync(pip, ["install", "pylink-square"], { timeout: 60000 });
    console.log("[LogScope] pylink-square installed successfully");
  } catch (err) {
    throw new Error(
      `Failed to install pylink-square. Check your internet connection.\n${err instanceof Error ? err.message : err}`
    );
  }

  return VENV_PYTHON;
}

/**
 * RTT transport via SEGGER J-Link.
 *
 * Spawns a Python helper that uses pylink (native J-Link RTT) for
 * zero-packet-loss streaming. Falls back to nrfutil CLI if pylink
 * is not available (nRF devices only, slower).
 *
 * Works with any J-Link probe and any target device.
 */

export interface RttTransportConfig {
  /** J-Link device name (e.g., "NRF54L15_M33", "STM32F407VG") or RTT address hex for nrfutil fallback */
  device: string;
  /** Poll interval in ms (default 50) */
  pollIntervalMs?: number;
  /** Path to nrfutil binary for fallback (default: "nrfutil") */
  nrfutilPath?: string;
}

export class NrfutilRttTransport extends EventEmitter implements Transport {
  private _connected = false;
  private helper: ChildProcess | null = null;

  /** The device name actually used (may differ from config if auto-detected) */
  detectedDevice: string | null = null;

  private readonly device: string;
  private readonly pollIntervalMs: number;
  private readonly nrfutilPath: string;

  constructor(config: RttTransportConfig) {
    super();
    this.device = config.device;
    this.pollIntervalMs = config.pollIntervalMs ?? 50;
    this.nrfutilPath = config.nrfutilPath ?? "nrfutil";
  }

  get connected(): boolean {
    return this._connected;
  }

  async connect(): Promise<void> {
    const helperPath = path.join(__dirname, "rtt-helper.py");
    const pythonPath = await ensurePythonWithPylink();
    console.log(`[LogScope] Using Python: ${pythonPath}`);

    return new Promise<void>((resolve, reject) => {
      const proc = spawn(pythonPath, [
        helperPath,
        this.device,
        String(this.pollIntervalMs),
        this.nrfutilPath,
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
          if (line.trim()) {
            console.log(`[LogScope rtt-helper] ${line.trim()}`);
          }
        }

        // Capture auto-detected device name
        const deviceMatch = stderrBuf.match(/DEVICE_DETECTED (\S+)/);
        if (deviceMatch) {
          this.detectedDevice = deviceMatch[1];
        }

        if (!resolved && stderrBuf.includes("RTT_READY")) {
          resolved = true;
          this._connected = true;
          this.emit("connected");
          resolve();
        }

        if (!resolved && stderrBuf.includes("ERROR:")) {
          resolved = true;
          const errLine = stderrBuf.split("\n").find(l => l.includes("ERROR:")) ?? "Unknown error";
          reject(new Error(errLine));
        }
      });

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
          reject(new Error(`RTT helper exited with code ${code} before connecting`));
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
          reject(new Error("RTT helper timed out connecting to device"));
        }
      }, 15_000);
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
