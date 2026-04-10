---
title: Filtering & Search
description: Filter logs by severity, module, and free-text search
---

## Severity Filtering

The filter bar has toggle buttons for each log severity level:

| Button | What It Shows |
|--------|---------------|
| **HCI** | [Bluetooth LE HCI packets](/logscope/features/hci-decoding/) (RTT only) |
| **MON** | BT Monitor mirrored logs (off by default) |
| **ERR** | Error level logs |
| **WRN** | Warning level logs |
| **INF** | Info level logs |
| **DBG** | Debug level logs |

Click a button to toggle that severity on or off. Active buttons are highlighted with their severity color.

**Quick actions:**
- **Checkmark button** - Enable all severities (except MON)
- **X button** - Disable all severities

:::tip
In Raw parser mode, severity toggles are hidden since raw output has no severity levels.
:::

## Module Filtering

The **module picker** dropdown lets you filter logs to a specific firmware module. Click it to see all discovered modules from the current session.

- Select a module name to show only logs from that module
- Select "All modules" to show logs from every module

Modules are discovered automatically as log lines arrive. The list grows as new modules appear in the log output.

## Text Search

Type in the **search box** to filter log lines by content. Search matches against:

- Message text
- Module name
- Severity level
- Device timestamp

Search is case-insensitive and updates with a 150ms debounce (so the view doesn't flicker as you type).

Clear the search box to show all log lines again.

## Combining Filters

All filters work together. For example, you can:

1. Set severity to **ERR** only
2. Set module to **flash_mgr**
3. Type "timeout" in search

This shows only flash_mgr error messages containing "timeout". Filters are applied to all existing rows (not just new ones), so you can filter retroactively.

## Raw Parser Mode

When using the Raw parser, the following UI elements are hidden since they don't apply:

- Severity toggle buttons
- Module picker
- Device timestamp column
- Timestamp toggle button
