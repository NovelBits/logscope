---
title: Activating a License
description: How to enter, manage, and remove your LogScope Pro license key
---

## Entering a License Key

You can activate your license in two ways:

### From the Sidebar

Click **Enter License Key** at the bottom of the LogScope sidebar. Paste your license key in the format `NB-XXXX-XXXX-XXXX-XXXX` and press Enter.

### From the Command Palette

Run `LogScope: Enter License Key` (`Cmd+Shift+P` on macOS, `Ctrl+Shift+P` on Windows/Linux).

## After Activation

Once activated, you'll see:

- A confirmation message: "License activated! Welcome to LogScope Pro."
- The sidebar bottom changes from "Enter License Key" to "License: Pro" with a verified icon
- Watch pattern limits are removed (unlimited patterns)
- The "3/3 free" indicators disappear

## Viewing License Info

Run `LogScope: View License Info` to see your current license status, tier, and expiration date.

Or click the **License: Pro** item at the bottom of the sidebar.

## Refreshing Your License

Run `LogScope: Refresh License` to force a re-validation with the license server. This is useful if you've renewed your subscription or upgraded your tier.

## How License Validation Works

- Your license key is stored securely in VS Code's encrypted secret storage (OS keychain)
- LogScope validates your key with the license server once every 24 hours
- If the server is unreachable, your cached license status is used for up to 7 days (grace period)
- LogScope never blocks startup to validate your license. Validation happens in the background.

## Removing a License

Run `LogScope: Remove License Key` to deactivate your license on this machine and revert to the Free tier.

This frees up a seat if you have a multi-seat license. Your patterns are not deleted, but they will be limited to the first 3 on the Free tier.

## License Key Format

LogScope license keys follow the format:

```
NB-XXXX-XXXX-XXXX-XXXX
```

Where each X is an alphanumeric character (A-Z, 2-9, excluding ambiguous characters like 0/O and 1/I/L). The key is case-insensitive and hyphens are optional when entering.
