---
title: Settings Reference
description: All LogScope VS Code settings
---

All settings are prefixed with `logscope.` and can be set in VS Code's `settings.json` or through the Settings UI.

## Connection Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `logscope.transport` | `"rtt"` \| `"uart"` | `"rtt"` | Transport mode for reading log data |
| `logscope.autoConnect` | boolean | `false` | Automatically connect to the last-used device on startup |
| `logscope.lastDevice` | string | `""` | Last connected device serial number (set automatically) |
| `logscope.parser` | `"zephyr"` \| `"nrf5"` \| `"raw"` | `"zephyr"` | Log format parser |

## RTT Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `logscope.nrfutil.path` | string | `"nrfutil"` | Path to nrfutil binary |
| `logscope.rtt.pollInterval` | number | `50` | RTT poll interval in milliseconds |
| `logscope.jlink.device` | string | `"Cortex-M33"` | Target device name for J-Link |
| `logscope.jlink.interface` | `"SWD"` \| `"JTAG"` | `"SWD"` | Debug interface type |
| `logscope.jlink.speed` | number | `4000` | J-Link connection speed in kHz |
| `logscope.jlink.rttSearchRanges` | string | `"0x20000000 0x80000"` | RTT control block search range |

## UART Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `logscope.uart.baudRate` | number | `115200` | Serial baud rate |
| `logscope.uart.lastPort` | string | `""` | Last used serial port (set automatically) |

## Display Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `logscope.logWrap` | boolean | `false` | Wrap long log messages |
| `logscope.timeFormat` | `"24h"` \| `"12h"` | `"24h"` | Time format for the Local Time column |
| `logscope.maxEntries` | number | `100000` | Maximum log entries to keep in memory |

## Watch Patterns

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `logscope.watchPatterns` | array | `[]` | Watch patterns to match against incoming log lines |

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
