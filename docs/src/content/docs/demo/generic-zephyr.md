---
title: Generic Zephyr Demo
description: Platform-independent demo firmware for any Zephyr-supported board
---

The generic Zephyr demo works on **any board** with a J-Link debug probe. No Nordic-specific dependencies, no Bluetooth LE required. Use it to try LogScope on your own hardware. See [supported boards](/demo/supported-boards/) for tested targets and J-Link setup instructions.

## Quick Start

```bash
# nRF52840 DK
west build -b nrf52840dk/nrf52840 samples/zephyr-generic-demo -p
west flash

# nRF54L15 DK
west build -b nrf54l15dk/nrf54l15/cpuapp samples/zephyr-generic-demo -p
west flash

# STM32 Nucleo
west build -b nucleo_f401re samples/zephyr-generic-demo -p
west flash
```

## Buttons

Uses standard Zephyr GPIO with `sw0`-`sw3` devicetree aliases. Boards without buttons still run all periodic events automatically.

| Button | Action |
|--------|--------|
| **sw0** | Sensor anomaly sequence |
| **sw1** | Flash corruption sequence |
| **sw2** | Stress burst (50 messages) |
| **sw3** | Reserved |

## Recurring Events

Same timing as the [BLE HCI demo](/demo/ble-hci-demo/) (heartbeat every 5s, sensor reads every 2s, retransmission warnings every ~8-12s, etc.) but without Bluetooth LE events.

## Differences from BLE HCI Demo

| Feature | Generic Demo | BLE HCI Demo |
|---------|-------------|-------------|
| RTT logging | Yes | Yes |
| Button triggers | Yes (standard GPIO) | Yes (Nordic DK library) |
| Bluetooth LE | No | Yes |
| HCI packet decoding | No | Yes |
| Board support | Any Zephyr board | nRF54L15 DK only |
| Nordic SDK required | No | Yes (NCS v3.2.0) |

## Suggested Watch Patterns

Configure these [watch patterns](/features/watch-patterns/) to highlight key events:

```json
"logscope.watchPatterns": [
  { "name": "Errors", "pattern": "failed|error|fault|CRC|timeout", "regex": true, "color": "#f44336" },
  { "name": "Retransmission", "pattern": "Retransmission", "color": "#ff9800" },
  { "name": "Heartbeat", "pattern": "Heartbeat", "color": "#4caf50" }
]
```
