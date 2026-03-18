import { ChildProcess, spawn } from "child_process";
import * as net from "net";
import * as fs from "fs";
import * as path from "path";

export interface JLinkConfig {
  jlinkPath: string; // empty = auto-detect
  device: string;
  iface: string; // "SWD" or "JTAG"
  speed: number;
  rttPort: number;
}

// Common J-Link installation paths by platform
const JLINK_PATHS: Record<string, string[]> = {
  darwin: [
    "/Applications/SEGGER/JLink/JLinkExe",
    "/usr/local/bin/JLinkExe",
  ],
  linux: [
    "/opt/SEGGER/JLink/JLinkExe",
    "/usr/bin/JLinkExe",
    "/usr/local/bin/JLinkExe",
  ],
  win32: [
    "C:\\Program Files\\SEGGER\\JLink\\JLink.exe",
    "C:\\Program Files (x86)\\SEGGER\\JLink\\JLink.exe",
  ],
};

export class JLinkManager {
  private process: ChildProcess | null = null;
  private _running = false;

  get running(): boolean {
    return this._running;
  }

  /** Find JLinkExe on the system */
  findJLink(configPath: string): string | null {
    // User-specified path takes priority
    if (configPath && fs.existsSync(configPath)) {
      return configPath;
    }

    // Check platform-specific known paths
    const candidates = JLINK_PATHS[process.platform] ?? [];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        return p;
      }
    }

    // Try PATH lookup
    const exeName = process.platform === "win32" ? "JLink.exe" : "JLinkExe";
    const pathDirs = (process.env.PATH ?? "").split(path.delimiter);
    for (const dir of pathDirs) {
      const candidate = path.join(dir, exeName);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  /** Start JLinkExe and wait for the RTT telnet server to be ready */
  async start(config: JLinkConfig): Promise<{ started: boolean; jlinkPath: string | null; error?: string }> {
    const jlinkPath = this.findJLink(config.jlinkPath);

    if (!jlinkPath) {
      return {
        started: false,
        jlinkPath: null,
        error: "J-Link tools not found. Install from segger.com or set devscope.jlink.path in settings.",
      };
    }

    // Build the command script for JLinkExe
    const commands = [
      `device ${config.device}`,
      `si ${config.iface}`,
      `speed ${config.speed}`,
      "connect",
      "rtt start",
      "", // keep stdin open
    ].join("\n");

    return new Promise((resolve) => {
      try {
        this.process = spawn(jlinkPath, ["-AutoConnect", "1"], {
          stdio: ["pipe", "pipe", "pipe"],
        });

        this._running = true;

        this.process.on("exit", () => {
          this._running = false;
          this.process = null;
        });

        this.process.on("error", (err) => {
          this._running = false;
          this.process = null;
          resolve({
            started: false,
            jlinkPath,
            error: `Failed to start J-Link: ${err.message}`,
          });
        });

        // Send commands to JLinkExe stdin
        this.process.stdin?.write(commands);

        // Wait for the RTT telnet server to become available
        this.waitForPort(config.rttPort, 5000, 100)
          .then(() => {
            resolve({ started: true, jlinkPath });
          })
          .catch(() => {
            // Process started but RTT server didn't come up
            this.stop();
            resolve({
              started: false,
              jlinkPath,
              error: "J-Link started but RTT telnet server did not become available. Check your device connection.",
            });
          });
      } catch (err) {
        this._running = false;
        resolve({
          started: false,
          jlinkPath,
          error: `Failed to spawn J-Link: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    });
  }

  /** Stop JLinkExe process */
  stop(): void {
    if (this.process) {
      // Send quit command gracefully, then kill
      try {
        this.process.stdin?.write("exit\n");
      } catch {
        // stdin may already be closed
      }

      // Force kill after 2 seconds if still alive
      const proc = this.process;
      setTimeout(() => {
        if (proc && !proc.killed) {
          proc.kill("SIGKILL");
        }
      }, 2000);

      this.process = null;
      this._running = false;
    }
  }

  /** Poll a TCP port until it accepts connections */
  private waitForPort(port: number, timeoutMs: number, intervalMs: number): Promise<void> {
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const tryConnect = () => {
        if (Date.now() - startTime > timeoutMs) {
          reject(new Error(`Port ${port} not available after ${timeoutMs}ms`));
          return;
        }

        const socket = new net.Socket();

        socket.once("connect", () => {
          socket.destroy();
          resolve();
        });

        socket.once("error", () => {
          socket.destroy();
          setTimeout(tryConnect, intervalMs);
        });

        socket.connect(port, "localhost");
      };

      tryConnect();
    });
  }
}
