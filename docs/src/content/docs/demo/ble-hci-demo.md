---
title: BLE HCI Demo (nRF54L15)
description: Interactive demo firmware showcasing LogScope with Bluetooth LE and button-driven scenarios
---

The BLE HCI demo is a showcase firmware for the nRF54L15 DK that demonstrates LogScope's features through physical button interactions and real Bluetooth LE connections.

## Quick Start

```bash
# Flash prebuilt hex
nrfutil device program --firmware samples/nrf54l15-ble-hci-demo/build/merged.hex --serial-number <SN>
nrfutil device reset --serial-number <SN>
```

Or build from source:

```bash
source samples/nrf54l15-ble-hci-demo/setup-env.sh
west build -b nrf54l15dk/nrf54l15/cpuapp samples/nrf54l15-ble-hci-demo --build-dir build-hci -p
west flash --build-dir build-hci
```

Then open LogScope, [connect via J-Link RTT](/logscope/getting-started/connecting/) with the Zephyr parser.

## Buttons

| Button | Idle State | Connected State |
|--------|-----------|-----------------|
| **Button 0** | Toggle advertising on/off | Force disconnect |
| **Button 1** | Sensor anomaly sequence (4 messages) | Anomaly + 10 notification burst |
| **Button 2** | Flash corruption sequence (5 messages) | Same |
| **Button 3** | Stress burst (50 rapid-fire messages) | Same |

### Button 0: BLE State Control

**When advertising:** Stops advertising.
```
ble_mgr: Advertising stopped by user
```

**When stopped:** Restarts advertising.
```
ble_mgr: Advertising restarted by user
```

**When connected:** Forces a disconnect.
```
ble_mgr: User-initiated disconnect
app: Disconnected: XX:XX:XX:XX:XX:XX (reason 0x16 Remote User Terminated Connection)
app: Re-advertising started
```

### Button 1: Sensor Anomaly

Simulates a temperature spike:

```
sensor_drv: Anomaly detected: temperature spike to 85.2C (threshold: 60.0C)
sensor_drv: Thermal threshold exceeded, initiating cooldown
sensor_drv: Sensor read timeout during thermal event (retry 1/3)
sensor_drv: Temperature returning to normal: 24.8C
```

When a BLE device is connected, also sends 10 rapid BLE notifications.

### Button 2: Flash Corruption

Simulates storage corruption with recovery:

```
flash_mgr: CRC mismatch at sector 0x00080000 (expected: 0xA3F1, got: 0x0000)
flash_mgr: Wear level critical on sector 0x00080000 (writes: 99847)
flash_mgr: Flash write failed at 0x00080000 (ECC error)
flash_mgr: Sector 0x00080000 marked bad, remapping to 0x000A0000
flash_mgr: Flash recovery complete, 1 sector remapped
```

### Button 3: Stress Burst

Fires 50 rapid messages (20ms apart) with realistic content cycling through errors, warnings, and info messages. Great for testing LogScope's parsing performance and [filtering](/logscope/features/filtering/).

## Recurring Events

| Interval | Module | Level | Message |
|----------|--------|-------|---------|
| Every 2s | sensor_drv | DBG | Temperature, humidity, accelerometer readings |
| Every 4s | crypto_mgr | DBG | AES-128-CCM encryption operations |
| Every 5s | app | INF | Heartbeat with uptime |
| Every 5s | flash_mgr | DBG | Flash write operations |
| ~8-12s | app | WRN | Retransmission warnings (pseudo-random interval) |
| Every 15s | flash_mgr | WRN | Flash wear level warnings |
| Every 15s | crypto_mgr | WRN | Key rotation warnings |
| Every 30s | flash_mgr | ERR | Flash write failures |
| Every 30s | crypto_mgr | ERR | MAC verification failures |
| Every 45s | app | WRN/INF | Battery level checks |

## Bluetooth LE Connection

The firmware advertises as **"LogScope Demo"**. Connect with the nRF Connect mobile app to see:

- Real [HCI packets](/logscope/features/hci-decoding/) (Connection Complete, Parameter Updates, GATT operations)
- Application-level connection/disconnection logs
- Sensor data notifications (every 2s when subscribed)

### GATT Service

| Characteristic | UUID Suffix | Type | Description |
|---------------|-------------|------|-------------|
| Info | `...def1` | Read | Returns device info string |
| Command | `...def2` | Write | `0x01`=burst, `0x02`=reset sensor, `0x03`=flash erase, `0x04`=fault sim, `0x05`=real fault |
| Sensor Data | `...def3` | Notify | 4-byte sensor value, every 2s when subscribed |

## Suggested Watch Patterns

Set these up in LogScope to see [watch patterns](/logscope/features/watch-patterns/) in action:

```json
"logscope.watchPatterns": [
  { "name": "BLE State", "pattern": "Connected|Disconnected|Advertising", "regex": true, "color": "#4caf50" },
  { "name": "Errors", "pattern": "failed|error|fault|CRC|timeout", "regex": true, "color": "#f44336" },
  { "name": "Retransmission", "pattern": "Retransmission", "color": "#ff9800" }
]
```

Or add them one at a time using the [`LogScope: Add Watch Pattern`](/logscope/reference/commands/) command in the Command Palette (`Cmd+Shift+P`).

## Requirements

- nRF54L15 DK (PCA10156)
- nRF Connect SDK v3.2.0
- Optional: phone with nRF Connect app
