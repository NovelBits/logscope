---
title: Privacy & Telemetry
description: What anonymous usage data LogScope collects, what it never collects, and how to opt out via VS Code's telemetry setting.
---

LogScope collects anonymous usage data to understand how the extension is used in the wild (active users, common transports, common errors). The data informs roadmap decisions and helps catch regressions. **No personal data is ever collected, and you can opt out at any time.**

## What we collect

| Event | What it tells us |
|---|---|
| `activation` | An install opened LogScope (used for daily/monthly active users). Includes extension version, VS Code version, OS, and CPU architecture. |
| `session_start` | A device connection was successfully established. Includes transport (`rtt` or `uart`) and parser mode (`zephyr`, `nrf5`, or `raw`). |
| `session_end` | A device session ended. Includes duration in milliseconds, total log entry count, HCI packet count, error count, and ring-buffer eviction count. |
| `connect_failed` | A connection attempt failed. Includes the error code (e.g. `NO_RTT`, `NO_PROBE`, `UART_OPEN_FAILED`) and transport. Never includes error messages or file paths. |
| `connect_flow_abandoned` | The user dismissed the guided connect picker. Includes which step they were on (transport, parser, device, jlinkDevice, baudRate). |
| `export` | A log file was exported. Includes the format (`text`, `jsonl`, or `btsnoop`) and entry count. |
| `parser_change` | The active parser was changed mid-session. Includes the from and to parser modes. |
| `command` | A LogScope command was invoked from the command palette. Includes only the command identifier. |

Every event is tagged with an anonymous, locally-generated install ID that lets us distinguish unique installs without identifying you. The ID is created the first time LogScope activates and stored only in your local VS Code global state.

## What we never collect

- The contents of your logs (no log messages, no module names you've defined, no timestamps from your firmware)
- File paths, workspace names, or project structure
- Device serial numbers, J-Link probe identifiers, IP addresses, or hostnames
- Error message text (only sanitized error codes)
- Personally identifiable information of any kind
- Anything at all when telemetry is disabled

## Where the data goes

Events are sent to a Novel Bits-owned Azure Application Insights instance, accessed only by the LogScope maintainer. We do not share, sell, or hand off telemetry data to third parties.

## How to opt out

LogScope respects VS Code's global telemetry setting. To disable:

1. Open VS Code Settings (`Cmd+,` on macOS, `Ctrl+,` on Windows/Linux)
2. Search for `telemetry`
3. Set **Telemetry: Telemetry Level** to `off`

When `telemetry.telemetryLevel` is `off`, LogScope sends zero events. The setting is honored automatically by Microsoft's `@vscode/extension-telemetry` package, which LogScope uses for all event reporting; no LogScope-specific opt-out is required.

The same setting is also honored by Cursor, Windsurf, Kiro, and other VS Code-compatible editors.
