# Pre-built Demo Firmware

Ready-to-flash firmware binaries for testing LogScope. No build environment needed.

## Flash Commands

**nRF54L15 DK (BLE HCI demo):**
```bash
nrfutil device program --firmware samples/prebuilt/nrf54l15dk-ble-hci-demo.hex --verify --reset
```

**nRF54L15 DK (generic demo):**
```bash
nrfutil device program --firmware samples/prebuilt/nrf54l15dk-generic-demo.hex --verify --reset
```

**nRF52840 DK (generic demo):**
```bash
nrfutil device program --firmware samples/prebuilt/nrf52840dk-generic-demo.hex --verify --reset
```

**FRDM-MCXN947 (generic demo, via JLinkExe):**
```bash
JLinkExe -device MCXN947_M33_0 -if SWD -speed 4000 -autoconnect 1 -CommandFile /dev/stdin <<EOF
loadbin samples/prebuilt/frdm-mcxn947-generic-demo.bin,0x10000000
r
g
q
EOF
```

## Build Dates

All binaries built 2026-04-11 from current main branch.
- Nordic builds: NCS v3.2.0
- NXP build: Zephyr 3.7.1
