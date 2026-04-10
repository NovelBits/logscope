---
title: Supported Boards
description: Development boards tested with LogScope's demo firmware
---

LogScope works with any board that supports SEGGER RTT (J-Link) or Serial UART. The demo firmware has been tested on the following boards. For build instructions, see the [generic Zephyr demo](/logscope/demo/generic-zephyr/) or the [BLE HCI demo](/logscope/demo/ble-hci-demo/).

## Tested Boards

| Board | Vendor | Zephyr Target | Buttons | J-Link | Price |
|-------|--------|---------------|---------|--------|-------|
| nRF52840 DK | Nordic | `nrf52840dk/nrf52840` | 4 | Built-in | ~$49 |
| nRF54L15 DK | Nordic | `nrf54l15dk/nrf54l15/cpuapp` | 4 | Built-in | ~$49 |
| nRF5340 DK | Nordic | `nrf5340dk/nrf5340/cpuapp` | 4 | Built-in | ~$49 |
| xG24 Explorer Kit | Silicon Labs | `xg24_ek2703a` | 2 | Reflash required | ~$40 |
| NUCLEO-H753ZI | STMicro | `nucleo_h753zi` | 1 | Reflash required | ~$28 |
| NUCLEO-F401RE | STMicro | `nucleo_f401re` | 1 | Reflash required | ~$14 |
| FRDM-MCXN947 | NXP | `frdm_mcxn947/mcxn947/cpu0` | 2 | Reflash required | ~$26 |

## J-Link Setup by Vendor

### Nordic DKs

No setup needed. All Nordic DKs have a built-in J-Link debug probe. RTT works immediately.

### STMicro Nucleo Boards

Nucleo boards ship with ST-Link, which needs to be reflashed to J-Link firmware:

1. Download the free [STLinkReflash utility](https://www.segger.com/products/debug-probes/j-link/models/other-j-links/st-link-on-board/) from SEGGER
2. Run the utility and select "Upgrade to J-Link"
3. Done. The conversion is reversible if you need ST-Link back.

### Silicon Labs xG24

The xG24 debug probe needs J-Link firmware:

1. Open Simplicity Studio
2. Go to the debug probe configuration
3. Flash the J-Link firmware

### NXP FRDM Boards

FRDM boards ship with MCU-Link/OpenSDA:

1. Download the J-Link firmware for your board from [SEGGER's OpenSDA page](https://www.segger.com/products/debug-probes/j-link/models/other-j-links/opensda-sda-v2/)
2. Put the board in bootloader mode (hold reset while plugging in USB)
3. Drag and drop the firmware file to the bootloader drive

## Using an External J-Link Probe

If your board doesn't have a built-in J-Link (or the built-in probe can't be reflashed), you can use an external J-Link probe connected to the board's SWD/JTAG header. You may need to configure [`logscope.jlink.device`](/logscope/reference/settings/) to match your target chip.

Any [SEGGER J-Link](https://www.segger.com/products/debug-probes/j-link/) model works. The J-Link EDU Mini (~$20) is the most affordable option for hobbyists.

## Building the Demo

For boards with built-in J-Link (or after reflashing):

```bash
west build -b <target> samples/zephyr-generic-demo -p
west flash
```

Replace `<target>` with the Zephyr board target from the table above.
