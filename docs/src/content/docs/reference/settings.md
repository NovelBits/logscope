---
title: Settings Reference
description: Complete reference for all LogScope VS Code settings including RTT, UART, J-Link, display, and watch pattern configuration
---

All settings are prefixed with `logscope.` and can be set in VS Code's `settings.json` or through the Settings UI.

## Where LogScope saves your choices

LogScope never adds a key to your workspace `.vscode/settings.json` on its own, so connecting to a board or switching parsers does not change a version-controlled file.

- **Last device, last serial port, transport and column widths** are remembered per workspace in LogScope's own extension state, not in `settings.json`. The matching settings (`logscope.lastDevice`, `logscope.uart.lastPort`, `logscope.transport`, `logscope.columnWidths`) are optional defaults: LogScope uses one until you make a choice in the UI, and a change you make to the setting replaces what LogScope remembered. A team can commit `logscope.transport` as the default for a fresh checkout.
- **Everything else you change from the LogScope UI** (parser, watch patterns, UART framing, J-Link device overrides, line wrap) is saved where that setting is already defined. If your workspace `settings.json` already defines it, LogScope updates it there. Otherwise LogScope writes it to your user settings.

Upgrading from 0.6.7 or earlier: the values older versions wrote to `.vscode/settings.json` keep working as defaults. You can delete those lines; LogScope will not write them back.

## Connection Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `logscope.transport` | `"rtt"` \| `"uart"` | `"rtt"` | Default transport. LogScope remembers your last choice per workspace (see below) |
| `logscope.autoConnect` | boolean | `false` | Automatically [connect](/logscope/getting-started/connecting/) to the last-used device on startup |
| `logscope.lastDevice` | string | `""` | Optional default J-Link serial number for auto-connect (see below) |
| `logscope.parser` | `"zephyr"` \| `"nrf5"` \| `"raw"` | `"zephyr"` | Log format parser |

## RTT Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `logscope.nrfutil.path` | string | `"nrfutil"` | Path to nrfutil binary |
| `logscope.rtt.pollInterval` | number | `50` | RTT poll interval in milliseconds |
| `logscope.jlink.path` | string | `""` | Path to JLinkExe. Leave empty to auto-detect. |
| `logscope.jlink.device` | string | `"Cortex-M33"` | Default target device name for J-Link. Overridden by per-probe settings in `jlink.deviceOverrides`. |
| `logscope.jlink.deviceOverrides` | object | `{}` | Per-probe J-Link device overrides. Maps probe serial number to target device name (e.g., `{"777195662": "STM32F401RE"}`). Set automatically via Change Settings. |
| `logscope.jlink.remoteHost` | string | `""` | Host or IP of a remote J-Link server to connect to instead of a locally-attached probe. Leave empty for local probes. Experimental; full UI for remote-RTT is in progress. |
| `logscope.jlink.rttSearchRanges` | string | `"0x20000000 0x80000"` | RTT control block search range (base size in hex). Default covers 512KB starting at `0x20000000`. |
| `logscope.rtt.silenceThreshold` | number | `30` | Seconds of RTT silence before LogScope attempts a host-side RTT restart. Quiet devices (BLE peripherals waiting for connections, sensors logging once a minute) commonly go 30s+ without logs. Set to `0` to disable silence-based recovery entirely. Real RTT errors (read failures, dropped probe) are still recovered separately. |

## UART Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `logscope.uart.baudRate` | number | `115200` | Serial baud rate. Supported: 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600, 1000000. |
| `logscope.uart.dataBits` | number | `8` | Data bits per UART frame. Supported: 5, 6, 7, 8. Most modern firmware uses 8. |
| `logscope.uart.stopBits` | string | `"1"` | Stop bits per UART frame. Supported: `"1"`, `"1.5"`, `"2"`. Most modern firmware uses 1. |
| `logscope.uart.parity` | string | `"none"` | UART parity. Supported: `"none"`, `"odd"`, `"even"`, `"mark"`, `"space"`. `"none"` is the most common. |
| `logscope.uart.lastPort` | string | `""` | Optional default serial port for auto-connect (see below) |

The data bits / stop bits / parity settings can also be changed from the **LogScope: Change Settings** command (sidebar gear icon → Change Settings) once you're connected via UART.

## Display Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `logscope.logWrap` | boolean | `false` | Wrap long log messages |
| `logscope.timeFormat` | `"24h"` \| `"12h"` | `"24h"` | Time format for the Local Time column |
| `logscope.maxEntries` | number | `100000` | Maximum log entries to keep in memory |
| `logscope.columnWidths` | object | `{}` | Optional default log-viewer column widths in pixels (keys: `time`, `ts`, `sev`, `mod`). LogScope remembers your resized widths per workspace (see below). |

## Watch Patterns

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `logscope.watchPatterns` | array | `[]` | [Watch patterns](/logscope/features/watch-patterns/) to match against incoming log lines |

Each watch pattern object has these fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Display name for the pattern |
| `pattern` | string | Yes | Text to match (substring or regex) |
| `regex` | boolean | No | Treat pattern as a regular expression (default: `false`) |
| `module` | string | No | Only match entries from this module (case-insensitive) |
| `color` | string | No | Hex color for the marker (e.g., `"#ff9800"`). Auto-assigned if omitted. |

### Example

```json
"logscope.watchPatterns": [
  {
    "name": "Errors",
    "pattern": "failed|error|timeout",
    "regex": true,
    "color": "#f44336"
  },
  {
    "name": "Heartbeat",
    "pattern": "Heartbeat"
  }
]
```
