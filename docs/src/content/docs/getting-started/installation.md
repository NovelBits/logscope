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

- **J-Link RTT transport:** Requires Python 3. LogScope automatically installs the required `pylink-square` package on first connect. `nrfutil` is optional and only used for nRF device serial number lookup and reset commands.
- **Serial UART transport:** Requires Python 3. LogScope uses a Python helper for serial port communication.
- **Both transports:** No additional drivers needed beyond what your debug probe requires.

:::tip
For Nordic DK boards, installing `nrfutil` (included with the [nRF Command Line Tools](https://www.nordicsemi.com/Products/Development-tools/nrf-command-line-tools/download)) enables automatic device discovery and reset functionality.
:::
