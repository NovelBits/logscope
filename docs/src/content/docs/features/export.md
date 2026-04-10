---
title: Export
description: Export captured logs in multiple formats
---

Click **Export** in the connection bar (or run [`LogScope: Export`](/logscope/reference/commands/) from the command palette) to save captured logs.

## Export Formats

### Text (.log)

Human-readable plain text. Each line includes the wall-clock timestamp, device timestamp, severity, module, and message.

```
[2026-04-05T08:22:10.537Z] [00:00:14.946] INF app: Heartbeat 5: advertising, uptime 5000 ms
[2026-04-05T08:22:12.537Z] [00:00:16.946] DBG sensor_drv: Temp: 22.00C, Humidity: 45.00%
[2026-04-05T08:22:15.537Z] [00:00:19.946] WRN flash_mgr: Flash wear level high on sector 0x00080000
```

### JSON Lines (.jsonl)

Structured data, one JSON object per line. Useful for scripted analysis, log aggregation, or importing into other tools.

```json
{"timestamp":14946000,"receivedAt":1775362930537,"severity":"inf","module":"app","message":"Heartbeat 5: advertising, uptime 5000 ms","source":"log"}
{"timestamp":16946000,"receivedAt":1775362932537,"severity":"dbg","module":"sensor_drv","message":"Temp: 22.00C, Humidity: 45.00%","source":"log"}
```

### Wireshark btsnoop (.btsnoop)

Binary format containing only HCI packets. Open in [Wireshark](https://www.wireshark.org/) for detailed Bluetooth LE protocol analysis.

This format only includes [HCI packets](/logscope/features/hci-decoding/) (not regular log entries). If no HCI packets were captured, LogScope will tell you and suggest enabling `CONFIG_BT_DEBUG_MONITOR_RTT=y` in your firmware.

## What Gets Exported

All entries currently in the ring buffer are exported. This includes entries captured since the last clear or connection. LogScope keeps up to 100,000 entries in memory (configurable via [`logscope.maxEntries`](/logscope/reference/settings/)).

:::note
Export includes all entries regardless of current filter settings. Even if you have severity filters active, the export captures everything.
:::
