---
title: Connecting a Device
description: How to connect your embedded device to LogScope
---

## Guided Connect Flow

Click **Connect Device** in the sidebar (or run `LogScope: Connect Device` from the command palette). LogScope walks you through three steps:

### Step 1: Select Transport

- **J-Link RTT** - Real-Time Transfer via a J-Link debug probe. Recommended for development boards with built-in J-Link (all Nordic DKs). Non-intrusive, doesn't use a UART peripheral.
- **Serial UART** - USB CDC ACM or UART bridge. Works with any board that has a serial connection.

### Step 2: Select Parser

- **Zephyr** - For firmware using Zephyr's LOG_INF/LOG_ERR/LOG_WRN macros. Parses timestamps, severity, module name, and message.
- **nRF5 SDK** - For firmware using NRF_LOG_INFO/NRF_LOG_ERROR macros. Parses severity, module, and message (no device timestamps).
- **Raw** - For any firmware. Displays output as-is with no parsing. Useful for printf-style debugging.

### Step 3: Select Device

LogScope scans for available devices:

- **RTT:** Lists all connected J-Link probes with serial numbers and target chip names
- **UART:** Lists all serial ports with manufacturer info and port numbers

Select your device and LogScope connects automatically.

## Reconnecting

After your first connection, LogScope remembers your device. The sidebar shows your last connection settings with a **Reconnect** button for one-click reconnection.

## Auto-Connect

Enable [`logscope.autoConnect`](/reference/settings/) in VS Code settings to automatically connect to your last device when VS Code starts.

## Changing Settings

Click **Change Settings** in the sidebar to modify:

- **Transport** (RTT or UART)
- **Device** (rescan for devices)
- **Baud Rate** (UART only)
- **Parser** (Zephyr, nRF5 SDK, or Raw)

:::note
Changing the parser while connected will prompt you to reconnect so the new parser takes effect.
:::

## Multiple Devices

If you have multiple J-Link probes or serial ports connected, LogScope lists all of them during device selection. Each device is identified by its serial number (RTT) or port path (UART).

<!-- Screenshot: Device selection QuickPick showing multiple J-Link probes -->
