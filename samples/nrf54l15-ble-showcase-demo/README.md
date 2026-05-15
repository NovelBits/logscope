# nRF54L15 Bluetooth LE Showcase Demo

A Zephyr firmware target for the Nordic nRF54L15 Development Kit that
exercises LogScope's Bluetooth LE decoders end-to-end. The firmware acts
as both an Observer (passive scanner) and a Peripheral (GATT server). When
the GATT server is connected to and discovered, LogScope's RTT monitor
shows every ATT operation with named services, characteristics, and
descriptors instead of raw hex.

## Services exposed

- **Battery Service (0x180F)** — Battery Level characteristic; notifies every 10 seconds, looping 100 down to 0.
- **Heart Rate Service (0x180D)** — Heart Rate Measurement characteristic; notifies every 2 seconds, oscillating 60-100 BPM.
- **Device Information Service (0x180A)** — Manufacturer Name (`Novel Bits`), Model Number (`nRF54L15 LogScope Demo`).

## Build

```bash
cd samples/nrf54l15-ble-showcase-demo
west build -b nrf54l15dk/nrf54l15/cpuapp -p
```

Requires Nordic Connect SDK (NCS) v3.2.0 environment.

## Flash

```bash
west flash --runner jlink
```

## Smoke test for LogScope ATT decode

1. Flash this firmware to an nRF54L15DK.
2. In VS Code with LogScope installed, open a workspace. Connect LogScope
   to the flashed board's J-Link probe via RTT.
3. From a phone, open the nRF Connect mobile app. Scan, find
   "logscope-demo", connect.
4. Tap "Discover services". The phone issues a full GATT discovery walk.
5. In LogScope's HCI panel, verify each ATT operation decodes with named
   (not raw-hex) UUIDs:
   - **Read By Group Type Response** → "Battery" / "Heart Rate" / "Device Information"
   - **Read By Type Response** (for Characteristic Declarations) → "Battery Level" / "Heart Rate Measurement" / "Manufacturer Name String" / "Model Number String"
   - **Find Information Response** → "Client Characteristic Configuration" for the CCCDs
6. Tap "Enable notifications" on Battery Level. The Write Request to the
   CCCD shows the descriptor named, with value `0x0001` (notifications enabled).
7. Watch Battery Level notifications arrive every 10 seconds, each decoded
   with the characteristic name and current value.

## What this demonstrates

- Service discovery decode (Read By Group Type, Read By Type)
- Descriptor discovery decode (Find Information)
- Notification decode (Handle Value Notification)
- UUID name resolution against the SIG-pinned tables in `@novelbits/ble-spec`
