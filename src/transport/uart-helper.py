#!/usr/bin/env python3
"""
UART serial reader helper — runs as a long-lived subprocess, reads serial data
and writes raw bytes to stdout. Also supports port discovery.

Usage:
  python3 uart-helper.py discover                            # List serial ports as JSON
  python3 uart-helper.py <port> [baud] [data] [stop] [parity]
    data   = 5|6|7|8     (default 8)
    stop   = 1|1.5|2     (default 1)
    parity = none|odd|even|mark|space (default none)
"""
import sys
import os
import json
import time


def run_discover():
    """Discover available serial ports and output JSON to stdout."""
    try:
        import serial.tools.list_ports
    except ImportError:
        print(json.dumps({"error": "pyserial not installed", "ports": []}))
        return

    raw_ports = []
    for p in serial.tools.list_ports.comports():
        path = p.device
        # Filter out Bluetooth and debug ports (check path, description, and hwid)
        searchable = f"{path} {p.description or ''} {p.hwid or ''}".lower()
        if "bluetooth" in searchable or "bthenum" in searchable or "debug" in searchable:
            continue
        raw_ports.append({
            "path": path,
            "manufacturer": p.manufacturer or None,
            "serialNumber": p.serial_number or None,
            "description": p.description if p.description and p.description != "n/a" else None,
            "product": p.product or None,
            "_location": p.location or "",
        })

    # Assign port numbers for devices with multiple CDC interfaces (same serial)
    # Group by serial number, sort by USB interface number for consistent
    # ordering across platforms (Windows COM numbers don't match USB order).
    from collections import Counter
    serial_counts = Counter(p["serialNumber"] for p in raw_ports if p["serialNumber"])
    serial_indices = {}  # serial -> next port number

    # Sort by USB location (interface number) so port numbering is consistent
    # across Windows/macOS/Linux. Falls back to path if location is unavailable.
    raw_ports.sort(key=lambda p: (p["_location"] or p["path"]))

    ports = []
    for p in raw_ports:
        sn = p["serialNumber"]
        if sn and serial_counts[sn] > 1:
            idx = serial_indices.get(sn, 1)
            serial_indices[sn] = idx + 1
            p["portNumber"] = idx
        p.pop("_location", None)
        ports.append(p)

    print(json.dumps({"ports": ports}))


def _resolve_uart_options(data_bits, stop_bits, parity):
    """Map our string/int knobs to pyserial constants. Defaults preserve 8N1
    (the implicit behavior before these settings were added)."""
    import serial as _s
    bytesize = {5: _s.FIVEBITS, 6: _s.SIXBITS, 7: _s.SEVENBITS, 8: _s.EIGHTBITS}.get(data_bits)
    stopbits = {"1": _s.STOPBITS_ONE, "1.5": _s.STOPBITS_ONE_POINT_FIVE, "2": _s.STOPBITS_TWO}.get(stop_bits)
    par = {
        "none": _s.PARITY_NONE,
        "odd": _s.PARITY_ODD,
        "even": _s.PARITY_EVEN,
        "mark": _s.PARITY_MARK,
        "space": _s.PARITY_SPACE,
    }.get(parity)
    if bytesize is None:
        raise ValueError(f"Unsupported dataBits: {data_bits}")
    if stopbits is None:
        raise ValueError(f"Unsupported stopBits: {stop_bits}")
    if par is None:
        raise ValueError(f"Unsupported parity: {parity}")
    return bytesize, stopbits, par


def run_serial(port_path, baud_rate, data_bits=8, stop_bits="1", parity="none"):
    """Open serial port and stream data to stdout."""
    import serial

    try:
        bytesize, stopbits, par = _resolve_uart_options(data_bits, stop_bits, parity)
        ser = serial.Serial(
            port_path,
            baud_rate,
            bytesize=bytesize,
            stopbits=stopbits,
            parity=par,
            timeout=0.1,
        )
    except (serial.SerialException, ValueError) as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.stderr.flush()
        sys.exit(2)

    print(
        f"SERIAL_READY port={port_path} baud={baud_rate} data={data_bits} stop={stop_bits} parity={parity}",
        file=sys.stderr,
    )
    sys.stderr.flush()

    stdout = os.fdopen(sys.stdout.fileno(), "wb", 0)
    # Windows unplug detection is handled on the Node/TypeScript side
    # (UartTransport.startPortWatcher) because ser.read() blocks indefinitely
    # after unplug on Windows and no Python-side workaround reliably unblocks it.
    # The extension kills this process when it detects the port has disappeared.

    while True:
        try:
            data = ser.read(4096)
            if data:
                stdout.write(data)
            else:
                # No data — on macOS/Linux check if port still exists
                if sys.platform != "win32" and not os.path.exists(port_path):
                    print(f"ERROR: Port {port_path} disappeared — device unplugged", file=sys.stderr)
                    sys.stderr.flush()
                    break
        except serial.SerialException as e:
            print(f"ERROR: Serial read failed: {e}", file=sys.stderr)
            sys.stderr.flush()
            break
        except BrokenPipeError:
            break
        except OSError as e:
            print(f"ERROR: Port error: {e}", file=sys.stderr)
            sys.stderr.flush()
            break

    ser.close()


def main():
    if len(sys.argv) < 2:
        print("Usage: uart-helper.py <port|discover> [baud_rate]", file=sys.stderr)
        sys.exit(1)

    if sys.argv[1] == "discover":
        run_discover()
        return

    port_path = sys.argv[1]
    baud_rate = int(sys.argv[2]) if len(sys.argv) > 2 else 115200
    data_bits = int(sys.argv[3]) if len(sys.argv) > 3 else 8
    stop_bits = sys.argv[4] if len(sys.argv) > 4 else "1"
    parity = sys.argv[5] if len(sys.argv) > 5 else "none"
    run_serial(port_path, baud_rate, data_bits=data_bits, stop_bits=stop_bits, parity=parity)


if __name__ == "__main__":
    main()
