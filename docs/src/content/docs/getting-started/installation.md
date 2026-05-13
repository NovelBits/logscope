---
title: Installation
description: How to install LogScope in VS Code
---

## From the VS Code Marketplace

1. Open VS Code
2. Go to the Extensions view (`Cmd+Shift+X` on macOS, `Ctrl+Shift+X` on Windows/Linux)
3. Search for **"LogScope"**
4. Click **Install**

Or install directly from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=novelbits.novelbits-logscope).

## From the Command Line

```bash
code --install-extension novelbits.novelbits-logscope
```

## After Installation

LogScope adds a new icon to the VS Code Activity Bar (left sidebar). Click it to open the LogScope sidebar, where you can [connect to a device](/logscope/getting-started/connecting/) and start viewing logs.

The first time you open LogScope, you'll see a welcome view with:

- **Connect Device** button to start the [guided connection flow](/logscope/getting-started/connecting/)
- **Open Log Viewer** to open the [log viewer panel](/logscope/features/log-viewer/)
- **Get Started Guide** to walk through the basics

## Requirements

- **J-Link RTT transport:**
  - **SEGGER J-Link Software and Documentation Pack** — required so LogScope can discover and talk to your debug probe via `libjlinkarm`. Install from [segger.com/downloads/jlink](https://www.segger.com/downloads/jlink). The macOS installer places it under `/Applications/SEGGER/JLink_V*/`; the Windows installer under `C:\Program Files\SEGGER\JLink_V*\`.
  - **Python 3** — LogScope automatically installs the required `pylink-square` package on first connect.
  - **nrfutil 8.x** (optional) — used for Nordic device auto-detection and reset commands. See the Nordic-only section below for the correct install steps.
- **Serial UART transport:** Requires Python 3. LogScope uses a Python helper for serial port communication.
- **Drivers:** No additional drivers needed beyond what your debug probe requires.

:::tip[Nordic DK boards: install nrfutil 8.x]
For Nordic DK boards, installing nrfutil 8.x enables automatic device discovery (LogScope can identify your nRF chip by part number without you typing the J-Link device name) and the in-app "Reset Device" action.

**Two install steps are required:**

1. Download nrfutil 8.x from [nordicsemi.com/Products/Development-tools/nrf-util/download](https://www.nordicsemi.com/Products/Development-tools/nrf-util/download) and add it to your PATH.
2. Install the `device` subcommand: `nrfutil install device`

Verify with `nrfutil device device-info` (note: that's `device` twice, the subcommand bundle and the action). If that command works, LogScope's Nordic auto-detect will pick up your board automatically.

**Do not install the legacy nrfutil 6.x.** The old `pip install nrfutil` package and the now-deprecated nRF Command Line Tools bundle ship nrfutil 6.x, which has a different command structure (`nrfutil device-info` without the second `device`) and is not compatible with LogScope's auto-detect. If you've already installed it, you can remove it with `pip uninstall nrfutil`.
:::

:::note[What if I don't install nrfutil?]
LogScope still works without nrfutil. The connect flow falls back to a CPUID-based core detection (`Cortex-M33`, `Cortex-M4`, etc.) which is fine for generic boards but may fail to find RTT on chips whose memory map differs from the generic core defaults (some custom Nordic boards, certain STM32 variants). If you hit a "Memory read failed" error on connect, set the exact J-Link device name in VS Code settings (`logscope.jlink.device`, e.g., `NRF54L15_M33`) and reconnect.
:::
