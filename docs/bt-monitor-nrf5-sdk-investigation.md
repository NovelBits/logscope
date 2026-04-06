# Investigation: bt_monitor Support for nRF5 SDK Users

**Date:** 2026-04-06
**Origin:** User report from mike snyder (nRF52840, J-Link Plus, nRF5 SDK 17.1.0)
**Status:** Confirmed limitation — bt_monitor is Zephyr-only

---

## Summary

A user attempted to use LogScope's BLE HCI packet decoding feature with the **nRF5 SDK** (v17.1.0) on an nRF52840 and discovered that `bt_monitor` does not exist in the nRF5 SDK. This is correct — the BT Monitor protocol that LogScope relies on for HCI decoding is a **Zephyr subsystem only** (`CONFIG_BT_DEBUG_MONITOR_RTT=y`). The nRF5 SDK has no equivalent built-in mechanism for streaming HCI packets over RTT.

## Background

### How LogScope's HCI Decoding Works

1. Zephyr's Bluetooth stack has a built-in **BT Monitor** feature that mirrors all HCI traffic (commands, events, ACL data) to **RTT Channel 1** using a specific binary protocol.
2. LogScope reads RTT Channel 0 (logs) and Channel 1 (HCI) simultaneously.
3. The HCI parser (`src/parser/hci-parser.ts`) decodes the BT Monitor protocol frames from Channel 1.
4. Decoded packets appear inline in the log viewer with purple "HCI" labels.

### Zephyr Config Required

```ini
CONFIG_BT_DEBUG_MONITOR_RTT=y
```

This Kconfig symbol is defined in the Zephyr Bluetooth subsystem. It does not exist in the nRF5 SDK.

### nRF5 SDK Situation

The nRF5 SDK (legacy, non-Zephyr) uses a completely different Bluetooth stack (`softdevice` based). It does not have:
- A BT Monitor protocol implementation
- Built-in HCI mirroring to RTT
- An equivalent Kconfig or `sdk_config.h` option for HCI tracing over RTT

The nRF5 SDK's BLE stack is closed-source (SoftDevice), so there's no straightforward way to intercept HCI packets at the host-controller boundary.

## Current State in LogScope

### What Works with nRF5 SDK

- **Log parsing** via the nRF5 SDK parser (`src/parser/nrf5-log.ts`) — parses `<severity> module: message` format
- **RTT and UART transports** — connection and log streaming works fine
- **nRF5 SDK demo** — `samples/nrf52840-nrf5sdk-uart-demo/` (UART only)

### What Does NOT Work with nRF5 SDK

- **HCI packet decoding** — no BT Monitor data on RTT Channel 1
- **btsnoop export** — no HCI packets to export
- **BLE traffic visibility** — no inline BLE protocol decoding

### Affected Code Locations

| File | Line(s) | Issue |
|------|---------|-------|
| `src/extension.ts` | 938 | Warning message says "enable the Bluetooth LE monitor (bt_monitor)" without clarifying this is Zephyr-only |
| `docs/src/content/docs/features/hci-decoding.md` | 6, 10-14 | Only mentions Zephyr, but doesn't explicitly state nRF5 SDK is unsupported |
| `docs/src/content/docs/reference/troubleshooting.md` | 55-60 | "No HCI packets appearing" section says "Zephyr firmware" is required but could be clearer for nRF5 SDK users |

## Recommended Actions

### 1. Documentation Improvements (Low effort, high value)

**a. HCI Decoding docs (`docs/src/content/docs/features/hci-decoding.md`)**

Add a note near the top:

> **Note:** HCI packet decoding requires Zephyr (NCS) firmware. The nRF5 SDK does not include the BT Monitor protocol and cannot stream HCI packets over RTT. If you are using the nRF5 SDK, consider migrating to NCS/Zephyr for BLE HCI tracing support.

**b. Troubleshooting docs (`docs/src/content/docs/reference/troubleshooting.md`)**

Expand the "No HCI packets appearing" section to explicitly mention nRF5 SDK:

> **Using nRF5 SDK?** HCI packet tracing is not supported with the nRF5 SDK. The BT Monitor protocol (`CONFIG_BT_DEBUG_MONITOR_RTT`) is a Zephyr subsystem and has no equivalent in the nRF5 SDK. To use HCI decoding, you'll need Zephyr/NCS firmware.

### 2. Improve Warning Message (Low effort)

In `src/extension.ts:938`, make the warning message SDK-aware:

**Current:**
```
"LogScope: No HCI packets captured. To export btsnoop, enable the Bluetooth LE monitor (bt_monitor) in your firmware and connect via J-Link RTT."
```

**Proposed:**
```
"LogScope: No HCI packets captured. To export btsnoop, enable CONFIG_BT_DEBUG_MONITOR_RTT=y in your Zephyr prj.conf and connect via J-Link RTT. Note: HCI tracing is not supported with the nRF5 SDK."
```

### 3. Parser-Aware UX Hints (Medium effort, nice-to-have)

When the user has selected the **nRF5 SDK parser**, LogScope could:
- Hide or gray out the "HCI" toggle in the filter bar
- Hide the "Wireshark (.btsnoop)" export option
- Show a tooltip explaining that HCI decoding requires Zephyr

This would prevent confusion before users even try to use the feature.

### 4. nRF5 SDK HCI Support (High effort, uncertain value)

Theoretically possible but impractical:
- The nRF5 SDK uses SoftDevice (closed-source BLE stack), so HCI interception would require custom firmware hooks
- Users would need to implement their own HCI logging shim in their application
- This is not a standard nRF5 SDK workflow and would be fragile across SDK versions
- **Recommendation:** Do not pursue this. Point users toward NCS/Zephyr migration instead.

## User's Setup for Reference

- **Board:** nRF52840 DK
- **Probe:** J-Link Plus
- **SDK:** nRF5 SDK 17.1.0
- **User notes:** Getting started docs are clear, RTT parser works, BLE traffic visibility was the gap

## Related Files

- `src/parser/hci-parser.ts` — BT Monitor protocol parser
- `src/parser/hci-opcodes.ts` — HCI command/event opcode tables
- `src/parser/hci-decoders.ts` — Packet field decoders
- `src/model/btsnoop-export.ts` — Wireshark btsnoop export
- `src/parser/nrf5-log.ts` — nRF5 SDK log parser
- `samples/nrf54l15-ble-hci-demo/prj.conf` — Reference Zephyr BLE config
- `samples/nrf52840-nrf5sdk-uart-demo/` — nRF5 SDK demo (no HCI)
