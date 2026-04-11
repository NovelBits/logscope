---
title: FAQ
description: Frequently asked questions about LogScope, including compatibility, hardware requirements, supported formats, and licensing
---

## Compatibility

### Does LogScope work with Cursor, Windsurf, or other VS Code forks?

Yes. LogScope works with any editor compatible with VS Code 1.107 or later, including Cursor, Windsurf, and other VS Code-based editors.

### What Python version do I need?

Python 3.8 or later. LogScope automatically installs its Python dependencies on first connect, so no manual pip setup is required. See [Installation](/logscope/getting-started/installation/) for details.

## Hardware

### Can I connect to a J-Link over the network?

Yes. LogScope supports [J-Link Remote Server](/logscope/getting-started/connecting/) connections. Start `JLinkRemoteServerCLExe` on the machine with the probe, then select "Connect to Remote J-Link..." in the device picker and enter the server's IP address. This works with any J-Link, including the on-board probes in Nordic DKs.

### Can I use LogScope without Nordic hardware?

Yes! LogScope is not limited to Nordic devices. Any board with a J-Link debug probe works (STM32, NXP, Silicon Labs, RP2040, etc.), and any board with a USB serial connection works via UART transport. See [Connecting a Device](/logscope/getting-started/connecting/) for setup instructions.

### Do I need nrfutil?

Only if you want automatic nRF device serial number lookup and reset-on-connect functionality. nrfutil is not required for basic RTT or UART operation.

### Does LogScope support multiple devices simultaneously?

Not yet as a simultaneous view, but multi-probe support for switching between connected devices is built in.

## Features

### Can I use LogScope over UART and RTT at the same time?

Not currently. LogScope supports one transport per session. You can choose either J-Link RTT or Serial UART when connecting.

### How many log entries can LogScope handle?

The default limit is 100,000 entries. You can adjust this via the `logscope.maxEntries` setting. See [Settings](/logscope/reference/settings/) for all configuration options.

### Does LogScope work with custom or proprietary log formats?

Yes. Select **Raw** parser mode and LogScope will display log output as-is, without attempting to parse structured fields. This works with any format your firmware produces.

### Can I export HCI packets to Wireshark?

Yes. LogScope can export captured HCI packets in btsnoop format, which Wireshark can open directly. See [Export](/logscope/features/export/) for details.

### Why aren't HCI packets showing up?

HCI packet decoding requires three things:

1. **RTT transport** (not UART)
2. **Zephyr firmware** built with `CONFIG_BT_DEBUG_MONITOR_RTT=y`
3. **HCI toggle enabled** in the LogScope viewer

See [HCI Packet Decoding](/logscope/features/hci-decoding/) for full setup instructions.

## Licensing & Support

### Is LogScope free?

Yes, all current features are free to use. A Pro tier with advanced capabilities is planned for the future.

### How do I report bugs or request features?

Open an issue on [GitHub Issues](https://github.com/NovelBits/logscope/issues). Bug reports, feature requests, and general feedback are all welcome.
