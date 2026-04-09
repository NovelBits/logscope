---
title: Watch Patterns
description: Monitor specific log patterns in real-time with colored markers
---

Watch patterns let you define text or regex patterns that LogScope matches against every incoming log line. When a line matches, it gets a **colored dot marker** in the log viewer.

This gives you instant visibility into recurring events, errors, or state changes without scrolling through thousands of lines.

## Adding Watch Patterns

### From the Command Palette (Recommended)

Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and run **LogScope: Add Watch Pattern**. You'll see a list of curated presets plus a custom option:

| Preset | Pattern | Type |
|--------|---------|------|
| **Errors** | `failed\|error\|fault\|CRC\|timeout` | Regex |
| **Warnings** | `threshold\|exceeded\|critical\|low\|drift` | Regex |
| **Retransmission** | `Retransmission` | Substring |
| **BLE State** | `Connected\|Disconnected\|Advertising` | Regex |
| **Heartbeat** | `Heartbeat` | Substring |

Select a preset to add it instantly. Presets you've already added are automatically hidden.

Select **Custom pattern...** to define your own with the interactive flow: name, pattern text, match type (substring or regex), and optional module scope.

### From VS Code Settings

Add patterns directly in your `settings.json`:

```json
"logscope.watchPatterns": [
  {
    "name": "Errors",
    "pattern": "failed|error|fault|CRC|timeout",
    "regex": true,
    "color": "#f44336"
  },
  {
    "name": "Retransmission",
    "pattern": "Retransmission",
    "color": "#ff9800"
  },
  {
    "name": "Crypto Only",
    "pattern": "failed",
    "module": "crypto_mgr",
    "color": "#9c27b0"
  }
]
```

## Pattern Options

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Display label shown in the dot tooltip |
| `pattern` | Yes | Text to match. Case-insensitive. |
| `regex` | No | Set `true` to treat pattern as a regular expression. Default: `false` (substring match). |
| `module` | No | Only match log entries from this module (case-insensitive). Omit to match all modules. |
| `color` | No | Hex color for the marker dot (e.g., `#ff9800`). Auto-assigned from a palette if omitted. |

## How It Works

### Colored Dot Markers

When a log line matches a watch pattern, a small colored dot appears at the beginning of the row. If a line matches multiple patterns, multiple dots appear.

Hover over a dot to see the pattern name in the tooltip.

### Settings Changes

Watch patterns reload immediately when you change them in settings. You don't need to reconnect. New patterns start matching from the next incoming log line (they don't retroactively match existing lines).

## Removing Watch Patterns

- **From the Command Palette:** Run `LogScope: Remove Watch Pattern` and select the pattern to remove.
- **From settings:** Remove the entry from the `logscope.watchPatterns` array in `settings.json`.

## Tips

- **Use regex for multiple terms:** `failed|error|timeout` matches any of those words
- **Scope to a module** when the same keyword appears in multiple modules but you only care about one
- **Auto-assigned colors** work well. You don't need to pick colors unless you want specific ones.
- **Watch patterns work in all parser modes** (Zephyr, nRF5 SDK, Raw)
