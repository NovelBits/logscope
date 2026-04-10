---
title: Overview
description: What LogScope does and who it's for
---

LogScope is a VS Code extension from Novel Bits for viewing real-time firmware logs from embedded devices. It connects to your device over **J-Link RTT** (Real-Time Transfer) or **Serial UART**, parses structured log output, and displays it in a filterable, searchable log viewer.

## Key Features

- **[Real-time log viewing](/logscope/features/log-viewer/)** with severity coloring (ERR, WRN, INF, DBG)
- **Three parser modes:** Zephyr RTOS, nRF5 SDK, and Raw (any firmware)
- **[Watch patterns](/logscope/features/watch-patterns/)** that match incoming log lines and highlight them with colored markers
- **[Bluetooth LE HCI packet decoding](/logscope/features/hci-decoding/)** with expandable detail views
- **[Module filtering](/logscope/features/filtering/)** to focus on specific firmware subsystems
- **[Multi-format export](/logscope/features/export/):** Text (.log), JSON Lines (.jsonl), Wireshark btsnoop
- **Multi-probe support** for working with multiple devices

## Supported Firmware

LogScope works with any firmware that outputs text logs over RTT or UART:

| Parser Mode | Format | Example |
|-------------|--------|---------|
| **Zephyr** | `[HH:MM:SS.mmm,uuu] <level> module: message` | `[00:00:01.234,567] <inf> app: Hello` |
| **nRF5 SDK** | `<level> module: message` | `<info> app: Hello` |
| **Raw** | Any text, displayed as-is | `Hello World` |

## Requirements

- VS Code 1.107 or later (also works with Windsurf, Cursor, and Kiro)
- A J-Link debug probe (built into most Nordic DKs) for RTT, or a USB serial connection for UART
- For [HCI packet decoding](/logscope/features/hci-decoding/): Zephyr firmware with `CONFIG_BT_DEBUG_MONITOR_RTT=y`

## Who It's For

LogScope is designed for embedded developers working with:

- **Zephyr RTOS** (Nordic nRF, STMicro STM32, NXP, Silicon Labs, and more)
- **nRF5 SDK** legacy projects
- **Any firmware** with text-based logging over RTT or UART
- **Bluetooth LE** firmware that needs HCI-level debugging
