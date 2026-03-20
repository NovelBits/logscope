#!/usr/bin/env python3
"""
UART serial reader helper — runs as a long-lived subprocess, reads serial data
and writes raw bytes to stdout. Also supports port discovery.

Usage:
  python3 uart-helper.py discover                    # List serial ports as JSON
  python3 uart-helper.py <port> [baud_rate]          # Stream serial data to stdout
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
        # Filter out Bluetooth and debug ports
        lower = path.lower()
        if "bluetooth" in lower or "debug" in lower:
            continue
        raw_ports.append({
            "path": path,
            "manufacturer": p.manufacturer or None,
            "serialNumber": p.serial_number or None,
            "description": p.description if p.description and p.description != "n/a" else None,
            "product": p.product or None,
        })

    # Assign port numbers for devices with multiple CDC interfaces (same serial)
    # Group by serial number, sort by path, assign Port 1, Port 2, etc.
    from collections import Counter
    serial_counts = Counter(p["serialNumber"] for p in raw_ports if p["serialNumber"])
    serial_indices = {}  # serial -> next port number

    # Sort by path so port numbering is deterministic
    raw_ports.sort(key=lambda p: p["path"])

    ports = []
    for p in raw_ports:
        sn = p["serialNumber"]
        if sn and serial_counts[sn] > 1:
            idx = serial_indices.get(sn, 1)
            serial_indices[sn] = idx + 1
            p["portNumber"] = idx
        ports.append(p)

    print(json.dumps({"ports": ports}))


def run_serial(port_path, baud_rate):
    """Open serial port and stream data to stdout."""
    import serial

    try:
        ser = serial.Serial(port_path, baud_rate, timeout=0.1)
    except serial.SerialException as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.stderr.flush()
        sys.exit(2)

    print(f"SERIAL_READY port={port_path} baud={baud_rate}", file=sys.stderr)
    sys.stderr.flush()

    stdout = os.fdopen(sys.stdout.fileno(), "wb", 0)

    while True:
        try:
            data = ser.read(4096)
            if data:
                stdout.write(data)
        except serial.SerialException as e:
            print(f"ERROR: Serial read failed: {e}", file=sys.stderr)
            sys.stderr.flush()
            break
        except BrokenPipeError:
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
    run_serial(port_path, baud_rate)


if __name__ == "__main__":
    main()
