import pytest
from rtt_helper import _scan_for_magic, RTT_MAGIC


def test_scan_finds_magic_at_start():
    from fixtures.cb_layouts import cb_one_up
    cb = cb_one_up()
    assert _scan_for_magic(cb) == [0]


def test_scan_finds_magic_in_middle():
    from fixtures.cb_layouts import cb_one_up
    padding = b"\x00" * 256
    buf = padding + cb_one_up() + padding
    assert _scan_for_magic(buf) == [256]


def test_scan_returns_empty_when_not_present():
    assert _scan_for_magic(b"no magic here" * 100) == []


def test_scan_returns_all_matches():
    from fixtures.cb_layouts import cb_one_up
    cb = cb_one_up()
    buf = cb + b"\x00" * 128 + cb
    assert _scan_for_magic(buf) == [0, len(cb) + 128]


def test_scan_handles_partial_magic_at_buffer_end():
    """Truncated magic at end must not be reported as a match."""
    buf = b"\xff" * 100 + RTT_MAGIC[:10]
    assert _scan_for_magic(buf) == []


def test_scan_uses_byte_window_not_aligned():
    """Magic at odd offset must be found (byte-windowed, not aligned)."""
    buf = b"\x00\x00\x00" + RTT_MAGIC + b"\x00" * 64
    assert _scan_for_magic(buf) == [3]
