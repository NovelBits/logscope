import pytest
import struct as _struct
import struct
from rtt_helper import (
    _scan_for_magic, _parse_cb, _compute_ring_read, RTT_MAGIC,
    DirectMemoryRttSession, TargetResetError, CB_HEADER_SIZE,
)
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


def test_parse_rejects_zero_size_with_valid_pbuffer():
    """A channel with pBuffer != 0 but size == 0 is corrupt; reject it.

    Distinct from the pBuffer == 0 skip path: this guards against partial
    initialization where the firmware allocated a buffer pointer but never
    set the size field.
    """
    cb_bytes = build_cb([build_buffer_descriptor(0, 0x1000, 0, 0, 0, 0)])
    with pytest.raises(ValueError, match="size=0"):
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


def test_ring_read_empty_when_equal_at_zero():
    assert _compute_ring_read(wr_off=0, rd_off=0, size=1024) == []


def test_ring_read_empty_when_equal_mid_buffer():
    assert _compute_ring_read(wr_off=500, rd_off=500, size=1024) == []


def test_ring_read_linear_no_wrap():
    """wr > rd: single contiguous slice from rd to wr."""
    assert _compute_ring_read(wr_off=300, rd_off=100, size=1024) == [(100, 200)]


def test_ring_read_wraparound():
    """rd > wr: tail of buffer + head from 0."""
    assert _compute_ring_read(wr_off=100, rd_off=900, size=1024) == [(900, 124), (0, 100)]


def test_ring_read_wraparound_with_zero_wr():
    """rd > wr with wr == 0: just one slice to end of buffer (no head slice)."""
    assert _compute_ring_read(wr_off=0, rd_off=500, size=1024) == [(500, 524)]


def test_ring_read_full_minus_one():
    """SEGGER reserves one byte; max usable is size-1.
    rd=1, wr=0 means buffer is full minus one byte, all size-1 bytes wrap-readable
    in a single slice (no second slice since wr==0)."""
    assert _compute_ring_read(wr_off=0, rd_off=1, size=1024) == [(1, 1023)]


class FakeJLink:
    """Minimal mock of pylink.JLink for direct-memory tests.

    Uses a 64KB scratch buffer based at 0x20000000. memory_read/read32/write32
    read and write into that buffer; writes are also appended to a log.
    """
    def __init__(self, memory=None):
        self._memory = bytearray(64 * 1024)
        self._base = 0x20000000
        if memory:
            for addr, data in memory.items():
                offset = addr - self._base
                self._memory[offset:offset + len(data)] = data
        self.writes = []

    def memory_read(self, addr, num_bytes):
        offset = addr - self._base
        return list(self._memory[offset:offset + num_bytes])

    def memory_read32(self, addr, num_words):
        offset = addr - self._base
        return list(struct.unpack_from(f"<{num_words}I", self._memory, offset))

    def memory_write32(self, addr, values):
        offset = addr - self._base
        struct.pack_into(f"<{len(values)}I", self._memory, offset, *values)
        self.writes.append((addr, list(values)))


def test_session_attach_finds_cb_in_ram():
    cb = cb_one_up(p_buffer=0x20001000, size=1024)
    fake = FakeJLink(memory={0x20000800: cb})

    session = DirectMemoryRttSession(fake)
    session.attach(search_ranges=[(0x20000000, 0x10000)])

    assert session.cb_addr == 0x20000800
    assert len(session.channels) == 1
    assert session.channels[0].p_buffer == 0x20001000


def test_session_attach_rejects_multiple_matches():
    cb = cb_one_up()
    fake = FakeJLink(memory={
        0x20000800: cb,
        0x20002000: cb,  # duplicate (e.g., literal in .rodata)
    })
    session = DirectMemoryRttSession(fake)
    with pytest.raises(ValueError, match="multiple"):
        session.attach(search_ranges=[(0x20000000, 0x10000)])


def test_session_attach_raises_when_no_match():
    fake = FakeJLink()
    session = DirectMemoryRttSession(fake)
    with pytest.raises(ValueError, match="not found"):
        session.attach(search_ranges=[(0x20000000, 0x10000)])


def test_session_read_channel_returns_data_and_advances_rd_off():
    """Firmware wrote 50 bytes; we read them and write RdOff back."""
    cb = cb_one_up(p_buffer=0x20001000, size=1024, wr_off=50, rd_off=0)
    payload = bytes(range(50))
    fake = FakeJLink(memory={0x20000800: cb, 0x20001000: payload})

    session = DirectMemoryRttSession(fake)
    session.attach(search_ranges=[(0x20000000, 0x10000)])

    data = session.read_channel(0)
    assert bytes(data) == payload

    rd_off_addr = 0x20000800 + CB_HEADER_SIZE + 16  # BUFFER_DESC_RDOFF_OFFSET
    assert (rd_off_addr, [50]) in fake.writes
    assert session._last_written_rd_off[0] == 50


def test_session_read_channel_empty_returns_no_data_no_write():
    """WrOff == RdOff: no data, no writeback."""
    cb = cb_one_up(p_buffer=0x20001000, size=1024, wr_off=0, rd_off=0)
    fake = FakeJLink(memory={0x20000800: cb})

    session = DirectMemoryRttSession(fake)
    session.attach(search_ranges=[(0x20000000, 0x10000)])

    data = session.read_channel(0)
    assert data == b""
    assert fake.writes == []


def test_session_detects_target_reset_via_rdoff_mismatch():
    """After we write RdOff=50, target reset zeroes RdOff; next poll must
    raise TargetResetError so the caller can re-attach."""
    cb = cb_one_up(p_buffer=0x20001000, size=1024, wr_off=50, rd_off=0)
    payload = bytes(range(50))
    fake = FakeJLink(memory={0x20000800: cb, 0x20001000: payload})

    session = DirectMemoryRttSession(fake)
    session.attach(search_ranges=[(0x20000000, 0x10000)])
    session.read_channel(0)  # writes RdOff=50; _last_written_rd_off[0] == 50

    # Simulate target reset: firmware re-init zeroed RdOff.
    rd_off_addr = 0x20000800 + CB_HEADER_SIZE + 16
    fake.memory_write32(rd_off_addr, [0])
    fake.writes.clear()

    with pytest.raises(TargetResetError) as exc_info:
        session.read_channel(0)
    err = exc_info.value
    assert err.channel_index == 0
    assert err.expected == 50
    assert err.actual == 0


def test_session_dereferences_channel_name():
    """sName pointer resolves to a NUL-terminated string."""
    cb = build_cb([build_buffer_descriptor(
        name_ptr=0x20002000, p_buffer=0x20001000, size=1024,
        wr_off=0, rd_off=0, flags=0)])
    fake = FakeJLink(memory={
        0x20000800: cb,
        0x20002000: b"Terminal\x00",
    })

    session = DirectMemoryRttSession(fake)
    session.attach(search_ranges=[(0x20000000, 0x10000)])

    assert session.channel_name(0) == "Terminal"


def test_session_channel_name_returns_none_on_zero_pointer():
    cb = cb_one_up()  # name_ptr == 0
    fake = FakeJLink(memory={0x20000800: cb, 0x20001000: b""})
    session = DirectMemoryRttSession(fake)
    session.attach(search_ranges=[(0x20000000, 0x10000)])
    assert session.channel_name(0) is None


def test_session_re_attach_after_reset_clears_stale_state():
    """After a TargetResetError, a fresh attach() must reset
    _last_written_rd_off so the next read doesn't false-positive.
    """
    cb = cb_one_up(p_buffer=0x20001000, size=1024, wr_off=50, rd_off=0)
    payload = bytes(range(50))
    fake = FakeJLink(memory={0x20000800: cb, 0x20001000: payload})

    session = DirectMemoryRttSession(fake)
    session.attach(search_ranges=[(0x20000000, 0x10000)])
    session.read_channel(0)  # _last_written_rd_off[0] becomes 50

    # Simulate target reset: zero RdOff and reset WrOff (firmware re-init).
    rd_off_addr = 0x20000800 + CB_HEADER_SIZE + 16
    wr_off_addr = 0x20000800 + CB_HEADER_SIZE + 12
    fake.memory_write32(rd_off_addr, [0])
    fake.memory_write32(wr_off_addr, [0])
    fake.writes.clear()

    with pytest.raises(TargetResetError):
        session.read_channel(0)

    # Re-attach must clear stale _last_written_rd_off and re-seed from
    # the post-reset target state.
    session.attach(search_ranges=[(0x20000000, 0x10000)])
    assert session._last_written_rd_off == {0: 0}

    # First read after re-attach must succeed (no false-positive reset).
    data = session.read_channel(0)
    assert data == b""  # nothing new since reset


def test_session_read_channel_wraparound():
    """read_channel must correctly assemble bytes across the ring-buffer wrap
    and update _last_written_rd_off to the modulo-size new offset.
    """
    size = 1024
    # Place wr_off=100, rd_off=900 with payload bytes filling the buffer such
    # that reading should produce [bytes 900..1023] + [bytes 0..99] = 224 bytes.
    cb = cb_one_up(p_buffer=0x20001000, size=size, wr_off=100, rd_off=900)

    # Fill the ring buffer with distinguishable bytes: byte at offset N is (N % 256).
    ring = bytes((i % 256) for i in range(size))
    fake = FakeJLink(memory={0x20000800: cb, 0x20001000: ring})

    session = DirectMemoryRttSession(fake)
    session.attach(search_ranges=[(0x20000000, 0x10000)])

    data = session.read_channel(0)

    # Expected: tail from rd_off=900 to end (124 bytes) + head from 0 to wr_off=100 (100 bytes)
    expected = ring[900:1024] + ring[0:100]
    assert data == expected
    assert len(data) == 224

    # new_rd_off should be (900 + 224) % 1024 = 100
    assert session._last_written_rd_off[0] == 100


# ---------------------------------------------------------------------------
# Transient SWD error retry tests (reset-window glitch recovery).
# ---------------------------------------------------------------------------


class FakeJLinkException(Exception):
    """Mock pylink JLinkException with a code attribute."""
    def __init__(self, message, code):
        super().__init__(message)
        self.code = code


class ScriptedFakeJLink(FakeJLink):
    """FakeJLink that throws scripted exceptions on memory_read32 calls.

    error_script is a list; each entry is either None (success, fall through
    to FakeJLink behavior) or an Exception instance to raise.
    """
    def __init__(self, memory=None, error_script=None):
        super().__init__(memory=memory)
        self.error_script = list(error_script) if error_script else []
        self.memory_read32_calls = 0

    def memory_read32(self, addr, num_words):
        self.memory_read32_calls += 1
        if self.error_script:
            entry = self.error_script.pop(0)
            if entry is not None:
                raise entry
        return super().memory_read32(addr, num_words)


def test_classify_jlink_error_transient():
    from rtt_helper import _classify_jlink_error
    exc = FakeJLinkException("Unspecified error.", code=-1)
    assert _classify_jlink_error(exc) == "transient"


def test_classify_jlink_error_probe_fatal():
    from rtt_helper import _classify_jlink_error
    exc = FakeJLinkException("EMU communication error.", code=-257)
    assert _classify_jlink_error(exc) == "probe_fatal"


def test_classify_jlink_error_target_state():
    from rtt_helper import _classify_jlink_error
    exc = FakeJLinkException("CPU in low power mode.", code=-274)
    assert _classify_jlink_error(exc) == "target_state"


def test_classify_jlink_error_unknown_treated_as_transient():
    """Exceptions without a code attribute should be treated transient
    (matches the message-only fallback case)."""
    from rtt_helper import _classify_jlink_error
    exc = Exception("some random error")
    assert _classify_jlink_error(exc) == "transient"


def test_read_channel_probe_fatal_raises_immediately():
    """A probe-fatal error (-257) must propagate to the caller unchanged so
    the outer loop can escalate to full_reconnect without any grace window."""
    cb = cb_one_up(p_buffer=0x20001000, size=1024, wr_off=50, rd_off=0)
    fake = ScriptedFakeJLink(
        memory={0x20000800: cb, 0x20001000: bytes(50)},
        error_script=[FakeJLinkException("EMU comm error.", code=-257)],
    )
    session = DirectMemoryRttSession(fake)
    session.attach(search_ranges=[(0x20000000, 0x10000)])
    with pytest.raises(FakeJLinkException) as exc_info:
        session.read_channel(0)
    assert exc_info.value.code == -257
    # attach() uses memory_read (bytes), not memory_read32, so the only
    # memory_read32 call is the single one inside read_channel.
    assert fake.memory_read32_calls == 1


def test_read_channel_target_state_raises_immediately():
    """Target-state errors propagate so the outer loop surfaces them
    without auto-recovery."""
    cb = cb_one_up(p_buffer=0x20001000, size=1024, wr_off=50, rd_off=0)
    fake = ScriptedFakeJLink(
        memory={0x20000800: cb, 0x20001000: bytes(50)},
        error_script=[FakeJLinkException("CPU low power.", code=-274)],
    )
    session = DirectMemoryRttSession(fake)
    session.attach(search_ranges=[(0x20000000, 0x10000)])
    with pytest.raises(FakeJLinkException) as exc_info:
        session.read_channel(0)
    assert exc_info.value.code == -274
    assert fake.memory_read32_calls == 1


def test_read_channel_raises_TransientSwdReadError_on_out_of_range_offsets():
    """When the J-Link DLL returns out-of-range offsets without raising
    (a behavior observed during the reset window), read_channel surfaces a
    TransientSwdReadError. The outer loop's classifier then treats this as
    a transient error subject to the time-based grace window.
    """
    from rtt_helper import TransientSwdReadError
    cb = cb_one_up(p_buffer=0x20001000, size=1024, wr_off=50, rd_off=0)
    fake = FakeJLink(memory={0x20000800: cb, 0x20001000: bytes(range(50))})
    session = DirectMemoryRttSession(fake)
    session.attach(search_ranges=[(0x20000000, 0x10000)])

    # Override memory_read32 to return out-of-range offsets on the read.
    def out_of_range(addr, num_words):
        return [9999, 0]  # wr_off=9999 > size=1024
    fake.memory_read32 = out_of_range

    with pytest.raises(TransientSwdReadError):
        session.read_channel(0)
