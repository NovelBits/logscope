// src/license/license-types.ts

export interface LicenseStatus {
  valid: boolean;
  tier?: "pro" | "team" | "enterprise";
  tools?: string[];
  expiresAt?: string | null;
  seatsUsed?: number;
  seatsMax?: number;
  reason?: string;
  message?: string;
  lastChecked: number;
  cached: boolean;
}

export interface LicenseCache {
  licenseKey: string;
  status: LicenseStatus;
  cachedAt: number;
}

export type ProFeature =
  | "watch-patterns"
  | "advanced-export"
  | "session-management"
  | "extended-history";

export type TeamFeature =
  | "shared-config"
  | "ci-cd";
