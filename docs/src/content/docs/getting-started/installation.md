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

LogScope adds a new icon to the VS Code Activity Bar (left sidebar). Click it to open the LogScope sidebar, where you can connect to a device and start viewing logs.

The first time you open LogScope, you'll see a welcome view with:

- **Connect Device** button to start the guided connection flow
- **Open Log Viewer** to open the log viewer panel
- **Get Started Guide** to walk through the basics

## Requirements

- **J-Link RTT transport:** Requires `nrfutil` installed and on your PATH. LogScope uses nrfutil for device discovery and RTT communication.
- **Serial UART transport:** Requires Python 3 installed. LogScope uses a Python helper for serial port communication.
- **Both transports:** No additional drivers needed beyond what your debug probe requires.

:::tip
If you're using a Nordic DK, `nrfutil` is included with the nRF Command Line Tools. Install them from [Nordic's downloads page](https://www.nordicsemi.com/Products/Development-tools/nrf-command-line-tools/download).
:::
