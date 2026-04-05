// src/license/license-manager.ts

import * as vscode from "vscode";
import type { LicenseStatus, LicenseCache, ProFeature, TeamFeature } from "./license-types";

const LICENSE_API_URL = "https://ejptlodtjlejdwyshgfi.supabase.co/functions/v1/tools-license";
const TOOLS_API_KEY = "bf11fe9f6dd076bf94c83d505a3a2d2b5bdcb661856118ea364215ff577f2277";

const CACHE_KEY = "novelbits.licenseCache";
const LICENSE_KEY_SECRET = "novelbits.licenseKey";
const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const RECHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

export class LicenseManager {
  private context: vscode.ExtensionContext;
  private toolId: string;
  private cachedStatus: LicenseStatus | null = null;
  private validating = false;

  constructor(context: vscode.ExtensionContext, toolId: string) {
    this.context = context;
    this.toolId = toolId;
  }

  async initialize(): Promise<void> {
    this.cachedStatus = this.loadCache();
    this.validateAsync();
  }

  isProFeatureAvailable(_feature?: ProFeature): boolean {
    const status = this.getStatus();
    if (!status || !status.valid) return false;
    return ["pro", "team", "enterprise"].includes(status.tier || "");
  }

  isTeamFeatureAvailable(_feature?: TeamFeature): boolean {
    const status = this.getStatus();
    if (!status || !status.valid) return false;
    return ["team", "enterprise"].includes(status.tier || "");
  }

  getStatus(): LicenseStatus | null {
    return this.cachedStatus;
  }

  getTierName(): string {
    const status = this.getStatus();
    if (!status || !status.valid) return "Free";
    switch (status.tier) {
      case "pro": return "Pro";
      case "team": return "Team";
      case "enterprise": return "Enterprise";
      default: return "Free";
    }
  }

  async enterLicenseKey(): Promise<boolean> {
    const key = await vscode.window.showInputBox({
      prompt: "Enter your Novel Bits license key",
      placeHolder: "NB-XXXX-XXXX-XXXX-XXXX",
      validateInput: (value) => {
        const cleaned = value.toUpperCase().replace(/[-\s]/g, "").replace(/^NB/, "");
        if (cleaned.length !== 16)
          return "License key should be 16 characters (NB-XXXX-XXXX-XXXX-XXXX)";
        if (!/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]+$/.test(cleaned))
          return "Invalid characters in license key";
        return null;
      },
    });

    if (!key) return false;

    await this.context.secrets.store(LICENSE_KEY_SECRET, key.trim());

    const status = await this.validateNow();

    if (status?.valid) {
      vscode.window.showInformationMessage(
        `License activated! Welcome to LogScope ${this.getTierName()}.`,
      );
      return true;
    } else {
      vscode.window.showErrorMessage(
        status?.message || "License validation failed. Check your key and try again.",
      );
      // Remove invalid key
      await this.context.secrets.delete(LICENSE_KEY_SECRET);
      return false;
    }
  }

  async removeLicenseKey(): Promise<void> {
    const key = await this.getLicenseKey();
    if (!key) return;

    try {
      await this.apiCall("deactivate", {
        license_key: key,
        tool: this.toolId,
        machine_id: this.getMachineId(),
      });
    } catch {
      // If server is unreachable, still remove locally
    }

    await this.context.secrets.delete(LICENSE_KEY_SECRET);
    await this.context.globalState.update(CACHE_KEY, undefined);
    this.cachedStatus = null;

    vscode.window.showInformationMessage(
      "License key removed. You are now on the Free tier.",
    );
  }

  async validateNow(): Promise<LicenseStatus | null> {
    return this.validate();
  }

  // -- Private Methods --

  private async getLicenseKey(): Promise<string | undefined> {
    return this.context.secrets.get(LICENSE_KEY_SECRET);
  }

  private getMachineId(): string {
    return vscode.env.machineId;
  }

  private getMachineLabel(): string {
    const os = process.platform === "darwin" ? "macOS"
      : process.platform === "win32" ? "Windows"
      : "Linux";
    return `${os} - ${require("os").hostname()}`;
  }

  private loadCache(): LicenseStatus | null {
    const cache = this.context.globalState.get<LicenseCache>(CACHE_KEY);
    if (!cache) return null;

    const age = Date.now() - cache.cachedAt;
    if (age < GRACE_PERIOD_MS) {
      return { ...cache.status, cached: true };
    }
    return null;
  }

  private async saveCache(status: LicenseStatus): Promise<void> {
    const key = await this.getLicenseKey();
    if (!key) return;

    const cache: LicenseCache = {
      licenseKey: key,
      status,
      cachedAt: Date.now(),
    };
    await this.context.globalState.update(CACHE_KEY, cache);
  }

  private async validateAsync(): Promise<void> {
    if (this.cachedStatus && !this.needsRecheck()) return;
    this.validate().catch(() => {
      // Validation failed; cached status (if any) will be used
    });
  }

  private needsRecheck(): boolean {
    if (!this.cachedStatus) return true;
    const age = Date.now() - this.cachedStatus.lastChecked;
    return age > RECHECK_INTERVAL_MS;
  }

  private async validate(): Promise<LicenseStatus | null> {
    const key = await this.getLicenseKey();
    if (!key) {
      this.cachedStatus = null;
      return null;
    }

    if (this.validating) return this.cachedStatus;
    this.validating = true;

    try {
      const response = await this.apiCall("validate", {
        license_key: key,
        tool: this.toolId,
        machine_id: this.getMachineId(),
        machine_label: this.getMachineLabel(),
        extension_version: vscode.extensions.getExtension(
          `novelbits.novelbits-${this.toolId}`,
        )?.packageJSON?.version,
      });

      const status: LicenseStatus = {
        valid: response.valid as boolean,
        tier: response.tier as "pro" | "team" | "enterprise" | undefined,
        tools: response.tools as string[] | undefined,
        expiresAt: response.expires_at as string | null | undefined,
        seatsUsed: response.seats_used as number | undefined,
        seatsMax: response.seats_max as number | undefined,
        reason: response.reason as string | undefined,
        message: response.message as string | undefined,
        lastChecked: Date.now(),
        cached: false,
      };

      this.cachedStatus = status;
      await this.saveCache(status);
      return status;
    } catch {
      if (this.cachedStatus) {
        return this.cachedStatus;
      }
      return null;
    } finally {
      this.validating = false;
    }
  }

  private async apiCall(
    action: string,
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const response = await fetch(LICENSE_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-tools-key": TOOLS_API_KEY,
        },
        body: JSON.stringify({ action, ...data }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return (await response.json()) as Record<string, unknown>;
    } finally {
      clearTimeout(timeout);
    }
  }
}
