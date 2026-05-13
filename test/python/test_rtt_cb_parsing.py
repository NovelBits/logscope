import pytest
import struct as _struct
from rtt_helper import _scan_for_magic, _parse_cb, RTT_MAGIC
from fixtures.cb_layouts import (
    cb_one_up, cb_with_hci, cb_zero_pbuffer, build_cb,
    build_buffer_descriptor,
)


def test_scan_finds_magic_at_start():
    cb = cb_one_up()
    assert _scan_for_magic(cb) == [0]


def test_scan_finds_magic_in_middle():
    padding = b"\x00" * 256
    buf = padding + cb_one_up() + padding
    assert _scan_for_magic(buf) == [256]


def test_scan_returns_empty_when_not_present():
    assert _scan_for_magic(b"no magic here" * 100) == []


def test_scan_returns_all_matches():
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


def test_scan_empty_magic_is_no_op():
    """Defensive: explicit empty-magic returns empty list, not every offset."""
    # Without explicit guard, bytes.find(b"") returns offset 0 forever.
    # Confirm we have a defensive guard.
    assert _scan_for_magic(b"hello", b"") == []


def test_parse_minimal_one_up_buffer():
    cb_bytes = cb_one_up(p_buffer=0x20001000, size=1024)
    parsed = _parse_cb(cb_bytes, base_addr=0x20000800)
    assert parsed.cb_addr == 0x20000800
    assert parsed.max_up_buffers == 1
    assert parsed.max_down_buffers == 0
    assert len(parsed.up_buffers) == 1
    ch = parsed.up_buffers[0]
    assert ch.index == 0
    assert ch.p_buffer == 0x20001000
    assert ch.size == 1024
    assert ch.initial_wr_off == 0
    assert ch.initial_rd_off == 0
    assert ch.flags_mode == 0


def test_parse_channel_desc_addr_is_absolute():
    """desc_addr should be base_addr + 24 (header) + 0*24 for channel 0."""
    cb_bytes = cb_one_up()
    parsed = _parse_cb(cb_bytes, base_addr=0x20000800)
    assert parsed.up_buffers[0].desc_addr == 0x20000800 + 24


def test_parse_hci_two_up_buffers():
    parsed = _parse_cb(cb_with_hci(), base_addr=0x20000800)
    assert parsed.max_up_buffers == 2
    assert len(parsed.up_buffers) == 2
    assert parsed.up_buffers[0].index == 0
    assert parsed.up_buffers[1].index == 1


def test_parse_skips_zero_pbuffer():
    """Channels with pBuffer == 0 are uninitialized; skip silently."""
    parsed = _parse_cb(cb_zero_pbuffer(), base_addr=0x20000800)
    assert parsed.max_up_buffers == 2
    assert len(parsed.up_buffers) == 1
    assert parsed.up_buffers[0].index == 0


def test_parse_rejects_max_up_above_255():
    cb_bytes = RTT_MAGIC + _struct.pack("<II", 256, 0)
    with pytest.raises(ValueError, match="255"):
        _parse_cb(cb_bytes, base_addr=0)


def test_parse_rejects_max_down_above_255():
    cb_bytes = (RTT_MAGIC + _struct.pack("<II", 1, 256)
                + build_buffer_descriptor(0, 0x1000, 1024, 0, 0, 0))
    with pytest.raises(ValueError, match="255"):
        _parse_cb(cb_bytes, base_addr=0)


def test_parse_rejects_wr_off_at_or_beyond_size():
    cb_bytes = build_cb([build_buffer_descriptor(0, 0x1000, 1024, 1024, 0, 0)])
    with pytest.raises(ValueError, match="WrOff"):
        _parse_cb(cb_bytes, base_addr=0)


def test_parse_rejects_rd_off_at_or_beyond_size():
    cb_bytes = build_cb([build_buffer_descriptor(0, 0x1000, 1024, 0, 1024, 0)])
    with pytest.raises(ValueError, match="RdOff"):
        _parse_cb(cb_bytes, base_addr=0)


def test_parse_rejects_invalid_mode_bits():
    """Flags & 0x3 == 3 is reserved; treat as corruption."""
    cb_bytes = build_cb([build_buffer_descriptor(0, 0x1000, 1024, 0, 0, 0x3)])
    with pytest.raises(ValueError, match="mode"):
        _parse_cb(cb_bytes, base_addr=0)


def test_parse_truncated_buffer():
    """Buffer too short to contain claimed channel descriptors."""
    cb_bytes = RTT_MAGIC + _struct.pack("<II", 5, 0) + b"\x00" * 10
    with pytest.raises(ValueError, match="truncated"):
        _parse_cb(cb_bytes, base_addr=0)
