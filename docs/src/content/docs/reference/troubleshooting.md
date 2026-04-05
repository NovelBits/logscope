---
title: Troubleshooting
description: Common issues and solutions
---

## Connection Issues

### "Python 3 not found"

LogScope requires Python 3 for device discovery and UART communication.

**Fix:** Install Python 3 from [python.org](https://www.python.org/downloads/) and reload VS Code.

### "No J-Link devices found"

- Verify your board is connected via USB
- Check that the J-Link driver is installed (comes with [J-Link Software Pack](https://www.segger.com/downloads/jlink/))
- On macOS: check System Preferences > Security for any blocked kernel extensions
- Try `nrfutil device list` in a terminal to verify the device is visible

### "No RTT control block found"

The J-Link connected to the target, but RTT is not enabled in the firmware.

**Fix:**
- Verify your firmware has `CONFIG_USE_SEGGER_RTT=y` and `CONFIG_LOG_BACKEND_RTT=y` in `prj.conf`
- Try resetting the device (LogScope offers a "Reset Device" action in the error card)
- If your RTT control block is at a non-standard address, adjust `logscope.jlink.rttSearchRanges` in settings

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

Change the parser via `LogScope: Select Parser` or in the sidebar settings.

### No HCI packets appearing

HCI packet tracing requires:

1. **J-Link RTT transport** (not UART)
2. **Zephyr firmware** with `CONFIG_BT_DEBUG_MONITOR_RTT=y` in `prj.conf`
3. **HCI toggle enabled** in the filter bar (the purple "HCI" button)

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
- Check if you're over the 3-pattern free limit. Only the first 3 patterns are active on the Free tier.

### Counter shows 0 even though I see matching lines

Watch patterns only match **new incoming lines**. They don't retroactively match lines that were already received before the pattern was added.

## Performance

### Log viewer feels slow with many entries

LogScope keeps up to 100,000 entries in memory by default. If you're experiencing slowness:

- Click **Clear** periodically to reset the buffer
- Reduce `logscope.maxEntries` in settings if you don't need 100K entries
- Disable severity levels you don't need (e.g., turn off DBG if you only care about errors)

## Workspace Trust

LogScope restricts the `logscope.nrfutil.path` and `logscope.jlink.path` settings in untrusted workspaces to prevent untrusted code from pointing LogScope at malicious executables.

If you see warnings about restricted settings, open the workspace trust settings and mark your workspace as trusted.
