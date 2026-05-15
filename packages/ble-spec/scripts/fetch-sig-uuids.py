#!/usr/bin/env python3
"""
Fetch Bluetooth SIG UUID YAMLs from bitbucket and transform them into the
@novelbits/ble-spec schema.

Run from the LogScope repo root:
    python3 packages/ble-spec/scripts/fetch-sig-uuids.py

This is a one-time tool. Output is committed to git; the script itself is
kept for repeatability when we re-snapshot (Phase 3 of the spec database
will replace this with a CI-driven sync).
"""

from __future__ import annotations

import datetime
import json
import pathlib
import sys
import urllib.request

import yaml

SIG_RAW_BASE = "https://bitbucket.org/bluetooth-SIG/public/raw/main/assigned_numbers/uuids/"
SIG_API_COMMIT = "https://api.bitbucket.org/2.0/repositories/bluetooth-SIG/public/commits/main?pagelen=1"

DEST_DIR = pathlib.Path(__file__).resolve().parent.parent / "data" / "sig-mirror"

FILES = [
    ("service_uuids.yaml", "service_uuids", "Bluetooth SIG-defined Service UUIDs"),
    ("characteristic_uuids.yaml", "characteristic_uuids", "Bluetooth SIG-defined Characteristic UUIDs"),
    ("descriptor_uuids.yaml", "descriptor_uuids", "Bluetooth SIG-defined Descriptor UUIDs"),
]


def fetch_commit_hash() -> str:
    with urllib.request.urlopen(SIG_API_COMMIT, timeout=15) as resp:
        data = json.loads(resp.read())
    return data["values"][0]["hash"][:12]


def fetch_yaml(filename: str) -> dict:
    url = SIG_RAW_BASE + filename
    with urllib.request.urlopen(url, timeout=15) as resp:
        return yaml.safe_load(resp.read())


def transform(sig_data: dict, schema: str, source_url: str, commit: str, label: str) -> str:
    entries = sig_data.get("uuids") or sig_data.get("entries") or []
    out_entries = []
    for e in entries:
        uuid_int = e.get("uuid") or e.get("value")
        name = e.get("name")
        if uuid_int is None or name is None:
            continue
        out_entries.append(f'  - {{ code: "0x{uuid_int:04X}", name: {yaml.safe_dump(name).strip()} }}')

    today = datetime.date.today().isoformat()
    return (
        f"# {label}\n"
        f"# Pinned snapshot from the Bluetooth SIG bitbucket repo.\n"
        f"# Re-snapshot with packages/ble-spec/scripts/fetch-sig-uuids.py.\n"
        f"\n"
        f"schema: {schema}\n"
        f'source: "{source_url}"\n'
        f"last_updated: \"{today}\"\n"
        f"source_commit: \"{commit}\"\n"
        f"\n"
        f"entries:\n"
        + "\n".join(out_entries)
        + "\n"
    )


def main() -> int:
    DEST_DIR.mkdir(parents=True, exist_ok=True)
    commit = fetch_commit_hash()
    print(f"Upstream commit: {commit}")

    for filename, schema, label in FILES:
        print(f"Fetching {filename}...")
        sig_data = fetch_yaml(filename)
        source_url = SIG_RAW_BASE + filename
        rendered = transform(sig_data, schema, source_url, commit, label)
        dest = DEST_DIR / filename
        dest.write_text(rendered)
        count = rendered.count("- { code:")
        print(f"  wrote {dest} ({count} entries)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
