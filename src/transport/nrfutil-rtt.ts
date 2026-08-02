import { EventEmitter } from "node:events";
import { ChildProcess, spawn, execFileSync } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import type { Transport } from "./types";
import { TransportError } from "../errors";
import { log, logError, logFromHelper } from "../logger";

/** Directory for LogScope's auto-managed Python venv */
const LOGSCOPE_VENV_DIR = path.join(os.homedir(), ".logscope", "venv");
const VENV_PYTHON = path.join(LOGSCOPE_VENV_DIR, process.platform === "win32" ? "Scripts/python.exe" : "bin/python3");

/**
 * Resolve the absolute path of Python to avoid relying on inherited PATH.
 * Searches PATH first, then falls back to common install locations on each platform.
 */
export function resolveSystemPython(): string {
  const cmd = process.platform === "win32" ? "where" : "which";
  const candidates = process.platform === "win32" ? ["python", "python3"] : ["python3", "python"];

  // 1. Try PATH lookup
  for (const candidate of candidates) {
    try {
      const result = execFileSync(cmd, [candidate], { timeout: 5000, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
      const resolved = result.trim().split(/\r?\n/)[0];
      // On Windows, skip the Microsoft Store app execution alias stubs
      if (resolved && !resolved.includes("WindowsApps")) return resolved;
    } catch {
      // Try next candidate
    }
  }

  // 2. Fall back to common install locations
  const wellKnownPaths: string[] = [];
  if (process.platform === "win32") {
    const home = os.homedir();
    const localPrograms = path.join(home, "AppData", "Local", "Programs", "Python");
    // Scan for Python3xx directories (e.g., Python313, Python312)
    try {
      const dirs = fs.readdirSync(localPrograms)
        .filter(d => /^Python3\d+$/.test(d))
        .sort()
        .reverse(); // newest first
      for (const d of dirs) {
        wellKnownPaths.push(path.join(localPrograms, d, "python.exe"));
      }
    } catch {
      // Directory doesn't exist
    }
    wellKnownPaths.push("C:\\Python313\\python.exe", "C:\\Python312\\python.exe", "C:\\Python311\\python.exe");
  } else if (process.platform === "darwin") {
    wellKnownPaths.push(
      "/opt/homebrew/bin/python3",
      "/usr/local/bin/python3",
      "/usr/bin/python3",
    );
  } else {
    wellKnownPaths.push(
      "/usr/bin/python3",
      "/usr/local/bin/python3",
    );
  }

  for (const p of wellKnownPaths) {
    try {
      if (fs.existsSync(p)) {
        // Verify it actually runs
        execFileSync(p, ["--version"], { timeout: 5000, stdio: ["pipe", "pipe", "pipe"] });
        return p;
      }
    } catch {
      // Try next
    }
  }

  throw new Error("Python 3 not found. Install Python 3 from python.org and reload VS Code.");
}

/**
 * Check whether the managed Python venv already exists and has all required packages.
 * Returns true if ensurePythonEnv would return immediately (fast path).
 */
export function isPythonEnvReady(packages: string[]): boolean {
  const IMPORT_MAP: Record<string, string> = { "pylink-square": "pylink", "pyserial": "serial" };
  const importChecks = packages.map(p => IMPORT_MAP[p] ?? p);

  if (fs.existsSync(VENV_PYTHON)) {
    try {
      const checkImports = importChecks.map(m => `import ${m}`).join("; ");
      execFileSync(VENV_PYTHON, ["-c", checkImports], { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  // Check if system python has all packages
  try {
    const systemPython = resolveSystemPython();
    const checkImports = importChecks.map(m => `import ${m}`).join("; ");
    execFileSync(systemPython, ["-c", checkImports], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure a Python venv at ~/.logscope/venv/ with the required packages.
 * Creates the venv on first use and installs any missing packages.
 */
export async function ensurePythonEnv(packages: string[]): Promise<string> {
  // Map pip package names to their Python import names
  const IMPORT_MAP: Record<string, string> = { "pylink-square": "pylink", "pyserial": "serial" };
  const importChecks = packages.map(p => IMPORT_MAP[p] ?? p);

  // 1. Check if our managed venv already exists and has all packages
  if (fs.existsSync(VENV_PYTHON)) {
    try {
      const checkImports = importChecks.map(m => `import ${m}`).join("; ");
      execFileSync(VENV_PYTHON, ["-c", checkImports], { timeout: 5000 });
      return VENV_PYTHON;
    } catch {
      // venv exists but packages missing — install below
    }
  }

  // 2. Check if system python has all packages
  let systemPython: string | undefined;
  try {
    systemPython = resolveSystemPython();
    const checkImports = importChecks.map(m => `import ${m}`).join("; ");
    execFileSync(systemPython, ["-c", checkImports], { timeout: 5000 });
    return systemPython;
  } catch {
    // Not available — need to install
  }

  // 3. Create venv if it doesn't exist
  if (!fs.existsSync(VENV_PYTHON)) {
    console.log("[LogScope] Setting up Python environment (one-time setup)...");
    fs.mkdirSync(path.dirname(LOGSCOPE_VENV_DIR), { recursive: true });

    const python3Path = systemPython ?? resolveSystemPython();

    try {
      execFileSync(python3Path, ["-m", "venv", LOGSCOPE_VENV_DIR], { timeout: 30000 });
    } catch (err) {
      throw new Error(
        `Failed to create Python venv. Ensure python3 is installed.\n${err instanceof Error ? err.message : err}`
      );
    }
  }

  // 4. Install missing packages into venv
  const pip = path.join(LOGSCOPE_VENV_DIR, process.platform === "win32" ? "Scripts/pip.exe" : "bin/pip");
  for (let i = 0; i < packages.length; i++) {
    try {
      execFileSync(VENV_PYTHON, ["-c", `import ${importChecks[i]}`], { timeout: 5000 });
      continue; // Already installed
    } catch {
      // Need to install
    }
    try {
      execFileSync(pip, ["install", packages[i]], { timeout: 60000 });
      console.log(`[LogScope] ${packages[i]} installed successfully`);
    } catch (err) {
      throw new Error(
        `Failed to install ${packages[i]}. Check your internet connection.\n${err instanceof Error ? err.message : err}`
      );
    }
  }

  return VENV_PYTHON;
}

/** Discovered J-Link probe info */
export interface DiscoveredDevice {
  serial: number;
  product: string;
  core?: string;
  device?: string;
  jlinkProduct?: string;
}

/** Result of device discovery — includes diagnostic error when discovery fails */
export interface DiscoveryResult {
  devices: DiscoveredDevice[];
  /** Set when discovery failed or the helper reported a problem (e.g. SEGGER tools missing) */
  error?: string;
}

/**
 * Parse the helper's exit + stdout + stderr into a DiscoveryResult.
 * Exported for unit testing — kept pure (no I/O) so tests can drive every branch.
 *
 * Branches, in order of priority:
 * 1. stdout parses as JSON → trust the helper's structured output
 * 2. exit 0 + empty stdout → helper produced no output (this is a bug; we hit
 *    it once when os._exit() in v0.5.7 dropped buffered stdout). Surface a
 *    "report this" message instead of silently treating as "no devices found".
 * 3. stderr has an ERROR: or Traceback line → use that as the error
 * 4. fallback → use the last non-empty stderr line, or a generic message
 */
export function parseDiscoverResult(
  stdout: string,
  stderrBuf: string,
  exitCode: number | null,
): DiscoveryResult {
  try {
    const result = JSON.parse(stdout);
    return { devices: result.devices ?? [], error: result.error };
  } catch {
    if (stdout.trim() === "" && exitCode === 0) {
      return {
        devices: [],
        error:
          "Discovery helper produced no output. This is likely a LogScope bug — please report at https://github.com/NovelBits/logscope/issues",
      };
    }
    const stderrLines = stderrBuf.trim().split("\n").map(l => l.trim()).filter(Boolean);
    const errorLine = stderrLines.find(l => l.includes("ERROR:") || l.includes("Traceback"));
    if (errorLine) {
      return { devices: [], error: errorLine };
    }
    return { devices: [], error: stderrLines.pop() || "Device discovery failed" };
  }
}

/**
 * Discover connected J-Link probes via pylink.
 * Returns connected probes plus, when discovery fails, a user-actionable error string.
 * Helper stderr is also forwarded to the LogScope output channel for diagnostics.
 */
export async function discoverDevices(): Promise<DiscoveryResult> {
  const helperPath = path.join(__dirname, "rtt-helper.py");

  // Bootstrapping the Python env is the first thing that can fail here, and on
  // a cold machine it is the most likely thing to fail — no Python installed,
  // or pip unable to reach PyPI behind a corporate proxy. Report it the way
  // every other discovery failure is reported: callers expect a DiscoveryResult,
  // never a rejection.
  //
  // Letting this throw left the device QuickPick spinning on "Scanning..."
  // indefinitely, because scanDevices() (extension.ts) wraps the call in
  // try/finally with no catch and invokes it as a floating promise. The error
  // text below is already user-actionable and already classifiable by
  // classifyError() (NO_PYTHON / VENV_FAILED), but none of it ever reached the
  // user.
  let pythonPath: string;
  try {
    pythonPath = await ensurePythonEnv(["pylink-square"]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError("Python environment setup failed during device discovery", err);
    return { devices: [], error: message };
  }

  return new Promise((resolve) => {
    const proc = spawn(pythonPath, [helperPath, "discover"], {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10_000,
    });

    let stdout = "";
    let stderrBuf = "";
    proc.stdout!.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr!.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      stderrBuf += text;
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (trimmed) logFromHelper("rtt-helper", trimmed);
      }
    });
    proc.on("exit", (code) => resolve(parseDiscoverResult(stdout, stderrBuf, code)));
    proc.on("error", (err) => resolve({ devices: [], error: err.message }));
  });
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
  /** J-Link probe serial number — prevents probe selection dialog when multiple probes are connected */
  serialNumber?: string;
  /** Poll interval in ms (default 50) */
  pollIntervalMs?: number;
  /** Path to nrfutil binary for fallback (default: "nrfutil") */
  nrfutilPath?: string;
  /** RTT search ranges (e.g., "0x20000000 0x80000") passed to J-Link SetRTTSearchRanges */
  rttSearchRanges?: string;
  /** Seconds of silence before host-side RTT restart. 0 disables silence-based recovery. Default 30. */
  silenceThresholdSec?: number;
  /** Use legacy libjlinkarm RTT path (pre-v0.6.0). Default false. */
  legacyMode?: boolean;
}

export class NrfutilRttTransport extends EventEmitter implements Transport {
  private _connected = false;
  private helper: ChildProcess | null = null;
  private lastErrorLine = "";
  // Gates the "reset" event. The Python helper's first successful attach goes
  // through full_reconnect() and emits "Reconnected OK" before any user data
  // has flowed — without this gate we'd misclassify every first-connect to a
  // long-running board as a reset event. Flips true once the first byte of
  // log data is parsed off the framed-stdout protocol; from then on,
  // subsequent "Reconnected OK" lines really are mid-session recoveries.
  private firstDataReceived = false;

  /** The device name actually used (may differ from config if auto-detected) */
  detectedDevice: string | null = null;

  private readonly device: string;
  private readonly serialNumber: string;
  private readonly pollIntervalMs: number;
  private readonly nrfutilPath: string;
  private readonly rttSearchRanges: string;
  private readonly silenceThresholdSec: number;
  private readonly legacyMode: boolean;

  constructor(config: RttTransportConfig) {
    super();
    this.device = config.device;
    this.serialNumber = config.serialNumber ?? "";
    this.pollIntervalMs = config.pollIntervalMs ?? 50;
    this.nrfutilPath = config.nrfutilPath ?? "nrfutil";
    this.rttSearchRanges = config.rttSearchRanges ?? "0x20000000 0x80000";
    this.silenceThresholdSec = config.silenceThresholdSec ?? 30;
    this.legacyMode = config.legacyMode ?? false;
  }

  get connected(): boolean {
    return this._connected;
  }

  /**
   * Process a single line of stderr from the helper.
   * Public to enable unit testing; invoked from the proc.stderr listener
   * inside connect() for each non-empty line.
   *
   * Chunk-level pattern detection (RTT_READY, ERROR:, DEVICE_DETECTED) stays
   * inline in connect() because those markers may arrive split across chunks,
   * relying on the accumulated stderrBuf.
   */
  public _handleStderrLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    logFromHelper("rtt-helper", trimmed);

    // Detect board reset recovery — only on full reconnect, not lightweight RTT restart.
    // Suppress until the first data chunk has flowed: the helper's first successful
    // attach also emits "Reconnected OK", which would otherwise show a fake reset
    // banner on every initial connect to a long-running board.
    if (trimmed.startsWith("Reconnected OK")) {
      if (this._connected && this.firstDataReceived) {
        this.emit("reset");
      }
      return;
    }

    // Channel name from helper: "CHANNEL_NAME <idx> <name>". Name may contain spaces.
    const channelNameMatch = /^CHANNEL_NAME (\d+) (.+)$/.exec(trimmed);
    if (channelNameMatch) {
      const index = parseInt(channelNameMatch[1], 10);
      const name = channelNameMatch[2];
      this.emit("channelName", { index, name });
      return;
    }
  }

  async connect(): Promise<void> {
    this.lastErrorLine = "";
    const helperPath = path.join(__dirname, "rtt-helper.py");
    const pythonPath = await ensurePythonEnv(["pylink-square"]);
    log(`Using Python: ${pythonPath}`);
    log(`Helper script: ${helperPath}`);
    log(`nrfutil path: ${this.nrfutilPath || "(auto)"}`);

    return new Promise<void>((resolve, reject) => {
      const args = [
        helperPath,
        this.device,
        String(this.pollIntervalMs),
        this.nrfutilPath,
      ];
      if (this.serialNumber) {
        args.push(this.serialNumber);
      }
      log(`Spawning: ${pythonPath} ${args.map(a => a.includes(" ") ? `"${a}"` : a).join(" ")}`);
      log(`LOGSCOPE_RTT_SEARCH_RANGES="${this.rttSearchRanges}"`);
      log(`LOGSCOPE_RTT_SILENCE_THRESHOLD="${this.silenceThresholdSec}"`);

      const proc = spawn(pythonPath, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          LOGSCOPE_RTT_SEARCH_RANGES: this.rttSearchRanges,
          LOGSCOPE_RTT_SILENCE_THRESHOLD: String(this.silenceThresholdSec),
          LOGSCOPE_RTT_LEGACY: this.legacyMode ? "1" : "0",
        },
      });

      this.helper = proc;
      log(`Helper process started, pid=${proc.pid}`);

      let stderrBuf = "";
      let resolved = false;

      // NOTE: single exit/error handler each — previously there were two
      // listeners that both ran on helper exit, causing inconsistent cleanup.
      // The single handler below covers both connect-time (pre-resolve) and
      // post-connect disconnect paths.

      proc.stderr!.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf-8");
        stderrBuf += text;

        for (const line of text.split("\n")) {
          if (line.trim()) {
            this._handleStderrLine(line);
          }
        }

        // Capture auto-detected device name
        const deviceMatch = /DEVICE_DETECTED (\S+)/.exec(stderrBuf);
        if (deviceMatch && this.detectedDevice !== deviceMatch[1]) {
          this.detectedDevice = deviceMatch[1];
          const isAutoResolution = this.device === "auto";
          log(`${isAutoResolution ? "Auto-resolved" : "Confirmed"} target device: ${this.detectedDevice}${!isAutoResolution && this.device !== this.detectedDevice ? ` (user requested "${this.device}")` : ""}`);
        }

        if (!resolved && stderrBuf.includes("RTT_READY")) {
          resolved = true;
          this._connected = true;
          log("RTT control block found, connection ready");
          this.emit("connected");
          resolve();
        }

        if (!resolved && stderrBuf.includes("ERROR:")) {
          resolved = true;
          const errLine = stderrBuf.split("\n").find(l => l.includes("ERROR:")) ?? "Unknown error";
          this.lastErrorLine = errLine;
          // Infer exit code from error message so callers can distinguish error types
          const inferredExitCode = errLine.includes("No RTT control block") ? 2
            : errLine.includes("No J-Link probes") ? 3
            : errLine.includes("SEGGER J-Link Software not found") ? 5
            : undefined;
          logError("RTT helper reported error", errLine);
          reject(new TransportError(errLine, inferredExitCode));
        }
      });

      // Parse framed stdout: [channel:1][length:4 LE][data:N]
      let frameBuf = Buffer.alloc(0);
      proc.stdout!.on("data", (chunk: Buffer) => {
        if (!this._connected) return;
        frameBuf = Buffer.concat([frameBuf, chunk]);

        while (frameBuf.length >= 5) {
          const channel = frameBuf[0];
          const length = frameBuf.readUInt32LE(1);
          if (frameBuf.length < 5 + length) break;

          const payload = frameBuf.subarray(5, 5 + length);
          frameBuf = frameBuf.subarray(5 + length);

          if (channel === 0) {
            this.firstDataReceived = true;
            this.emit("data", payload);
          } else if (channel === 1) {
            this.firstDataReceived = true;
            this.emit("hci", payload);
          }
        }

        // Prevent unbounded growth on corrupt frames
        if (frameBuf.length > 131072) {
          frameBuf = Buffer.alloc(0);
        }
      });

      proc.on("exit", (code, signal) => {
        log(`Helper process exited: code=${code}, signal=${signal ?? "none"}`);
        const wasConnected = this._connected;
        this._connected = false;
        this.helper = null;

        if (!resolved) {
          resolved = true;
          const msg = this.lastErrorLine || stderrBuf.trim() || `Helper exited with code ${code}`;
          logError("Helper exited before RTT ready", msg);
          reject(new TransportError(msg, code ?? undefined));
        } else if (wasConnected) {
          let reason: string | undefined;
          if (code === 4) {
            if (this.lastErrorLine?.includes("no longer connected") || this.lastErrorLine?.includes("No J-Link probes")) {
              reason = "PROBE_UNPLUGGED";
            } else {
              reason = "RECONNECT_FAILED";
            }
          }
          this.emit("disconnected", { reason, message: this.lastErrorLine });
        }
      });

      proc.on("error", (err) => {
        logError("Helper process error", err);
        this._connected = false;
        this.helper = null;
        if (!resolved) {
          resolved = true;
          reject(new TransportError(err.message));
        } else {
          this.emit("error", err);
        }
      });

      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          proc.kill();
          reject(new TransportError("RTT helper timed out connecting to device"));
        }
      }, 15_000);
    });
  }

  disconnect(): void {
    if (this.helper) {
      const proc = this.helper;
      // Send "quit" to stdin so the helper can do its own graceful cleanup
      // (rtt_stop + jlink.close releases the SEGGER J-Link probe). Best effort.
      try {
        proc.stdin?.write("quit\n");
      } catch {
        // stdin may already be closed
      }
      // SIGTERM the helper synchronously. We can't use setTimeout for a
      // delayed force-kill: when VS Code reloads the window, deactivate() is
      // called and the extension host is torn down immediately after — any
      // pending setTimeout never fires, leaving an orphan helper that still
      // holds the J-Link probe open. Python's SIGTERM handler in rtt-helper.py
      // handles graceful shutdown on the helper side.
      try { proc.kill(); } catch { /* already exited */ }
      this.helper = null;
    }
    this._connected = false;
    this.emit("disconnected");
  }
}
