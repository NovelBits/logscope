---
title: Troubleshooting
description: Troubleshoot LogScope connection issues with J-Link RTT and Serial UART, fix Python errors, and resolve display problems
---

## Connection Issues

### "Python 3 not found"

LogScope requires Python 3 for device discovery and UART communication. See [installation requirements](/logscope/getting-started/installation/) for details.

**Fix:** Install Python 3 from [python.org](https://www.python.org/downloads/) and reload VS Code.

### "No J-Link devices found" or "SEGGER J-Link Software not found"

- Install the [SEGGER J-Link Software and Documentation Pack](https://www.segger.com/downloads/jlink) — LogScope uses `libjlinkarm` (macOS) / `JLink_x64.dll` (Windows) to enumerate probes. The default install path is `/Applications/SEGGER/JLink_V*/` on macOS and `C:\Program Files\SEGGER\JLink_V*\` on Windows. Other tools like nRF Connect for VS Code bundle their own libraries, so they may see a probe LogScope can't.
- Verify your board is connected via USB
- On macOS: check System Preferences > Security for any blocked kernel extensions
- Try `nrfutil device list` in a terminal to verify the device is visible

### "No RTT control block found"

The J-Link connected to the target, but RTT is not enabled in the firmware.

**Fix:**
- Verify your firmware has `CONFIG_USE_SEGGER_RTT=y` and `CONFIG_LOG_BACKEND_RTT=y` in `prj.conf`
- Try resetting the device (LogScope offers a "Reset Device" action in the error card)
- If your RTT control block is at a non-standard address, adjust [`logscope.jlink.rttSearchRanges`](/logscope/reference/settings/) in settings

### "Serial device disconnected"

The USB serial device was unplugged or the port became unavailable.

**Fix:** Reconnect the USB cable and click Reconnect in LogScope.

### Connection keeps failing with retries

- Check if another application (PuTTY, minicom, another VS Code instance) has the device/port open
- For RTT: check if a J-Link GDB server is running and occupying the probe
- Try disconnecting and reconnecting the USB cable

## Display Issues

### Logs appear but aren't parsed (everything shows as raw text)

You may be using the wrong parser mode. Check your firmware's log format:

- **Zephyr format:** `[00:00:01.234,567] <inf> module: message` - Use the **Zephyr** parser
- **nRF5 SDK format:** `<info> module: message` - Use the **nRF5 SDK** parser
- **Other/custom format:** Use the **Raw** parser

Change the parser via [`LogScope: Select Parser`](/logscope/reference/commands/) or in the sidebar settings.

### No HCI packets appearing

[HCI packet tracing](/logscope/features/hci-decoding/) requires:

1. **J-Link RTT transport** (not UART)
2. **Zephyr firmware** with `CONFIG_BT_DEBUG_MONITOR_RTT=y` in `prj.conf`
3. **HCI toggle enabled** in the [filter bar](/logscope/features/filtering/) (the purple "HCI" button)

### Timestamps show "0:00:00.000"

The device timestamp column shows the firmware's internal uptime counter. If it's always zero:

- **nRF5 SDK parser:** This parser doesn't extract device timestamps. The column is hidden automatically.
- **Raw parser:** No timestamps are parsed. The column is hidden automatically.
- **Zephyr parser:** Check that your firmware's log output includes timestamps. They should appear as `[HH:MM:SS.mmm,uuu]` at the start of each line.

## Watch Patterns

### Watch pattern dots aren't appearing

- Verify your patterns are correct by checking the exact message text in the log viewer
- Substring matching is case-insensitive, so capitalization shouldn't matter
- If using regex, test your regex with a tool like [regex101.com](https://regex101.com/)
- All configured watch patterns are active for all users, so pattern limits are not the issue.

### Counter shows 0 even though I see matching lines

Watch patterns only match **new incoming lines**. They don't retroactively match lines that were already received before the pattern was added.

## Performance

### Log viewer feels slow with many entries

LogScope keeps up to 100,000 entries in memory by default. If you're experiencing slowness:

- Click **Clear** periodically to reset the buffer
- Reduce [`logscope.maxEntries`](/logscope/reference/settings/) in settings if you don't need 100K entries
- Disable severity levels you don't need (e.g., turn off DBG if you only care about errors)

## Using the LogScope Output Channel

The LogScope output channel provides detailed diagnostic information that is invaluable for troubleshooting.

**How to open it:**

1. Go to **View > Output** (or press `Ctrl+Shift+U` / `Cmd+Shift+U`)
2. Select **LogScope** from the dropdown in the top-right of the Output panel

**What it shows:**

- Spawn commands used to launch helper processes
- Python and helper script paths being used
- J-Link DLL location and version
- Device detection and enumeration details
- RTT control block search status and address

This is especially useful when diagnosing connection failures on non-Nordic boards where default settings may not work. When reporting issues on GitHub, include the full contents of the LogScope output channel to help with diagnosis.

## Connection Issues with Non-Nordic Boards

### Connection fails on STM32/NXP/SiLabs boards

In versions before v0.5.1, the J-Link probe could default to JTAG mode instead of SWD, which caused connection failures on many non-Nordic targets. Updating to v0.5.1 or later resolves this.

If the connection still fails after updating:

- Set [`logscope.jlink.device`](/logscope/reference/settings/) to the **exact chip name** (e.g., `STM32H743II`, `LPC55S69`, `EFR32MG21A010F1024`) instead of a generic core name like `Cortex-M4`
- Check the **LogScope output channel** (see above) for the specific error message
- Make sure the board is powered and the SWD pins (SWDIO, SWCLK, GND) are properly connected to the J-Link probe
- Verify that the J-Link software version supports your target chip

## Workspace Trust

LogScope restricts the [`logscope.nrfutil.path` and `logscope.jlink.path`](/logscope/reference/settings/) settings in untrusted workspaces to prevent untrusted code from pointing LogScope at malicious executables.

If you see warnings about restricted settings, open the workspace trust settings and mark your workspace as trusted.
