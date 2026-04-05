# LogScope Generic Zephyr Demo

Platform-independent demo firmware for showcasing LogScope features. Works on **any Zephyr-supported board** with a J-Link debug probe. No Nordic-specific dependencies, no Bluetooth LE required.

Use this demo to try LogScope on your own hardware, or as a starting point for adding LogScope-friendly logging to your project.

## Supported Boards

Any board with SEGGER RTT support. Tested examples:

| Board | Build Target | Buttons |
|-------|-------------|---------|
| nRF52840 DK | `nrf52840dk/nrf52840` | 4 buttons (sw0-sw3) |
| nRF54L15 DK | `nrf54l15dk/nrf54l15/cpuapp` | 4 buttons (sw0-sw3) |
| nRF5340 DK | `nrf5340dk/nrf5340/cpuapp` | 4 buttons (sw0-sw3) |
| STM32 Nucleo F446RE | `nucleo_f446re` | 1 button (sw0 = USER button) |
| STM32F4 Discovery | `stm32f4_disco` | 1 button (sw0 = USER button) |

Boards without buttons still work. The demo runs all periodic log events automatically; buttons just add interactive triggers.

## Quick Start

```bash
# Example: nRF52840 DK
west build -b nrf52840dk/nrf52840 samples/zephyr-generic-demo -p
west flash

# Example: nRF54L15 DK
west build -b nrf54l15dk/nrf54l15/cpuapp samples/zephyr-generic-demo -p
west flash

# Example: STM32 Nucleo
west build -b nucleo_f446re samples/zephyr-generic-demo -p
west flash
```

Then open LogScope in VS Code, connect via J-Link RTT, and select the Zephyr parser.

## What You'll See

### Startup Messages

```
[00:00:00.000,000] <inf> app: LogScope Generic Zephyr Demo starting
[00:00:00.000,000] <inf> app: Platform: nrf52840dk/nrf52840
[00:00:00.000,000] <inf> app: Buttons: 0=sensor anomaly, 1=flash corruption, 2=stress burst
[00:00:00.001,000] <inf> sensor_drv: Initializing temperature + humidity + accelerometer
[00:00:00.001,000] <dbg> sensor_drv: I2C bus scan: found 3 devices at 0x48, 0x40, 0x68
[00:00:00.001,000] <inf> sensor_drv: Sensor calibration loaded (factory defaults)
[00:00:00.002,000] <inf> flash_mgr: Flash subsystem ready (NOR, 1MB, sector size 4KB)
[00:00:00.002,000] <dbg> flash_mgr: Wear leveling table loaded: 256 sectors tracked
[00:00:00.003,000] <inf> crypto_mgr: Hardware crypto engine initialized (AES-128-CCM)
[00:00:00.003,000] <inf> app: Buttons initialized (4 buttons ready)
```

If no buttons are defined in your board's devicetree, you'll see:
```
[00:00:00.003,000] <inf> app: No buttons found in devicetree (demo runs without button triggers)
```

### Recurring Background Events

These run automatically on fixed intervals:

| Interval | Module | Severity | Example Output |
|----------|--------|----------|---------------|
| **Every 2s** | sensor_drv | DBG | `Temp: 22.00C, Humidity: 45.00%, Accel: (3, 7, 980) mg` |
| **Every 4s** | crypto_mgr | DBG | `AES-128-CCM encrypt: 64B payload, nonce=0x00004d10` |
| **Every 5s** | app | INF | `Heartbeat 5: uptime 5000 ms` |
| **Every 5s** | flash_mgr | DBG | `Write 256B to 0x00080500 (queue depth: 2)` |
| **~8-12s** | app | WRN | `Retransmission on handle 0x0040 (seq: 1, attempt: 1)` |
| **Every 15s** | flash_mgr | WRN | `Flash wear level high on sector 0x00080000 (writes: 8515)` |
| **Every 15s** | crypto_mgr | WRN | `Key rotation due: current key age 13 hours` |
| **Every 30s** | flash_mgr | ERR | `Flash write failed at 0x00080780 (timeout after 50ms)` |
| **Every 30s** | crypto_mgr | ERR | `MAC verification failed (expected: 0xDEADBEEF, got: 0xBADC0FFE)` |
| **Every 45s** | app | WRN/INF | `Battery: 3.1V (44% remaining)` |

The retransmission warning uses a pseudo-random interval, so it feels intermittent rather than clockwork.

### Button 0 (sw0): Sensor Anomaly Sequence

Simulates a temperature spike with thermal threshold breach and recovery:

```
[00:00:20.000] <inf> sensor_drv: Anomaly detected: temperature spike to 85.2C (threshold: 60.0C)
[00:00:20.001] <wrn> sensor_drv: Thermal threshold exceeded, initiating cooldown
[00:00:20.002] <err> sensor_drv: Sensor read timeout during thermal event (retry 1/3)
[00:00:20.003] <inf> sensor_drv: Temperature returning to normal: 24.8C
```

### Button 1 (sw1): Flash Corruption Sequence

Simulates a flash sector corruption with CRC failure, ECC error, and automatic recovery:

```
[00:00:25.000] <err> flash_mgr: CRC mismatch at sector 0x00080000 (expected: 0xA3F1, got: 0x0000)
[00:00:25.001] <wrn> flash_mgr: Wear level critical on sector 0x00080000 (writes: 99847)
[00:00:25.002] <err> flash_mgr: Flash write failed at 0x00080000 (ECC error)
[00:00:25.003] <inf> flash_mgr: Sector 0x00080000 marked bad, remapping to 0x000A0000
[00:00:25.004] <inf> flash_mgr: Flash recovery complete, 1 sector remapped
```

### Button 2 (sw2): Stress Burst

Fires 50 rapid-fire log messages (20ms apart) with realistic content:

```
[00:00:30.000] <wrn> app: Stress burst triggered via button (50 messages)
[00:00:30.020] <err> app: Retransmission timeout on channel 3 (attempt 2/3)
[00:00:30.040] <wrn> app: Sensor calibration drift detected: 0.3C
[00:00:30.060] <err> app: CRC mismatch during burst write at 0x00080000
... (47 more messages)
[00:00:31.000] <inf> app: Burst complete (50 messages sent)
```

### Button 3 (sw3): Reserved

```
[00:00:35.000] <inf> app: Button 3: no action assigned (reserved for future use)
```

## Suggested Watch Patterns

Add these to your VS Code settings to see watch patterns in action:

```json
"logscope.watchPatterns": [
  {
    "name": "Errors",
    "pattern": "failed|error|fault|CRC|timeout",
    "regex": true,
    "color": "#f44336"
  },
  {
    "name": "Retransmission",
    "pattern": "Retransmission",
    "color": "#ff9800"
  },
  {
    "name": "Heartbeat",
    "pattern": "Heartbeat",
    "color": "#4caf50"
  }
]
```

## Log Modules

| Module | Description | Severities |
|--------|-------------|------------|
| `app` | Main loop, heartbeat, retransmission, battery, burst | INF, WRN, ERR, DBG |
| `sensor_drv` | Temperature, humidity, accelerometer simulation | INF, WRN, ERR, DBG |
| `flash_mgr` | NOR flash operations, wear leveling, corruption | INF, WRN, ERR, DBG |
| `crypto_mgr` | AES-128-CCM encryption, key rotation, MAC verify | INF, WRN, ERR, DBG |

## Differences from the Bluetooth LE HCI Demo

This generic demo focuses on pure logging. For Bluetooth LE features (HCI packet decoding, GATT service, connection events), use `samples/nrf54l15-ble-hci-demo/` instead.

| Feature | Generic Demo | BLE HCI Demo |
|---------|-------------|-------------|
| RTT logging | Yes | Yes |
| Button triggers | Yes (standard GPIO) | Yes (Nordic DK library) |
| Bluetooth LE | No | Yes (advertising, GATT, HCI tracing) |
| HCI packet decoding | No | Yes (RTT Channel 1) |
| Board support | Any Zephyr board | nRF54L15 DK only |
| Nordic SDK required | No (upstream Zephyr) | Yes (NCS v3.2.0) |

## Requirements

- Zephyr RTOS (any recent version, tested with Zephyr 3.6+)
- J-Link debug probe (built-in on most Nordic DKs, external for other boards)
- `west` build tool
