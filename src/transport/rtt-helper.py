#!/usr/bin/env python3
"""
RTT reader helper — runs as a long-lived subprocess, reads RTT data via
SEGGER J-Link RTT and writes raw bytes to stdout.

Preferred: pylink (native J-Link RTT, zero packet loss, any J-Link device)
Fallback: nrfutil CLI (nRF devices only, slower, some packet loss)

Usage: python3 rtt-helper.py <device_name_or_rtt_address> [poll_interval_ms] [nrfutil_path]
"""
import struct
import time
import sys
import os


def run_pylink(device_or_addr, poll_ms):
    """Fast path: native J-Link RTT via pylink. Works with any J-Link device."""
    import pylink

    jlink = pylink.JLink()
    jlink.open()

    # If it looks like a hex address, it's the nrfutil fallback format.
    # For pylink, we need a device name. Default to Cortex-M33 if address given.
    if device_or_addr.startswith("0x"):
        device = "Cortex-M33"
    else:
        device = device_or_addr

    jlink.connect(device)
    print(f"J-Link connected to {device}, CPU halted: {jlink.halted()}", file=sys.stderr)

    # If CPU is halted (shouldn't be with connect), resume it
    if jlink.halted():
        jlink.restart()
        print("Resumed CPU", file=sys.stderr)

    # Start RTT — J-Link handles control block detection automatically
    jlink.rtt_start()
    print("RTT started, waiting for control block...", file=sys.stderr)
    sys.stderr.flush()

    # Wait for RTT to find the control block (up to 5 seconds)
    for _ in range(50):
        try:
            num_up = jlink.rtt_get_num_up_buffers()
            if num_up > 0:
                break
        except Exception:
            pass
        time.sleep(0.1)
    else:
        print("ERROR: Could not connect to device. Make sure firmware with RTT logging is flashed and the device is powered on.", file=sys.stderr)
        jlink.rtt_stop()
        jlink.close()
        sys.exit(2)

    num_up = jlink.rtt_get_num_up_buffers()
    has_hci = num_up >= 2
    print(f"RTT_READY buffers={num_up} hci={'yes' if has_hci else 'no'}", file=sys.stderr)
    sys.stderr.flush()

    stdout = os.fdopen(sys.stdout.fileno(), "wb", 0)
    poll_interval = poll_ms / 1000.0
    consecutive_errors = 0
    last_data_time = time.monotonic()
    SILENCE_THRESHOLD = 3.0  # seconds of no data before RTT restart
    reconnect_stage = 0  # 0=normal, 1=tried RTT restart, 2=tried full reconnect

    def write_frame(channel, data):
        """Write framed data: [channel:1][length:4 LE][data:N]"""
        stdout.write(bytes([channel]) + struct.pack('<I', len(data)) + data)

    def restart_rtt():
        """Lightweight RTT restart — stop and re-start RTT without closing J-Link."""
        nonlocal has_hci
        print("Restarting RTT session...", file=sys.stderr)
        sys.stderr.flush()
        try:
            jlink.rtt_stop()
        except Exception:
            pass
        time.sleep(0.3)
        jlink.rtt_start()
        for _ in range(50):
            try:
                num_up = jlink.rtt_get_num_up_buffers()
                if num_up > 0:
                    has_hci = num_up >= 2
                    print(f"RTT restarted OK, buffers={num_up}", file=sys.stderr)
                    sys.stderr.flush()
                    return True
            except Exception:
                pass
            time.sleep(0.1)
        print("RTT restart failed — control block not found", file=sys.stderr)
        sys.stderr.flush()
        return False

    def full_reconnect():
        """Full J-Link + RTT reconnect after board reset."""
        nonlocal has_hci
        print("Full J-Link reconnect...", file=sys.stderr)
        sys.stderr.flush()
        try:
            jlink.rtt_stop()
        except Exception:
            pass
        try:
            jlink.close()
        except Exception:
            pass
        time.sleep(0.5)
        try:
            jlink.open()
            jlink.connect(device)
            if jlink.halted():
                jlink.restart()
            jlink.rtt_start()
        except Exception as e:
            print(f"Reconnect failed: {e}", file=sys.stderr)
            sys.stderr.flush()
            return False
        for _ in range(50):
            try:
                num_up = jlink.rtt_get_num_up_buffers()
                if num_up > 0:
                    has_hci = num_up >= 2
                    print(f"Reconnected OK, buffers={num_up}", file=sys.stderr)
                    sys.stderr.flush()
                    return True
            except Exception:
                pass
            time.sleep(0.1)
        print("Full reconnect failed — control block not found", file=sys.stderr)
        sys.stderr.flush()
        return False

    while True:
        try:
            got_data = False

            # Channel 0: log text
            data = jlink.rtt_read(0, 4096)
            if data:
                write_frame(0, bytes(data))
                got_data = True

            # Channel 1: HCI binary (BT Monitor)
            if has_hci:
                hci_data = jlink.rtt_read(1, 4096)
                if hci_data:
                    write_frame(1, bytes(hci_data))
                    got_data = True

            if got_data:
                last_data_time = time.monotonic()
                consecutive_errors = 0
                reconnect_stage = 0
            else:
                silence = time.monotonic() - last_data_time
                if silence > SILENCE_THRESHOLD and reconnect_stage == 0:
                    # Stage 1: try lightweight RTT restart
                    restart_rtt()
                    last_data_time = time.monotonic()
                    reconnect_stage = 1
                elif silence > SILENCE_THRESHOLD and reconnect_stage == 1:
                    # Stage 2: RTT restart didn't help, try full reconnect
                    full_reconnect()
                    last_data_time = time.monotonic()
                    reconnect_stage = 2
                elif silence > SILENCE_THRESHOLD and reconnect_stage == 2:
                    # Stage 3: full reconnect didn't help either, keep retrying
                    full_reconnect()
                    last_data_time = time.monotonic()

        except BrokenPipeError:
            break
        except Exception as e:
            consecutive_errors += 1
            print(f"RTT read error #{consecutive_errors}: {e}", file=sys.stderr)
            sys.stderr.flush()
            if consecutive_errors >= 5:
                full_reconnect()
                consecutive_errors = 0
                last_data_time = time.monotonic()
                reconnect_stage = 0
            continue

        time.sleep(poll_interval)

    jlink.rtt_stop()
    jlink.close()


def run_nrfutil(rtt_addr, poll_ms, nrfutil_path):
    """Slow fallback: spawns nrfutil CLI per read. nRF devices only."""
    import subprocess

    MAX_CHUNK = 1024

    def swd_read(addr, nbytes):
        aligned = (nbytes + 3) & ~3
        if aligned == 0:
            return b""
        data = bytearray()
        offset = 0
        while offset < aligned:
            chunk = min(MAX_CHUNK, aligned - offset)
            result = subprocess.run(
                [nrfutil_path, "device", "read", "--address", hex(addr + offset),
                 "--bytes", str(chunk), "--direct"],
                capture_output=True, text=True
            )
            for line in result.stdout.splitlines():
                if line.startswith("0x"):
                    parts = line.split("|")[0].split()
                    for word_hex in parts[1:]:
                        try:
                            word = int(word_hex, 16)
                            data.extend(struct.pack("<I", word))
                        except ValueError:
                            break
            offset += chunk
        return bytes(data[:nbytes])

    def swd_write32(addr, value):
        subprocess.run(
            [nrfutil_path, "device", "write", "--address", hex(addr),
             "--value", hex(value), "--direct"],
            capture_output=True, text=True
        )

    rtt_addr_int = int(rtt_addr, 16) if isinstance(rtt_addr, str) else rtt_addr

    # Read control block
    header = swd_read(rtt_addr_int, 24)
    magic = header[:10].decode("ascii", errors="replace")
    if magic != "SEGGER RTT":
        print(f"ERROR: RTT magic mismatch: '{magic}'", file=sys.stderr)
        sys.exit(2)

    desc = swd_read(rtt_addr_int + 24, 24)
    pbuffer = struct.unpack_from("<I", desc, 4)[0]
    buf_size = struct.unpack_from("<I", desc, 8)[0]
    wr_off_addr = rtt_addr_int + 24 + 12
    rd_off_addr = rtt_addr_int + 24 + 16

    print(f"RTT_READY pbuffer=0x{pbuffer:08x} size={buf_size}", file=sys.stderr)
    sys.stderr.flush()

    stdout = os.fdopen(sys.stdout.fileno(), "wb", 0)
    poll_interval = poll_ms / 1000.0
    errors = 0

    while True:
        try:
            offsets = swd_read(wr_off_addr, 8)
            if len(offsets) < 8:
                time.sleep(poll_interval)
                continue
            wr_off = struct.unpack_from("<I", offsets, 0)[0]
            rd_off = struct.unpack_from("<I", offsets, 4)[0]

            if wr_off == rd_off:
                time.sleep(poll_interval)
                continue

            if wr_off > rd_off:
                data = swd_read(pbuffer + rd_off, wr_off - rd_off)
            else:
                data = swd_read(pbuffer + rd_off, buf_size - rd_off)
                if wr_off > 0:
                    data += swd_read(pbuffer, wr_off)

            if data:
                stdout.write(data)
                swd_write32(rd_off_addr, wr_off)
                errors = 0

        except BrokenPipeError:
            break
        except Exception as e:
            errors += 1
            print(f"Poll error #{errors}: {e}", file=sys.stderr)
            if errors > 20:
                print("Too many errors, exiting", file=sys.stderr)
                break
            time.sleep(poll_interval * 2)
            continue

        time.sleep(poll_interval)


def detect_device(nrfutil_path):
    """Try to auto-detect the connected device via nrfutil."""
    import subprocess
    try:
        result = subprocess.run(
            [nrfutil_path, "device", "device-info"],
            capture_output=True, text=True, timeout=5
        )
        for line in result.stdout.splitlines():
            line = line.strip()
            if line.startswith("deviceVersion:"):
                # e.g. "deviceVersion: NRF54L15_xxAA_REV2" → "NRF54L15_M33"
                dev = line.split(":")[1].strip()
                # Map to J-Link device name
                base = dev.split("_xx")[0]  # "NRF54L15"
                # Map to friendly name (nRF not NRF)
                friendly = base.replace("NRF", "nRF")  # "NRF54L15" → "nRF54L15"
                # Common core suffixes for J-Link device name
                m33_devices = ["NRF54L15", "NRF54H20", "NRF5340", "NRF9160", "NRF9161"]
                m4_devices = ["NRF52840", "NRF52833", "NRF52832", "NRF52820", "NRF52810"]
                if base in m33_devices:
                    return f"{base}_M33", friendly
                elif base in m4_devices:
                    return f"{base}_XXAA", friendly
                else:
                    return f"{base}_M33", friendly
    except Exception:
        pass
    return None, None


def run_discover():
    """Discover connected J-Link probes and output JSON to stdout."""
    import json
    try:
        import pylink
    except ImportError:
        print(json.dumps({"error": "pylink not installed", "devices": []}))
        return

    # First, try nrfutil to get the actual target chip name
    nrfutil_path = sys.argv[2] if len(sys.argv) > 2 else "nrfutil"
    target_jlink, target_friendly = detect_device(nrfutil_path)

    jlink = pylink.JLink()
    emulators = jlink.connected_emulators()
    devices = []
    for emu in emulators:
        serial = emu.SerialNumber
        info = {"serial": serial}

        if target_friendly:
            # nrfutil identified the target chip (e.g., "nRF54L15")
            info["targetName"] = target_friendly
            info["device"] = target_jlink
        else:
            # Fall back to generic core detection via pylink
            try:
                jlink.open(serial_no=serial)
                for core in ["Cortex-M33", "Cortex-M4", "Cortex-M7", "Cortex-M0+"]:
                    try:
                        jlink.connect(core)
                        info["targetName"] = jlink.core_name()
                        info["device"] = core
                        break
                    except Exception:
                        continue
                jlink.close()
            except Exception:
                info["targetName"] = "Unknown device"
                try:
                    jlink.close()
                except Exception:
                    pass
        devices.append(info)
    print(json.dumps({"devices": devices}))


def main():
    if len(sys.argv) < 2:
        print("Usage: rtt-helper.py <device_or_rtt_address|discover> [poll_ms] [nrfutil_path]", file=sys.stderr)
        sys.exit(1)

    device_or_addr = sys.argv[1]

    # Discovery mode — just list connected probes and exit
    if device_or_addr == "discover":
        run_discover()
        return

    poll_ms = int(sys.argv[2]) if len(sys.argv) > 2 else 20
    nrfutil_path = sys.argv[3] if len(sys.argv) > 3 else "nrfutil"

    # Auto-detect device if requested
    if device_or_addr == "auto":
        jlink_name, friendly_name = detect_device(nrfutil_path)
        if jlink_name:
            print(f"DEVICE_DETECTED {friendly_name}", file=sys.stderr)
            sys.stderr.flush()
            device_or_addr = jlink_name
        else:
            print("Could not auto-detect device, using Cortex-M33", file=sys.stderr)
            sys.stderr.flush()
            device_or_addr = "Cortex-M33"

    # Try pylink first (native J-Link RTT, works with any J-Link device)
    try:
        import pylink  # noqa: F401
        print("Using pylink (native J-Link RTT)", file=sys.stderr)
        sys.stderr.flush()
        run_pylink(device_or_addr, poll_ms)
    except ImportError:
        print("pylink not available, falling back to nrfutil CLI", file=sys.stderr)
        sys.stderr.flush()
        run_nrfutil(device_or_addr, poll_ms, nrfutil_path)


if __name__ == "__main__":
    main()
