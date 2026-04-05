// src/license/license-ui.ts

import * as vscode from "vscode";
import type { LicenseManager } from "./license-manager";
import type { ProFeature, TeamFeature } from "./license-types";

const PRICING_URL = "https://novelbits.io/tools/pricing";

export async function showUpgradePrompt(
  licenseManager: LicenseManager,
  featureName: string,
): Promise<boolean> {
  const choice = await vscode.window.showInformationMessage(
    `"${featureName}" is a Pro feature. Upgrade to unlock it.`,
    "Enter License Key",
    "View Pricing",
    "Maybe Later",
  );

  switch (choice) {
    case "Enter License Key":
      return licenseManager.enterLicenseKey();
    case "View Pricing":
      vscode.env.openExternal(vscode.Uri.parse(PRICING_URL));
      return false;
    default:
      return false;
  }
}

export async function guardProFeature(
  licenseManager: LicenseManager,
  featureName: string,
  _feature?: ProFeature,
): Promise<boolean> {
  if (licenseManager.isProFeatureAvailable(_feature)) return true;
  return showUpgradePrompt(licenseManager, featureName);
}

export async function guardTeamFeature(
  licenseManager: LicenseManager,
  featureName: string,
  _feature?: TeamFeature,
): Promise<boolean> {
  if (licenseManager.isTeamFeatureAvailable(_feature)) return true;

  const choice = await vscode.window.showInformationMessage(
    `"${featureName}" requires a Team license. You are currently on ${licenseManager.getTierName()}.`,
    "View Team Pricing",
    "Maybe Later",
  );

  if (choice === "View Team Pricing") {
    vscode.env.openExternal(vscode.Uri.parse(`${PRICING_URL}?tier=team`));
  }

  return false;
}

export function registerLicenseCommands(
  context: vscode.ExtensionContext,
  licenseManager: LicenseManager,
  toolId: string,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(`${toolId}.enterLicenseKey`, () =>
      licenseManager.enterLicenseKey(),
    ),
    vscode.commands.registerCommand(`${toolId}.removeLicenseKey`, () =>
      licenseManager.removeLicenseKey(),
    ),
    vscode.commands.registerCommand(`${toolId}.viewLicenseInfo`, async () => {
      const status = licenseManager.getStatus();
      if (!status || !status.valid) {
        const choice = await vscode.window.showInformationMessage(
          "No active license. You are on the Free tier.",
          "Enter License Key",
          "View Pricing",
        );
        if (choice === "Enter License Key") await licenseManager.enterLicenseKey();
        if (choice === "View Pricing") vscode.env.openExternal(vscode.Uri.parse(PRICING_URL));
        return;
      }

      const expires = status.expiresAt
        ? `Expires: ${new Date(status.expiresAt).toLocaleDateString()}`
        : "No expiration";
      const seats = status.seatsMax && status.seatsMax > 1
        ? `Seats: ${status.seatsUsed}/${status.seatsMax}`
        : "";

      vscode.window.showInformationMessage(
        `License: ${licenseManager.getTierName()} | ${expires}${seats ? " | " + seats : ""}`,
      );
    }),
    vscode.commands.registerCommand(`${toolId}.refreshLicense`, async () => {
      await licenseManager.validateNow();
      const tier = licenseManager.getTierName();
      vscode.window.showInformationMessage(`License refreshed. Current tier: ${tier}`);
    }),
  );
}
