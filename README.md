# LogScope

**Real-time embedded log viewer for VS Code.**

LogScope streams logs directly from your embedded device via SEGGER J-Link RTT — no serial cables, no terminal juggling. Just connect and see your Zephyr, FreeRTOS, or bare-metal logs in a modern, filterable viewer.

![LogScope connected log viewer](docs/images/connected.png)

## Features

- **Zero-config connection** — auto-detects your Nordic device. Select from a curated list for other vendors (ST, Infineon, Silicon Labs, NXP) or use generic Cortex-M targets.
- **Zero packet loss** — uses native J-Link RTT via [pylink](https://github.com/square/pylink), not telnet polling. Every log message arrives.
- **Live filtering** — filter by severity (ERR/WRN/INF/DBG), module, or free-text search. All in real-time as logs stream in.
- **Line wrapping** — toggle between truncated single-line and wrapped multi-line views.
- **Timestamp toggle** — show or hide timestamps with one click.
- **Multi-format export** — export your session as plain text (.log) or structured JSON Lines (.jsonl).
- **Auto-scroll** — follows the latest logs, automatically pauses when you scroll up to inspect.
- **Auto-connect** — remembers your last device and reconnects automatically when VS Code opens.
- **Activity Bar integration** — dedicated sidebar with connection status, entry count, and quick actions.

## Supported Devices

LogScope works with **any device connected via a SEGGER J-Link debug probe**:

| Vendor | Devices |
|--------|---------|
| **Nordic Semiconductor** | nRF54L15, nRF54H20, nRF5340, nRF52840, nRF52833, nRF52832, nRF9160, nRF9161 |
| **STMicroelectronics** | STM32F4, STM32L4, STM32H7, STM32WB, STM32U5 |
| **Infineon** | PSoC 6, XMC4500 |
| **Silicon Labs** | EFR32BG22, EFR32MG24 |
| **NXP** | LPC55S69, i.MX RT1060 |
| **Generic** | Any Cortex-M0+, M4, M7, M33 target |

Nordic devices are auto-detected. Other vendors can be selected from the device dropdown.

## Screenshots

### Welcome Screen
Select your device and connect with one click.

![Welcome screen](docs/images/welcome.png)

### Live Log Viewer
Severity-colored logs with module filtering and search.

![Log viewer](docs/images/connected.png)

### Activity Bar Sidebar
Quick access to connection status, actions, and help.

![Sidebar](docs/images/sidebar.png)

## Quick Start

### Prerequisites

- **J-Link tools** — install from [segger.com](https://www.segger.com/downloads/jlink/)
- **Python 3** with **pylink-square**:
  ```
  pip install pylink-square
  ```
  Or create a venv in the extension directory (LogScope checks `.venv/bin/python3` automatically).

### Install

1. Download the latest `.vsix` from [Releases](https://github.com/NovelBits/logscope/releases)
2. In VS Code: `Ctrl+Shift+P` → "Extensions: Install from VSIX..." → select the file
3. The LogScope icon appears in the Activity Bar

### Connect

1. Click the LogScope icon in the Activity Bar (oscilloscope waveform)
2. Select your device from the dropdown (or leave as "Auto-detect" for Nordic devices)
3. Click **Connect**
4. Logs start streaming immediately

### Export

Click **Export** in the connection bar to save your session:
- **Text (.log)** — human-readable, grep-friendly
- **JSON Lines (.jsonl)** — structured, one JSON object per line

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `logscope.jlink.device` | `Cortex-M33` | J-Link target device name |
| `logscope.rtt.pollInterval` | `50` | RTT poll interval in ms |
| `logscope.maxEntries` | `100000` | Maximum log entries in memory |
| `logscope.logWrap` | `false` | Wrap long messages |
| `logscope.autoConnect` | `false` | Auto-connect on open |

Most users won't need to change these — the defaults work well.

## Commands

All actions are available from the Command Palette (`Ctrl+Shift+P`):

| Command | Description |
|---------|-------------|
| `LogScope: Open Log Viewer` | Open the log viewer panel |
| `LogScope: Connect` | Open the panel and connect |
| `LogScope: Disconnect` | Disconnect from device |
| `LogScope: Export` | Export log session |

## How It Works

LogScope uses [pylink](https://github.com/square/pylink) to communicate with SEGGER J-Link probes natively. When you click Connect:

1. A Python helper process starts and opens a persistent J-Link connection
2. RTT (Real-Time Transfer) is initialized — the J-Link probe handles control block detection automatically
3. Log data streams from the device's RAM buffer to VS Code with zero packet loss
4. The Zephyr log parser extracts timestamps, severity, module names, and messages
5. Entries appear in the viewer in real-time with full filtering support

RTT reads happen without halting the CPU — your firmware keeps running at full speed.

## Requirements

- VS Code 1.110.0 or later
- SEGGER J-Link tools installed
- Python 3.10+ with `pylink-square` package
- A J-Link debug probe (onboard or standalone)

## FAQ

**Q: Does this work with non-Zephyr firmware?**
A: Yes. Any firmware that outputs text via SEGGER RTT channel 0 will work. The parser expects Zephyr log format (`[HH:MM:SS.mmm,uuu] <level> module: message`) but unrecognized lines are still displayed.

**Q: Can I use this without a J-Link?**
A: Not currently. LogScope requires a SEGGER J-Link probe for RTT communication. UART/serial support is planned for a future release.

**Q: My device isn't in the dropdown. What do I do?**
A: Select the matching generic Cortex-M core (M0+, M4, M7, or M33). If you know the exact J-Link device name, you can set it in `logscope.jlink.device` in VS Code settings.

**Q: I'm getting DLL errors on connect.**
A: Make sure no other tool is using the J-Link probe (nRF Connect, Ozone, J-Link Commander). Only one application can hold the J-Link connection at a time.

## License

MIT

## Credits

Built by [Novel Bits](https://novelbits.io) — Bluetooth LE education and tools for embedded developers.
