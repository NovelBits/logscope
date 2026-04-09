// test/license/license-manager.test.ts

// Mock VS Code API
const mockSecrets = {
  get: jest.fn(),
  store: jest.fn(),
  delete: jest.fn(),
  onDidChange: { event: jest.fn() },
};
const mockGlobalState = {
  get: jest.fn(),
  update: jest.fn(),
  keys: jest.fn().mockReturnValue([]),
  setKeysForSync: jest.fn(),
};
jest.mock("vscode", () => ({
  env: { machineId: "test-machine-id-abc123" },
  window: {
    showInputBox: jest.fn(),
    showInformationMessage: jest.fn(),
    showErrorMessage: jest.fn(),
  },
  extensions: {
    getExtension: jest.fn().mockReturnValue({ packageJSON: { version: "0.4.3" } }),
  },
  Uri: { parse: jest.fn() },
}), { virtual: true });

import { LicenseManager } from "../../src/license/license-manager";
import type { LicenseStatus } from "../../src/license/license-types";

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

function createManager() {
  const context = {
    secrets: mockSecrets,
    globalState: mockGlobalState,
  } as any;
  return new LicenseManager(context, "logscope");
}

describe("LicenseManager", () => {
  let manager: LicenseManager;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSecrets.get.mockResolvedValue(undefined);
    mockGlobalState.get.mockReturnValue(undefined);
    manager = createManager();
  });

  describe("initialize", () => {
    it("loads cached status from globalState", async () => {
      const cached = {
        licenseKey: "NB-TEST",
        status: { valid: true, tier: "pro", lastChecked: Date.now(), cached: false },
        cachedAt: Date.now(),
      };
      mockGlobalState.get.mockReturnValue(cached);
      mockSecrets.get.mockResolvedValue("NB-TEST");
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({ valid: true, tier: "pro" }) });

      await manager.initialize();

      expect(manager.getStatus()?.valid).toBe(true);
      expect(manager.getStatus()?.cached).toBe(true);
    });

    it("returns null status when no license key is stored", async () => {
      await manager.initialize();
      expect(manager.getStatus()).toBeNull();
    });
  });

  describe("isProFeatureAvailable", () => {
    it("returns true always (Pro not yet launched, all features unlocked)", () => {
      expect(manager.isProFeatureAvailable()).toBe(true);
    });

    it("returns true when tier is pro", async () => {
      const cached = {
        licenseKey: "NB-TEST",
        status: { valid: true, tier: "pro", lastChecked: Date.now(), cached: false },
        cachedAt: Date.now(),
      };
      mockGlobalState.get.mockReturnValue(cached);
      mockSecrets.get.mockResolvedValue("NB-TEST");
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({ valid: true, tier: "pro" }) });

      await manager.initialize();
      expect(manager.isProFeatureAvailable()).toBe(true);
    });

    it("returns true when tier is team (team includes pro)", async () => {
      const cached = {
        licenseKey: "NB-TEST",
        status: { valid: true, tier: "team", lastChecked: Date.now(), cached: false },
        cachedAt: Date.now(),
      };
      mockGlobalState.get.mockReturnValue(cached);
      mockSecrets.get.mockResolvedValue("NB-TEST");
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({ valid: true, tier: "team" }) });

      await manager.initialize();
      expect(manager.isProFeatureAvailable()).toBe(true);
    });

    it("returns true even when license is invalid (Pro not yet launched)", async () => {
      const cached = {
        licenseKey: "NB-TEST",
        status: { valid: false, reason: "expired", lastChecked: Date.now(), cached: false },
        cachedAt: Date.now(),
      };
      mockGlobalState.get.mockReturnValue(cached);
      mockSecrets.get.mockResolvedValue("NB-TEST");

      await manager.initialize();
      expect(manager.isProFeatureAvailable()).toBe(true);
    });
  });

  describe("getTierName", () => {
    it("returns 'Free' when no license", () => {
      expect(manager.getTierName()).toBe("Free");
    });

    it("returns 'Pro' for pro tier", async () => {
      const cached = {
        licenseKey: "NB-TEST",
        status: { valid: true, tier: "pro", lastChecked: Date.now(), cached: false },
        cachedAt: Date.now(),
      };
      mockGlobalState.get.mockReturnValue(cached);
      mockSecrets.get.mockResolvedValue("NB-TEST");
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({ valid: true, tier: "pro" }) });

      await manager.initialize();
      expect(manager.getTierName()).toBe("Pro");
    });
  });

  describe("validateNow", () => {
    it("calls the API and returns status", async () => {
      mockSecrets.get.mockResolvedValue("NB-7KMN-P3QR-STVW-XY24");
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          valid: true,
          tier: "pro",
          tools: ["logscope"],
          expires_at: null,
          seats_used: 1,
          seats_max: 1,
        }),
      });

      const status = await manager.validateNow();

      expect(status?.valid).toBe(true);
      expect(status?.tier).toBe("pro");
      expect(status?.cached).toBe(false);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("returns null when no license key is stored", async () => {
      mockSecrets.get.mockResolvedValue(undefined);
      const status = await manager.validateNow();
      expect(status).toBeNull();
    });

    it("returns cached status when server is unreachable", async () => {
      const cached = {
        licenseKey: "NB-TEST",
        status: { valid: true, tier: "pro", lastChecked: Date.now() - 1000, cached: false },
        cachedAt: Date.now(),
      };
      mockGlobalState.get.mockReturnValue(cached);
      mockSecrets.get.mockResolvedValue("NB-TEST");
      mockFetch.mockRejectedValue(new Error("network error"));

      await manager.initialize();
      const status = await manager.validateNow();

      expect(status?.valid).toBe(true);
      expect(status?.cached).toBe(true);
    });
  });

  describe("cache expiration", () => {
    it("ignores cache older than 7 days", async () => {
      const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
      const cached = {
        licenseKey: "NB-TEST",
        status: { valid: true, tier: "pro", lastChecked: eightDaysAgo, cached: false },
        cachedAt: eightDaysAgo,
      };
      mockGlobalState.get.mockReturnValue(cached);
      mockSecrets.get.mockResolvedValue("NB-TEST");

      await manager.initialize();
      // Cache too old, should be treated as null
      expect(manager.getStatus()).toBeNull();
    });
  });
});
