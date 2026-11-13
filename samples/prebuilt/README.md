# Pre-built Demo Firmware

Ready-to-flash firmware binaries for testing LogScope. No build environment needed.

## Flash Commands

`<SN>` is the J-Link serial number (`nrfutil device list`). nrfutil-device 2.17.5 has no `--verify` or `--reset` flags: verify is a program option, and the board is reset with a separate command.

**nRF54L15 DK (BLE HCI demo):**
```bash
nrfutil device program --firmware samples/prebuilt/nrf54l15dk-ble-hci-demo.hex --options verify=VERIFY_READ --serial-number <SN>
nrfutil device reset --serial-number <SN>
```

**nRF54L15 DK (generic demo):**
```bash
nrfutil device program --firmware samples/prebuilt/nrf54l15dk-generic-demo.hex --options verify=VERIFY_READ --serial-number <SN>
nrfutil device reset --serial-number <SN>
```

**nRF52840 DK (generic demo):**
```bash
nrfutil device program --firmware samples/prebuilt/nrf52840dk-generic-demo.hex --options verify=VERIFY_READ --serial-number <SN>
nrfutil device reset --serial-number <SN>
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
