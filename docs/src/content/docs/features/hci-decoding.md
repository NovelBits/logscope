---
title: HCI Packet Decoding
description: Decode Bluetooth LE HCI packets inline in the log viewer
---

LogScope can decode Bluetooth LE HCI (Host Controller Interface) packets in real-time when using J-Link RTT with Zephyr firmware that has the BT Monitor enabled.

## Enabling HCI Tracing

Add these to your Zephyr firmware's `prj.conf`:

```ini
CONFIG_BT_DEBUG_MONITOR_RTT=y
```

This enables the BT Monitor protocol on RTT Channel 1, which streams HCI packets alongside your regular log output on Channel 0.

## What You'll See

HCI packets appear in the log viewer with:

- **Purple "HCI" severity label** and purple left border
- **Module column** showing the packet direction: `CMD` (host to controller), `EVT` (controller to host), `ACL` (data)
- **Message column** with a decoded summary (e.g., "LE Set Advertising Parameters (interval: 48-96, type: 0)")

### Expandable Detail Views

HCI rows with decoded data show a small triangle icon. Click to expand and see:

- **Field table:** Named fields with decoded values (e.g., "Adv Interval Min: 48", "Adv Type: 0")
- **Color-coded values:** Status fields are colored (green for success, red for errors)
- **Raw hex dump:** Click "Show raw hex" to see the raw packet bytes in a formatted hex dump

Click the row again to collapse.

## HCI vs MON

The BT Monitor protocol carries two types of data:

- **HCI packets** (CMD, EVT, ACL) - Real Bluetooth LE protocol traffic between the host and controller
- **MON messages** - Debug strings that the Bluetooth stack mirrors to the monitor channel

By default, MON messages are hidden. Use the **MON** toggle button in the filter bar to show them. The sidebar "HCI Packets" counter only counts real HCI protocol packets, not MON messages.

## Exporting HCI Packets

Export captured HCI packets in **Wireshark btsnoop format** for detailed protocol analysis:

1. Click **Export** in the connection bar
2. Select **Wireshark (.btsnoop)**
3. Open the file in Wireshark

The btsnoop export includes only HCI packets (not regular log entries or MON messages).

## Supported Packets

LogScope decodes common HCI commands and events including:

- LE Set Advertising Parameters/Data/Enable
- LE Set Scan Parameters/Enable
- LE Create Connection
- LE Connection Complete
- LE Connection Update
- LE Read Remote Features
- Disconnect
- Read BD ADDR
- Set Event Mask
- Command Complete/Status events

Packets with unknown opcodes are displayed with the raw opcode value and can still be expanded for hex dump inspection.
