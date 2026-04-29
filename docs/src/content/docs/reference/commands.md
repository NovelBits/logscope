---
title: Commands Reference
description: Complete reference for all LogScope VS Code commands including connect, export, parser switching, watch patterns, and licensing
---

All commands are accessible via the command palette (`Cmd+Shift+P` on macOS, `Ctrl+Shift+P` on Windows/Linux).

## Connection Commands

| Command | Description |
|---------|-------------|
| `LogScope: Connect Device` | Start the [guided connection flow](/logscope/getting-started/connecting/) (transport, parser, device) |
| `LogScope: Reconnect` | Reconnect to the last-used device |
| `LogScope: Rescan Devices` | Rescan for J-Link probes or serial ports without restarting the full connect wizard |
| `LogScope: Forget Device` | Clear the saved device and return to the welcome view |
| `LogScope: Disconnect` | Disconnect the current session |
| `LogScope: Change Connection Settings` | Modify transport, device, baud rate, UART frame format (data bits / stop bits / parity), or parser |

## Viewer Commands

| Command | Description |
|---------|-------------|
| `LogScope: Open Log Viewer` | Open or reveal the [log viewer](/logscope/features/log-viewer/) panel |
| `LogScope: Export` | [Export](/logscope/features/export/) captured logs (Text, JSONL, or btsnoop) |
| `LogScope: Select Parser` | Change the log parser (Zephyr, nRF5 SDK, Raw) |

## Watch Pattern Commands

| Command | Description |
|---------|-------------|
| `LogScope: Add Watch Pattern` | Add a [watch pattern](/logscope/features/watch-patterns/) from presets or custom |
| `LogScope: Remove Watch Pattern` | Remove an existing watch pattern |
| `LogScope: Scroll to Watch Match` | Scroll to the last match for a pattern |

## License Commands

:::note
These commands are registered in the command palette but are reserved for a future Pro tier. They have no effect in the current version.
:::

| Command | Description |
|---------|-------------|
| `LogScope: Enter License Key` | Enter a license key to activate Pro |
| `LogScope: Remove License Key` | Deactivate and remove your license key |
| `LogScope: View License Info` | Show current license status and tier |
| `LogScope: Refresh License` | Force re-validate your license with the server |

## Other Commands

| Command | Description |
|---------|-------------|
| `LogScope: Get Started Guide` | Open the interactive walkthrough |
