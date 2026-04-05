# LogScope Bluetooth LE HCI Demo (nRF54L15 DK)

Interactive showcase firmware for demonstrating LogScope's features: real-time log viewing, severity filtering, module filtering, watch patterns, HCI packet decoding, and more.

## Quick Start

```bash
# Set up NCS environment
source samples/nrf54l15-ble-hci-demo/setup-env.sh

# Build
west build -b nrf54l15dk/nrf54l15/cpuapp samples/nrf54l15-ble-hci-demo --build-dir build-hci -p

# Flash
west flash --build-dir build-hci

# Or flash a prebuilt hex
nrfutil device program --firmware samples/nrf54l15-ble-hci-demo/build/merged.hex --serial-number <SN>
nrfutil device reset --serial-number <SN>
```

Then open LogScope in VS Code, connect via J-Link RTT, and select the Zephyr parser.

## What You'll See

### Startup Messages (first 2 seconds)

```
[00:00:00.000,000] <inf> app: LogScope Bluetooth LE HCI Demo starting (showcase)
[00:00:00.000,000] <inf> app: HCI traces streaming to RTT Channel 1
[00:00:00.000,000] <inf> app: Buttons: 0=BLE control, 1=sensor anomaly, 2=flash corruption, 3=stress burst
[00:00:00.001,000] <inf> sensor_drv: Initializing temperature + humidity + accelerometer
[00:00:00.001,000] <dbg> sensor_drv: I2C bus scan: found 3 devices at 0x48, 0x40, 0x68
[00:00:00.001,000] <inf> sensor_drv: Sensor calibration loaded (factory defaults)
[00:00:00.002,000] <inf> flash_mgr: Flash subsystem ready (NOR, 1MB, sector size 4KB)
[00:00:00.002,000] <dbg> flash_mgr: Wear leveling table loaded: 256 sectors tracked
[00:00:00.003,000] <inf> crypto_mgr: Hardware crypto engine initialized (AES-128-CCM)
[00:00:00.003,000] <inf> app: DK buttons initialized (4 buttons ready)
[00:00:00.050,000] <inf> app: Bluetooth initialized
[00:00:00.060,000] <inf> app: Advertising as "LogScope Demo"
[00:00:00.060,000] <inf> ble_mgr: GATT service registered: read + write + notify characteristics
```

### Recurring Background Events

These run automatically on fixed intervals:

| Interval | Module | Severity | Example Output |
|----------|--------|----------|---------------|
| **Every 2s** | sensor_drv | DBG | `Temp: 22.00C, Humidity: 45.00%, Accel: (3, 7, 980) mg` |
| **Every 4s** | crypto_mgr | DBG | `AES-128-CCM encrypt: 64B payload, nonce=0x00004d10` |
| **Every 5s** | app | INF | `Heartbeat 5: advertising, uptime 5000 ms` |
| **Every 5s** | flash_mgr | DBG | `Write 256B to 0x00080500 (queue depth: 2)` |
| **~8-12s** | app | WRN | `Retransmission on handle 0x0040 (seq: 1, attempt: 1)` |
| **Every 15s** | flash_mgr | WRN | `Flash wear level high on sector 0x00080000 (writes: 8515)` |
| **Every 15s** | crypto_mgr | WRN | `Key rotation due: current key age 13 hours` |
| **Every 20s** | ble_mgr | INF | `Advertising data updated (TX power: -3 dBm)` |
| **Every 30s** | flash_mgr | ERR | `Flash write failed at 0x00080780 (timeout after 50ms)` |
| **Every 30s** | crypto_mgr | ERR | `MAC verification failed (expected: 0xDEADBEEF, got: 0xBADC0FFE)` |
| **Every 45s** | app | WRN/INF | `Battery: 3.1V (44% remaining)` |

The retransmission warning uses a pseudo-random interval (not a fixed timer), so it feels intermittent rather than clockwork. This makes it a great target for watch patterns because you can't predict when it will appear by scrolling.

### Button 0: BLE State Control

**When not connected (advertising or idle):** Toggles advertising on/off.

Press once:
```
[00:00:12.000] <inf> ble_mgr: Advertising stopped by user
```

Press again:
```
[00:00:15.000] <inf> ble_mgr: Advertising restarted by user
```

**When a BLE device is connected:** Forces a disconnect.

```
[00:01:30.000] <inf> ble_mgr: User-initiated disconnect
[00:01:30.010] <inf> app: Disconnected: XX:XX:XX:XX:XX:XX (reason 0x16 Remote User Terminated Connection)
[00:01:30.020] <inf> app: Re-advertising started
```

### Button 1: Sensor Anomaly Sequence

Simulates a temperature spike with thermal threshold breach and recovery. All messages appear within ~1 second:

```
[00:00:20.000] <inf> sensor_drv: Anomaly detected: temperature spike to 85.2C (threshold: 60.0C)
[00:00:20.001] <wrn> sensor_drv: Thermal threshold exceeded, initiating cooldown
[00:00:20.002] <err> sensor_drv: Sensor read timeout during thermal event (retry 1/3)
[00:00:20.003] <inf> sensor_drv: Temperature returning to normal: 24.8C
```

**When a BLE device is connected**, also sends a burst of 10 rapid notifications:

```
[00:00:20.000] <inf> sensor_drv: Anomaly detected: temperature spike to 85.2C (threshold: 60.0C)
[00:00:20.001] <dbg> sensor_drv: Notify: temp=85.2C humidity=12% (anomaly burst 1/10)
[00:00:20.001] <dbg> sensor_drv: Notify: temp=85.2C humidity=12% (anomaly burst 2/10)
...
[00:00:20.005] <dbg> sensor_drv: Notify: temp=85.2C humidity=12% (anomaly burst 10/10)
[00:00:20.006] <wrn> sensor_drv: Thermal threshold exceeded, initiating cooldown
[00:00:20.007] <err> sensor_drv: Sensor read timeout during thermal event (retry 1/3)
[00:00:20.008] <inf> sensor_drv: Temperature returning to normal: 24.8C
[00:00:20.009] <inf> sensor_drv: Anomaly burst complete, resuming normal interval
```

### Button 2: Flash Corruption Sequence

Simulates a flash sector corruption with CRC failure, wear level critical, ECC error, and automatic recovery:

```
[00:00:25.000] <err> flash_mgr: CRC mismatch at sector 0x00080000 (expected: 0xA3F1, got: 0x0000)
[00:00:25.001] <wrn> flash_mgr: Wear level critical on sector 0x00080000 (writes: 99847)
[00:00:25.002] <err> flash_mgr: Flash write failed at 0x00080000 (ECC error)
[00:00:25.003] <inf> flash_mgr: Sector 0x00080000 marked bad, remapping to 0x000A0000
[00:00:25.004] <inf> flash_mgr: Flash recovery complete, 1 sector remapped
```

### Button 3: Stress Burst

Fires 50 rapid-fire log messages (20ms apart) cycling through all modules and severities with realistic content:

```
[00:00:30.000] <wrn> app: Stress burst triggered via Button 3 (50 messages)
[00:00:30.020] <err> app: Retransmission timeout on channel 3 (attempt 2/3)
[00:00:30.040] <wrn> app: Sensor calibration drift detected: 0.3C
[00:00:30.060] <err> app: CRC mismatch during burst write at 0x00080000
[00:00:30.080] <wrn> app: Key derivation took 45ms (threshold: 20ms)
[00:00:30.100] <inf> app: Connection event missed, scheduling recovery
[00:00:30.120] <err> app: Flash write failed at 0x00090000 (timeout after 50ms)
[00:00:30.140] <wrn> app: RSSI dropped to -89 dBm (threshold: -80 dBm)
[00:00:30.160] <inf> app: Notification queued (pending: 8)
[00:00:30.180] <err> app: MAC verification failed (expected: 0xDEADBEEF, got: 0xBADC0FFE)
[00:00:30.200] <dbg> app: AES-128-CCM encrypt: 64B payload, nonce=0x000016e8
... (40 more messages cycling through the same 10 patterns)
[00:00:31.000] <inf> app: Burst complete (50 messages sent)
```

### Real Bluetooth LE Connection Events

Connect to the DK using the **nRF Connect** mobile app (search for "LogScope Demo"). You'll see both application-level logs and real HCI packets:

**Phone connects:**
```
[00:01:00.000] <inf> app: Connected: XX:XX:XX:XX:XX:XX
```
Plus HCI packets (expandable in LogScope): LE Connection Complete, LE Read Remote Features, etc.

**Connection parameter update:**
```
[00:01:00.500] <inf> app: Connection params updated: interval 30 (37.50 ms), latency 0, timeout 400
```

**Enable notifications (tap the up-arrow on the Sensor Data characteristic in nRF Connect):**
```
[00:01:05.000] <inf> ble_mgr: Sensor notifications enabled
[00:01:06.000] <dbg> ble_mgr: Sensor notification sent: value=1234
[00:01:08.000] <dbg> ble_mgr: Sensor notification sent: value=1268
... (every 2 seconds while subscribed)
```

**Phone disconnects:**
```
[00:02:00.000] <inf> app: Disconnected: XX:XX:XX:XX:XX:XX (reason 0x13 Remote User Terminated Connection)
[00:02:00.010] <inf> app: Re-advertising started
```

### GATT Commands (via nRF Connect app)

Write to the Command characteristic (UUID `...def2`) to trigger remote actions:

| Write Value | Action |
|-------------|--------|
| `0x01` | Trigger burst mode (same as Button 3) |
| `0x02` | Reset sensor counter |
| `0x03` | Manual flash erase |
| `0x04` | Simulate hard fault log dump |
| `0x05` | Trigger real hard fault (device will crash and reset) |

## Suggested Watch Patterns

Add these to your VS Code settings to see watch patterns in action:

```json
"logscope.watchPatterns": [
  {
    "name": "BLE State",
    "pattern": "Connected|Disconnected|Advertising",
    "regex": true,
    "color": "#4caf50"
  },
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
  }
]
```

With these patterns active:
- **Green dots** appear on connection, disconnection, and advertising events
- **Red dots** appear on all error conditions (flash failures, CRC mismatches, MAC failures, timeouts)
- **Orange dots** appear on retransmission warnings (the intermittent ones you'd otherwise miss)
- **Sidebar counters** show live hit counts for each pattern
- **Click a counter** to scroll to the last matching log line

## Log Modules

| Module | Description | Severities Used |
|--------|-------------|-----------------|
| `app` | Main loop, heartbeat, retransmission, battery, burst mode | INF, WRN, ERR, DBG |
| `sensor_drv` | Temperature, humidity, accelerometer readings | INF, WRN, ERR, DBG |
| `flash_mgr` | NOR flash operations, wear leveling, corruption | INF, WRN, ERR, DBG |
| `crypto_mgr` | AES-128-CCM encryption, key rotation, MAC verification | INF, WRN, ERR, DBG |
| `ble_mgr` | GATT service, notifications, connection management | INF, WRN, ERR, DBG |

## Hardware Requirements

- nRF54L15 DK (PCA10156)
- J-Link debug probe (built into the DK)
- nRF Connect SDK v3.2.0
- Optional: phone with nRF Connect app for Bluetooth LE testing
