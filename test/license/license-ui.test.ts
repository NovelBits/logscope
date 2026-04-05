// test/license/license-ui.test.ts

jest.mock("vscode", () => ({
  window: {
    showInformationMessage: jest.fn(),
  },
  env: {
    openExternal: jest.fn(),
  },
  Uri: {
    parse: jest.fn((url: string) => url),
  },
  commands: {
    registerCommand: jest.fn((_cmd: string, handler: Function) => ({
      command: _cmd,
      handler,
      dispose: jest.fn(),
    })),
  },
}), { virtual: true });

import * as vscode from "vscode";
import { guardProFeature, showUpgradePrompt } from "../../src/license/license-ui";

const mockShowInfo = vscode.window.showInformationMessage as jest.MockedFunction<typeof vscode.window.showInformationMessage>;

describe("showUpgradePrompt", () => {
  const mockManager = {
    enterLicenseKey: jest.fn(),
    isProFeatureAvailable: jest.fn(),
    isTeamFeatureAvailable: jest.fn(),
    getStatus: jest.fn(),
    getTierName: jest.fn().mockReturnValue("Free"),
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shows upgrade message with feature name", async () => {
    mockShowInfo.mockResolvedValue("Maybe Later" as any);
    await showUpgradePrompt(mockManager, "More than 3 watch patterns");
    expect(mockShowInfo).toHaveBeenCalledWith(
      expect.stringContaining("More than 3 watch patterns"),
      "Enter License Key",
      "View Pricing",
      "Maybe Later",
    );
  });

  it("calls enterLicenseKey when user picks 'Enter License Key'", async () => {
    mockShowInfo.mockResolvedValue("Enter License Key" as any);
    mockManager.enterLicenseKey.mockResolvedValue(true);
    const result = await showUpgradePrompt(mockManager, "test");
    expect(mockManager.enterLicenseKey).toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it("opens pricing URL when user picks 'View Pricing'", async () => {
    mockShowInfo.mockResolvedValue("View Pricing" as any);
    await showUpgradePrompt(mockManager, "test");
    expect(vscode.env.openExternal).toHaveBeenCalled();
  });

  it("returns false when user dismisses", async () => {
    mockShowInfo.mockResolvedValue(undefined as any);
    const result = await showUpgradePrompt(mockManager, "test");
    expect(result).toBe(false);
  });
});

describe("guardProFeature", () => {
  const mockManager = {
    enterLicenseKey: jest.fn(),
    isProFeatureAvailable: jest.fn(),
    isTeamFeatureAvailable: jest.fn(),
    getStatus: jest.fn(),
    getTierName: jest.fn().mockReturnValue("Free"),
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns true when feature is available", async () => {
    mockManager.isProFeatureAvailable.mockReturnValue(true);
    const result = await guardProFeature(mockManager, "Watch Patterns");
    expect(result).toBe(true);
    expect(mockShowInfo).not.toHaveBeenCalled();
  });

  it("shows upgrade prompt when feature is not available", async () => {
    mockManager.isProFeatureAvailable.mockReturnValue(false);
    mockShowInfo.mockResolvedValue("Maybe Later" as any);
    const result = await guardProFeature(mockManager, "Watch Patterns");
    expect(result).toBe(false);
    expect(mockShowInfo).toHaveBeenCalled();
  });
});
