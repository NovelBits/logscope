---
title: Log Viewer
description: The main log viewing panel and its features
---

The log viewer is where you see real-time firmware output. It opens automatically when you [connect to a device](/logscope/getting-started/connecting/), or you can open it manually with [`LogScope: Open Log Viewer`](/logscope/reference/commands/).

## Columns

| Column | Description |
|--------|-------------|
| **Local Time** | Wall-clock time when LogScope received the log line (from your computer) |
| **Timestamp** | Device's internal timestamp (uptime). Only available with Zephyr parser. |
| **Level** | Severity level: ERR, WRN, INF, DBG, or HCI for Bluetooth LE packets |
| **Module** | Firmware module name (e.g., `app`, `sensor_drv`, `ble_mgr`) |
| **Message** | The log message content |

## Column Toggles

The filter bar has toggle buttons for column visibility:

- **Date** - Show/hide the date portion (YYYY-MM-DD) in the Local Time column. Hidden by default since most sessions are within a single day. The date appears dimmer and slightly smaller than the time for visual separation.
- **Timestamp** - Show/hide the device timestamp column. Automatically hidden for nRF5 SDK and Raw parsers (which don't produce device timestamps).

## Resizable Columns

Drag the right edge of any column header to resize it. Your widths are persisted across panel closes and VS Code restarts via the [`logscope.columnWidths`](/logscope/reference/settings/) setting (set automatically; you do not need to edit it by hand).

**Double-click a column edge** to auto-fit the column to the widest visible content in the current view. Useful after applying a filter, or whenever a long module name or message is being clipped.

To reset all column widths back to defaults, clear the `logscope.columnWidths` entry from your `settings.json`.

## Line Wrapping

Click **Wrap** in the filter bar to toggle word wrapping for long log messages. When wrapping is off, you can scroll horizontally to see the full message content.

## Auto-Scroll

Auto-scroll keeps the log viewer pinned to the bottom so you always see the latest entries. It's enabled by default.

- Auto-scroll **disables automatically** when you scroll up to review older entries
- A **"New log entries"** indicator appears at the bottom. Click it to jump back to the latest entries and re-enable auto-scroll.
- Click the **Auto** button to toggle auto-scroll manually

## Severity Colors

Each severity level has a distinct color and left border:

- **ERR** - Red. Errors that need attention.
- **WRN** - Yellow/amber. Warnings about potential issues.
- **INF** - Blue. Informational messages about normal operation.
- **DBG** - Gray. Verbose debug output.
- **HCI** - Purple. [Bluetooth LE HCI packets](/logscope/features/hci-decoding/) (RTT only).

## Fault Detection

LogScope automatically detects Zephyr fatal errors (hard faults, MPU faults, stack overflows). When a fault is detected:

- The fault line gets a red background and warning icon
- Auto-scroll pauses so you don't miss the fault
- A notification appears: "Fault detected, auto-scroll paused"

## Device Reset Detection

When LogScope detects a `*** Booting` message (indicating a device reset), it inserts a visible separator line with the reset timestamp, so you can distinguish between pre-reset and post-reset logs.

## Clear

Click **Clear** to remove all log entries from the viewer and reset all counters (entries, HCI packets, errors, [watch pattern](/logscope/features/watch-patterns/) counters).

<!-- Screenshot: Log viewer showing mixed severity levels with colored rows -->
