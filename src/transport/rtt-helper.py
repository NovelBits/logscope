#!/usr/bin/env python3
"""
RTT reader helper — runs as a long-lived subprocess, reads RTT data via
SEGGER J-Link RTT and writes raw bytes to stdout.

Preferred: pylink (native J-Link RTT, zero packet loss, any J-Link device)
Fallback: nrfutil CLI (nRF devices only, slower, some packet loss)

Usage: python3 rtt-helper.py <device_name_or_rtt_address> [poll_interval_ms] [nrfutil_path]
"""
import signal
import struct
import threading
import time
import sys
import os
from dataclasses import dataclass, field
from typing import List


RTT_MAGIC = b"SEGGER RTT\x00\x00\x00\x00\x00\x00"
assert len(RTT_MAGIC) == 16

# SEGGER RTT control-block layout constants (from SEGGER_RTT.h).
# Header: magic (16 bytes) + MaxNumUpBuffers (u32) + MaxNumDownBuffers (u32).
CB_HEADER_SIZE = 24
# Each SEGGER_RTT_BUFFER_UP/DOWN descriptor: sName + pBuffer + size + WrOff
# + RdOff + Flags, each a little-endian u32.
BUFFER_DESC_SIZE = 24

# Field offsets in SEGGER_RTT_BUFFER_UP used by the direct-memory session
# (Task 4) to compute target addresses for WrOff (read) and RdOff (write).
# The full descriptor layout is documented by the struct format string used
# in _parse_cb below.
BUFFER_DESC_WROFF_OFFSET = 12
BUFFER_DESC_RDOFF_OFFSET = 16

# probe-rs sanity cap; SEGGER spec uses u32 but real firmware never goes above 4.
MAX_BUFFERS = 255

# probe-rs cap on sName length when dereferencing the name pointer; bounds
# runaway memory reads if the pointer is garbage or the string is unterminated.
CHANNEL_NAME_MAX_LEN = 128


# pylink JLinkException codes (from pylink.enums.JLinkGlobalErrors).
# Transient: J-Link DLL exhausted its WAIT retries but the failure is likely
# a multi-hundred-ms SWD glitch (typically: target reset window, low-power
# transition). The outer poll loop is the retry mechanism; a time-based
# grace window decides when to escalate.
JLINK_TRANSIENT_CODES = frozenset({
    -1,    # UNSPECIFIED_ERROR (J-Link DLL catch-all; SWD glitch lands here)
    -264,  # TIF_STATUS_ERROR
})

# Fatal at probe level: the J-Link itself is gone or our handle is dead.
# Escalate to full_reconnect immediately (no grace).
JLINK_PROBE_FATAL_CODES = frozenset({
    -256,  # EMU_NO_CONNECTION
    -257,  # EMU_COMM_ERROR
    -258,  # DLL_NOT_OPEN
    -260,  # INVALID_HANDLE
})

# Target-state errors: the probe is fine but the target isn't responsive.
# Surface to the user; auto-reconnect won't help.
JLINK_TARGET_STATE_CODES = frozenset({
    -259,  # VCC_FAILURE
    -261,  # NO_CPU_FOUND
    -273,  # NO_TARGET_DEVICE_SELECTED
    -274,  # CPU_IN_LOW_POWER_MODE
})


def _classify_jlink_error(exc):
    """Classify a pylink exception as 'transient', 'probe_fatal', 'target_state',
    or 'unknown'. Drives recovery decisions in the RTT read loop.
    """
    code = getattr(exc, "code", None)
    if code in JLINK_PROBE_FATAL_CODES:
        return "probe_fatal"
    if code in JLINK_TARGET_STATE_CODES:
        return "target_state"
    if code in JLINK_TRANSIENT_CODES or code is None:
        return "transient"
    return "unknown"


@dataclass
class ChannelDesc:
    index: int              # 0-based index within the up-buffers array
    desc_addr: int          # absolute address of this descriptor in target memory
    name_ptr: int
    p_buffer: int
    size: int
    initial_wr_off: int
    initial_rd_off: int
    flags_mode: int         # Flags & 0x3 (0=NoBlockSkip, 1=NoBlockTrim, 2=BlockIfFull)


@dataclass
class ParsedCB:
    cb_addr: int
    max_up_buffers: int
    max_down_buffers: int
    up_buffers: List[ChannelDesc] = field(default_factory=list)
    # down_buffers intentionally omitted; LogScope does not write to the target.


def _scan_for_magic(buf, magic=RTT_MAGIC):
    """Find all occurrences of the RTT magic string in a byte buffer.

    Returns a list of byte offsets where the magic begins. Uses byte-windowed
    search (no alignment requirement), matching probe-rs's approach. The magic
    can appear in firmware .rodata as a literal string in addition to the
    actual CB, so callers must treat multiple matches as ambiguous rather than
    silently picking the first one.
    """
    if not magic:
        return []
    offsets = []
    start = 0
    while True:
        idx = buf.find(magic, start)
        if idx < 0:
            break
        offsets.append(idx)
        start = idx + 1
    return offsets


def _parse_cb(buf, base_addr):
    """Parse a SEGGER RTT control block from a memory snapshot.

    Args:
        buf: bytes whose offset 0 is the first byte of the RTT magic. Caller is
             responsible for slicing buf before invoking this function; base_addr
             must correspond to buf[0] in target memory.
        base_addr: target memory address corresponding to buf[0].

    Returns:
        ParsedCB with validated up-buffer descriptors. Channels with
        pBuffer == 0 are skipped silently (uninitialized).

    Raises:
        ValueError on any validation failure. Callers should surface as
        "control block corrupted; check firmware RTT initialization."
    """
    if len(buf) < CB_HEADER_SIZE:
        raise ValueError(
            f"CB truncated: need {CB_HEADER_SIZE} header bytes, got {len(buf)}")

    if buf[:16] != RTT_MAGIC:
        raise ValueError("CB magic mismatch")

    max_up, max_down = struct.unpack_from("<II", buf, 16)

    if max_up > MAX_BUFFERS:
        raise ValueError(
            f"max_up_buffers={max_up} exceeds {MAX_BUFFERS} (CB corrupt?)")
    if max_down > MAX_BUFFERS:
        raise ValueError(
            f"max_down_buffers={max_down} exceeds {MAX_BUFFERS} (CB corrupt?)")

    expected_len = CB_HEADER_SIZE + (max_up + max_down) * BUFFER_DESC_SIZE
    if len(buf) < expected_len:
        raise ValueError(
            f"CB truncated: need {expected_len} bytes, got {len(buf)}")

    up_buffers = []
    for i in range(max_up):
        desc_offset = CB_HEADER_SIZE + i * BUFFER_DESC_SIZE
        name_ptr, p_buffer, size, wr_off, rd_off, flags = struct.unpack_from(
            "<IIIIII", buf, desc_offset)

        # Uninitialized slot: SEGGER zeroes pBuffer until the channel is set up.
        # Some firmware writes the magic LAST during init, so this is expected
        # for channels above the firmware's actual configured count.
        if p_buffer == 0:
            continue

        if size == 0:
            raise ValueError(
                f"channel {i}: size=0 with pBuffer=0x{p_buffer:08x}")
        if wr_off >= size:
            raise ValueError(f"channel {i}: WrOff={wr_off} >= size={size}")
        if rd_off >= size:
            raise ValueError(f"channel {i}: RdOff={rd_off} >= size={size}")

        mode = flags & 0x3
        if mode == 3:
            raise ValueError(
                f"channel {i}: invalid mode bits (Flags=0x{flags:08x})")

        up_buffers.append(ChannelDesc(
            index=i,
            desc_addr=base_addr + desc_offset,
            name_ptr=name_ptr,
            p_buffer=p_buffer,
            size=size,
            initial_wr_off=wr_off,
            initial_rd_off=rd_off,
            flags_mode=mode,
        ))

    return ParsedCB(
        cb_addr=base_addr,
        max_up_buffers=max_up,
        max_down_buffers=max_down,
        up_buffers=up_buffers,
    )


def _compute_ring_read(wr_off, rd_off, size):
    """Compute the byte slices to read from a SEGGER RTT ring buffer.

    Returns a list of (offset, length) tuples ordered for sequential reads.
    At most 2 entries; one before wrap, one after. Empty list means no data.

    SEGGER ring semantics: WrOff == RdOff means empty (one byte is reserved
    to disambiguate full vs empty). Callers never see "full buffer" when
    wr == rd; they see "no data" and skip the writeback.
    """
    if wr_off == rd_off:
        return []
    if wr_off > rd_off:
        return [(rd_off, wr_off - rd_off)]
    # Wrapped: tail of buffer first, then head from 0.
    tail = (rd_off, size - rd_off)
    if wr_off == 0:
        return [tail]
    return [tail, (0, wr_off)]


class TargetResetError(Exception):
    """Raised when the target's RdOff no longer matches our tracked value.

    Signal to the caller that the target has been reset (or another tool
    wrote RdOff externally). The session must be torn down and a fresh
    attach() performed to pick up the new RTT control block state.
    """
    def __init__(self, channel_index, expected, actual):
        super().__init__(
            f"channel {channel_index}: RdOff mismatch: expected {expected}, "
            f"target reports {actual}. Target reset detected."
        )
        self.channel_index = channel_index
        self.expected = expected
        self.actual = actual


class TransientSwdReadError(Exception):
    """Raised by read_channel when the J-Link DLL returns a suspicious-success
    result (out-of-range offsets). The outer loop's classifier treats this as
    a transient error and applies the time-based grace window before escalating
    to a full reconnect.
    """
    pass


class DirectMemoryRttSession:
    """RTT session via direct target memory reads (no libjlinkarm RTT API).

    Bypasses SEGGER's host-side tracked_RdOff cache. Detects target resets
    via the last_written_rd_off pattern: after each writeback of RdOff, we
    remember the value. On the next poll, if the target's RdOff differs from
    what we wrote, the target reset (firmware re-init zeroed RdOff). We raise
    TargetResetError and the caller re-attaches.
    """

    def __init__(self, jlink):
        self._jlink = jlink
        self.cb_addr = None
        self.channels = []                  # list[ChannelDesc]
        self._last_written_rd_off = {}      # channel_index -> int

    def attach(self, search_ranges):
        """Scan target memory for the RTT control block and parse it.

        Args:
            search_ranges: list of (start_addr, length) tuples bounding the
                RAM regions to scan for the SEGGER RTT magic.

        Raises:
            ValueError if the magic is not found, or if multiple matches are
            present (caller must tighten the search range). Also reraises
            validation errors from _parse_cb.
        """
        all_matches = []
        for start, length in search_ranges:
            buf = bytes(self._jlink.memory_read(start, length))
            for offset in _scan_for_magic(buf):
                all_matches.append(start + offset)

        if not all_matches:
            raise ValueError(
                f"RTT control block not found in scanned ranges: {search_ranges}")
        if len(all_matches) > 1:
            addrs = [hex(a) for a in all_matches]
            raise ValueError(
                f"multiple RTT control block matches at {addrs}. "
                f"Set logscope.jlink.rttSearchRanges to a tighter range."
            )

        cb_addr = all_matches[0]

        header = bytes(self._jlink.memory_read(cb_addr, CB_HEADER_SIZE))
        max_up, max_down = struct.unpack_from("<II", header, 16)
        if max_up > MAX_BUFFERS or max_down > MAX_BUFFERS:
            raise ValueError(
                f"CB at 0x{cb_addr:08x} has implausible buffer counts "
                f"(max_up={max_up}, max_down={max_down}); cap is {MAX_BUFFERS}."
            )

        full_size = CB_HEADER_SIZE + (max_up + max_down) * BUFFER_DESC_SIZE
        full_buf = bytes(self._jlink.memory_read(cb_addr, full_size))
        parsed = _parse_cb(full_buf, base_addr=cb_addr)

        self.cb_addr = parsed.cb_addr
        self.channels = parsed.up_buffers

        # Reset and seed the writeback tracker from parsed initial values.
        # Seeding from initial_rd_off (rather than 0) avoids false-positive
        # reset detection on the very first poll, and seeding fresh each call
        # ensures a re-attach after a real reset starts from the new state.
        self._last_written_rd_off = {}
        for ch in self.channels:
            self._last_written_rd_off[ch.index] = ch.initial_rd_off

    def channel_count(self):
        """Return the number of usable up-channels (skips pBuffer=0 slots)."""
        return len(self.channels)

    def channel_name(self, channel_index):
        """Dereference sName pointer; returns the string or None if unavailable."""
        ch = self._find_channel(channel_index)
        if ch.name_ptr == 0:
            return None
        try:
            buf = bytes(self._jlink.memory_read(ch.name_ptr, CHANNEL_NAME_MAX_LEN))
        except Exception as e:
            print(f"channel_name({channel_index}): memory_read failed: {e}", file=sys.stderr)
            return None
        nul = buf.find(b"\x00")
        if nul <= 0:
            return None
        return buf[:nul].decode("utf-8", errors="replace")

    def read_channel(self, channel_index):
        """Read all available data from the given up-channel.

        A single memory_read32 call to fetch (WrOff, RdOff); any exception
        propagates to the caller. The outer poll loop is the retry mechanism:
        on a transient SWD glitch we keep polling, and a time-based grace
        window decides when to escalate to a full reconnect. This mirrors
        probe-rs's approach and avoids burning a fixed retry budget during
        the multi-second SWD downtime that follows an nRF54L15 hardware reset.

        The suspicious-success guard still applies: when the J-Link DLL returns
        out-of-range offsets without raising (a behavior observed during reset
        windows), we surface TransientSwdReadError so the outer loop's
        classifier treats it as transient.
        """
        ch = self._find_channel(channel_index)
        wr_rd_addr = ch.desc_addr + BUFFER_DESC_WROFF_OFFSET

        wr_off, rd_off = self._jlink.memory_read32(wr_rd_addr, 2)

        # Suspicious-success guard: the J-Link DLL sometimes returns zero-
        # filled or stale buffer data during the reset window without raising.
        # Raise TransientSwdReadError so the outer loop treats this as a
        # transient error subject to the time-based grace window.
        if wr_off >= ch.size or rd_off >= ch.size:
            raise TransientSwdReadError(
                f"channel {channel_index}: offsets out of range "
                f"(wr={wr_off}, rd={rd_off}, size={ch.size})"
            )

        # Reset detection: did the target overwrite our last RdOff?
        expected = self._last_written_rd_off.get(ch.index, ch.initial_rd_off)
        if rd_off != expected:
            raise TargetResetError(ch.index, expected, rd_off)

        slices = _compute_ring_read(wr_off, rd_off, ch.size)
        if not slices:
            return b""

        data = bytearray()
        for offset, length in slices:
            chunk = bytes(self._jlink.memory_read(ch.p_buffer + offset, length))
            data.extend(chunk)

        new_rd_off = (rd_off + len(data)) % ch.size
        rd_off_addr = ch.desc_addr + BUFFER_DESC_RDOFF_OFFSET
        self._jlink.memory_write32(rd_off_addr, [new_rd_off])
        self._last_written_rd_off[ch.index] = new_rd_off

        return bytes(data)

    def _find_channel(self, channel_index):
        for ch in self.channels:
            if ch.index == channel_index:
                return ch
        raise ValueError(f"no channel with index {channel_index}")


def _install_orphan_watcher():
    """Start a daemon thread that exits this process if our parent dies.

    When VS Code reloads its window, the extension host is torn down. The
    extension's disconnect() tries to send SIGTERM to this helper, but on
    rare paths that signal doesn't arrive (extension host crashed, kill
    queued but never delivered, etc.). When that happens, this helper is
    re-parented to init (PID 1 on Unix) and silently continues holding the
    SEGGER J-Link probe, blocking any subsequent LogScope session from
    reading log data.

    Defense-in-depth: poll our parent PID every 2 seconds. If it changes
    (or becomes 1), we've been orphaned — exit immediately so the J-Link
    is released.

    Windows note: process reparenting works differently on Windows
    (orphaned children don't get a stable PID 1 parent), so this watcher
    is a no-op there. Windows orphan cleanup is tracked as future work.
    """
    if sys.platform == "win32":
        return

    initial_ppid = os.getppid()

    def _watch():
        while True:
            time.sleep(2)
            try:
                current_ppid = os.getppid()
            except Exception:
                continue
            if current_ppid != initial_ppid or current_ppid == 1:
                # Re-parented to init — extension host is gone. Bail out.
                # Skip cleanup (calling jlink.close() from a daemon thread
                # while the main thread is mid-rtt_read can deadlock); the
                # OS releases USB handles on process exit.
                print(f"Parent process died (ppid {initial_ppid} -> {current_ppid}); exiting", file=sys.stderr)
                try:
                    sys.stderr.flush()
                except Exception:
                    pass
                os._exit(0)

    t = threading.Thread(target=_watch, daemon=True, name="logscope-orphan-watcher")
    t.start()


def _install_sigterm_handler():
    """Exit cleanly on SIGTERM so the extension's disconnect() path produces
    a fast, deterministic shutdown without leaving the J-Link held."""

    def _handler(signum, frame):
        try:
            print(f"Received signal {signum}; exiting", file=sys.stderr)
            sys.stderr.flush()
        except Exception:
            pass
        os._exit(0)

    try:
        signal.signal(signal.SIGTERM, _handler)
    except Exception:
        # Some Python builds restrict signal registration; not fatal.
        pass


def _wait_for_rtt_control_block(jlink):
    """Poll until the RTT control block is found. Returns number of up-buffers or 0."""
    for _ in range(50):
        try:
            num_up = jlink.rtt_get_num_up_buffers()
            if num_up > 0:
                return num_up
        except Exception:
            pass
        time.sleep(0.1)
    return 0


def _find_newest_jlink_dll():
    """Find the newest J-Link DLL on the system.

    pylink defaults to the first DLL it finds (alphabetically), which may be
    an old version missing support for newer chips (e.g., nRF54L15). This
    function scans SEGGER install directories and returns the newest DLL path.
    Returns None if no DLL is found (pylink will use its own default search).
    """
    import glob
    import re

    if sys.platform == "win32":
        search_dirs = [
            os.path.join(os.environ.get("ProgramFiles", "C:\\Program Files"), "SEGGER"),
            os.path.join(os.environ.get("ProgramFiles(x86)", "C:\\Program Files (x86)"), "SEGGER"),
        ]
        dll_name = "JLink_x64.dll"
    elif sys.platform == "darwin":
        search_dirs = ["/Applications/SEGGER"]
        dll_name = "libjlinkarm.dylib"
    else:
        # Linux — typically a single install, pylink handles it fine
        return None

    candidates = []
    for base in search_dirs:
        if not os.path.isdir(base):
            continue
        for entry in os.listdir(base):
            dll_path = os.path.join(base, entry, dll_name)
            if os.path.isfile(dll_path):
                # Extract version from directory name (e.g., "JLink_V924a" → "924a")
                m = re.search(r"V(\d+)(\w*)", entry)
                if m:
                    # Sort by numeric part, then alpha suffix
                    candidates.append((int(m.group(1)), m.group(2), dll_path))

    if not candidates:
        return None

    # Pick the highest version
    candidates.sort(reverse=True)
    return candidates[0][2]


def _create_jlink():
    """Create a pylink.JLink instance using the newest available J-Link DLL."""
    import pylink
    dll_path = _find_newest_jlink_dll()
    if dll_path:
        print(f"Using J-Link DLL: {dll_path}", file=sys.stderr)
        sys.stderr.flush()
        return pylink.JLink(lib=pylink.Library(dllpath=dll_path))
    return pylink.JLink()


def _open_jlink(jlink, serial_no=None):
    """Open a J-Link probe and suppress all DLL dialog boxes.

    disable_dialog_boxes() uses JLINK_ExecCommand which only works AFTER
    JLINKARM_Open(). Calling it before open() silently fails, leaving dialogs
    enabled. This wrapper ensures the correct order: open first, then suppress.
    """
    if serial_no:
        jlink.open(serial_no=serial_no)
    else:
        jlink.open()
    jlink.disable_dialog_boxes()


def run_pylink_classic(device_or_addr, poll_ms, serial_no=None):
    """Fast path: native J-Link RTT via pylink. Works with any J-Link device."""
    import pylink

    # Pre-check: SEGGER J-Link Software must be installed for libjlinkarm to load.
    if sys.platform in ("darwin", "win32") and _find_newest_jlink_dll() is None:
        install_path = "/Applications/SEGGER/" if sys.platform == "darwin" else r"C:\Program Files\SEGGER\\"
        print(
            f"ERROR: SEGGER J-Link Software not found at {install_path}. "
            f"Install the J-Link Software and Documentation Pack from "
            f"https://www.segger.com/downloads/jlink and restart VS Code.",
            file=sys.stderr,
        )
        sys.stderr.flush()
        sys.exit(5)

    jlink = _create_jlink()

    # Check for connected probes BEFORE opening — otherwise the J-Link SDK
    # pops up a native dialog asking about TCP/IP connection.
    if not jlink.connected_emulators():
        print("ERROR: No J-Link probes found. Connect a device via USB and try again.", file=sys.stderr)
        sys.stderr.flush()
        sys.exit(3)

    # Pass serial number to avoid probe selection dialog when multiple probes are connected
    if serial_no:
        print(f"Opening J-Link probe SN: {serial_no}", file=sys.stderr)
        sys.stderr.flush()
    _open_jlink(jlink, serial_no=serial_no)

    # If it looks like a hex address, it's the nrfutil fallback format.
    # For pylink, we need a device name. Default to Cortex-M33 if address given.
    if device_or_addr.startswith("0x"):
        device = "Cortex-M33"
    else:
        device = device_or_addr

    # Explicitly configure SWD interface and a safe default speed before connect.
    # J-Link defaults to JTAG (or whatever was last used) which causes connect()
    # to "succeed" with a partial session on SWD-only boards (STM32, NXP, most
    # modern Cortex-M targets). Setting SWD explicitly fixes "Target is not
    # connected" errors on non-Nordic boards.
    try:
        jlink.set_tif(pylink.enums.JLinkInterfaces.SWD)
        print("Interface: SWD", file=sys.stderr)
        sys.stderr.flush()
    except Exception as e:
        print(f"Warning: could not set SWD interface: {e}", file=sys.stderr)
        sys.stderr.flush()

    try:
        jlink.set_speed(4000)  # 4 MHz — safe default for all Cortex-M
        print("Speed: 4000 kHz", file=sys.stderr)
        sys.stderr.flush()
    except Exception as e:
        print(f"Warning: could not set speed: {e}", file=sys.stderr)
        sys.stderr.flush()

    try:
        jlink.connect(device)
    except Exception as e:
        print(f"ERROR: J-Link connect to '{device}' failed: {e}", file=sys.stderr)
        print(f"Hint: If your board uses a specific chip (e.g., STM32H743II, nRF54L15), set", file=sys.stderr)
        print(f"  \"logscope.jlink.device\" in VS Code settings to the exact chip name.", file=sys.stderr)
        sys.stderr.flush()
        sys.exit(1)

    # Verify the connection is actually established before querying target state.
    # connect() can silently return on some targets without establishing a real
    # session. target_connected() uses the same underlying IsConnected() check
    # that halted() uses, so we fail fast with a better message if it's wrong.
    if not jlink.target_connected():
        print(f"ERROR: J-Link reports no target connection after connect('{device}').", file=sys.stderr)
        print(f"  Possible causes:", file=sys.stderr)
        print(f"  1. Device name '{device}' doesn't match your target chip. Try the exact", file=sys.stderr)
        print(f"     part number (e.g., STM32H743II) in \"logscope.jlink.device\".", file=sys.stderr)
        print(f"  2. Target board is not powered or is held in reset.", file=sys.stderr)
        print(f"  3. SWD/SWO pins are not connected to the J-Link probe.", file=sys.stderr)
        sys.stderr.flush()
        sys.exit(1)

    print(f"J-Link connected to {device}, CPU halted: {jlink.halted()}", file=sys.stderr)

    # If CPU is halted (shouldn't be with connect), resume it
    if jlink.halted():
        jlink.restart()
        print("Resumed CPU", file=sys.stderr)

    # Set RTT search range — critical for generic core names (Cortex-M33 etc.)
    # where J-Link doesn't know the RAM layout automatically.
    # Default: 0x20000000 0x80000 (512KB, covers most ARM Cortex-M devices)
    rtt_ranges = os.environ.get("LOGSCOPE_RTT_SEARCH_RANGES", "0x20000000 0x80000")
    jlink.exec_command(f"SetRTTSearchRanges {rtt_ranges}")
    print(f"RTT search range: {rtt_ranges}", file=sys.stderr)

    # Start RTT
    jlink.rtt_start()
    print("RTT started, waiting for control block...", file=sys.stderr)
    sys.stderr.flush()

    # Wait for RTT to find the control block (up to 5 seconds)
    num_up = _wait_for_rtt_control_block(jlink)
    if num_up == 0:
        print("ERROR: No RTT control block found. The J-Link connected to the target but the firmware does not appear to have SEGGER RTT enabled.", file=sys.stderr)
        jlink.rtt_stop()
        jlink.close()
        sys.exit(2)

    has_hci = num_up >= 2
    print(f"RTT_READY buffers={num_up} hci={'yes' if has_hci else 'no'}", file=sys.stderr)
    sys.stderr.flush()

    stdout = os.fdopen(sys.stdout.fileno(), "wb", 0)
    poll_interval = poll_ms / 1000.0
    consecutive_errors = 0
    last_data_time = time.monotonic()
    # Silence-based recovery: triggers a host-side RTT restart when no data
    # has been received for this many seconds. Quiet devices (BLE peripherals
    # advertising and waiting for connections, sensors logging once a minute,
    # etc.) routinely go 30s+ without logs, so the default is generous. Set
    # via LOGSCOPE_RTT_SILENCE_THRESHOLD env var; pass 0 to disable entirely.
    # Issue #17: prior 3.0s default caused continuous reconnect loops on
    # quiet devices because we used to escalate silence → full_reconnect()
    # (which halts the target). Now we only ever do restart_rtt() on silence
    # — full_reconnect() is reserved for actual RTT read errors.
    try:
        SILENCE_THRESHOLD = float(os.environ.get("LOGSCOPE_RTT_SILENCE_THRESHOLD", "30"))
    except ValueError:
        SILENCE_THRESHOLD = 30.0
    reconnect_stage = 0  # 0=normal, 1=tried RTT restart (silence path stops here)
    reconnect_attempts = 0
    MAX_RECONNECT_ATTEMPTS = 3  # exit after this many failed full reconnects (read-error path only)

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
        num_up = _wait_for_rtt_control_block(jlink)
        if num_up > 0:
            has_hci = num_up >= 2
            print(f"RTT restarted OK, buffers={num_up}", file=sys.stderr)
            sys.stderr.flush()
            return True
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
            _open_jlink(jlink, serial_no=serial_no)
            jlink.connect(device)
            if jlink.halted():
                jlink.restart()
            jlink.rtt_start()
        except Exception as e:
            print(f"Reconnect failed: {e}", file=sys.stderr)
            sys.stderr.flush()
            return False
        num_up = _wait_for_rtt_control_block(jlink)
        if num_up > 0:
            has_hci = num_up >= 2
            print(f"Reconnected OK, buffers={num_up}", file=sys.stderr)
            sys.stderr.flush()
            return True
        print("Full reconnect failed — control block not found", file=sys.stderr)
        sys.stderr.flush()
        return False

    def read_channels():
        """Read available RTT channels. Returns True if any data was received."""
        got_data = False
        data = jlink.rtt_read(0, 4096)
        if data:
            write_frame(0, bytes(data))
            got_data = True
        if has_hci:
            hci_data = jlink.rtt_read(1, 4096)
            if hci_data:
                write_frame(1, bytes(hci_data))
                got_data = True
        return got_data

    def check_probe_connected():
        """Check if the probe is still physically connected. Exits if not."""
        try:
            probes = jlink.connected_emulators()
            probe_serials = [e.SerialNumber for e in probes]
            if serial_no and serial_no not in probe_serials:
                print(f"ERROR: Probe SN {serial_no} no longer connected (found: {probe_serials})", file=sys.stderr)
                sys.stderr.flush()
                try:
                    jlink.close()
                except Exception:
                    pass
                sys.exit(4)
            elif not probes:
                print("ERROR: No J-Link probes connected", file=sys.stderr)
                sys.stderr.flush()
                try:
                    jlink.close()
                except Exception:
                    pass
                sys.exit(4)
        except Exception:
            pass  # can't check — fall through to reconnect logic

    def handle_silence(silence, stage):
        """Handle silence timeout by attempting a host-side RTT restart.
        Returns new stage.

        Silence is NOT a signal of failure — it's a signal that the device
        has nothing to log. So this path never escalates to full_reconnect()
        (which halts the target and breaks active BLE connections, sensor
        timing, etc.). Real RTT failures are caught by handle_read_error()
        below, which is the appropriate place for destructive recovery.

        See issue #17 for the original report.
        """
        if silence <= SILENCE_THRESHOLD or SILENCE_THRESHOLD <= 0:
            return stage

        # One lightweight host-side restart per silence window. If the
        # control block moved (e.g., firmware update mid-session), this
        # picks it up. Doesn't touch the target.
        if stage == 0:
            check_probe_connected()  # cheap unplug check, doesn't touch target
            restart_rtt()
            return 1

        # Already restarted this silence window — wait for data instead of
        # spamming restarts. Stage resets to 0 once any data arrives.
        return stage

    def handle_read_error(err, error_count):
        """Handle an RTT read exception. Returns updated consecutive error count."""
        nonlocal reconnect_attempts
        error_count += 1
        if error_count <= 2:
            print(f"RTT read error #{error_count}: {err}", file=sys.stderr)
            sys.stderr.flush()
        if error_count >= 5:
            if not full_reconnect():
                reconnect_attempts += 1
                if reconnect_attempts >= MAX_RECONNECT_ATTEMPTS:
                    print("ERROR: Device disconnected — giving up after repeated failures", file=sys.stderr)
                    sys.stderr.flush()
                    try:
                        jlink.close()
                    except Exception:
                        pass
                    sys.exit(4)
            else:
                reconnect_attempts = 0
            return 0
        return error_count

    # Monitor stdin for "quit" command (graceful shutdown from VS Code)
    import threading
    quit_requested = threading.Event()
    def _watch_stdin():
        try:
            for line in sys.stdin:
                if line.strip() == "quit":
                    quit_requested.set()
                    return
        except Exception:
            pass
    stdin_thread = threading.Thread(target=_watch_stdin, daemon=True)
    stdin_thread.start()

    while not quit_requested.is_set():
        try:
            got_data = read_channels()

            if got_data:
                last_data_time = time.monotonic()
                consecutive_errors = 0
                reconnect_stage = 0
            else:
                silence = time.monotonic() - last_data_time
                new_stage = handle_silence(silence, reconnect_stage)
                # Only reset the silence counter when we actually took an
                # action (stage advanced). If we're already at stage 1 and
                # the device stays quiet, we want last_data_time to stay
                # put — we don't want to keep firing restart_rtt on a
                # device that's legitimately silent for an extended period.
                if new_stage != reconnect_stage:
                    last_data_time = time.monotonic()
                reconnect_stage = new_stage

        except BrokenPipeError:
            break
        except Exception as e:
            consecutive_errors = handle_read_error(e, consecutive_errors)
            if consecutive_errors == 0:
                last_data_time = time.monotonic()
                reconnect_stage = 0
            continue

        time.sleep(poll_interval)

    jlink.rtt_stop()
    jlink.close()


def run_pylink_direct(device_or_addr, poll_ms, serial_no=None):
    """Direct-memory RTT path. Bypasses libjlinkarm's tracked_RdOff cache.

    Mirrors run_pylink_classic's external contract: same RTT_READY line,
    same framed-stdout protocol, same silence/quit/error semantics. Detects
    target resets via the DirectMemoryRttSession's last_written_rd_off
    tracking and transparently re-attaches without halting the CPU.
    """
    import pylink

    # Pre-check: SEGGER J-Link Software must be installed for libjlinkarm to load.
    if sys.platform in ("darwin", "win32") and _find_newest_jlink_dll() is None:
        install_path = "/Applications/SEGGER/" if sys.platform == "darwin" else r"C:\Program Files\SEGGER\\"
        print(
            f"ERROR: SEGGER J-Link Software not found at {install_path}. "
            f"Install the J-Link Software and Documentation Pack from "
            f"https://www.segger.com/downloads/jlink and restart VS Code.",
            file=sys.stderr,
        )
        sys.stderr.flush()
        sys.exit(5)

    jlink = _create_jlink()

    # Check for connected probes BEFORE opening: otherwise the J-Link SDK
    # pops up a native dialog asking about TCP/IP connection.
    if not jlink.connected_emulators():
        print("ERROR: No J-Link probes found. Connect a device via USB and try again.", file=sys.stderr)
        sys.stderr.flush()
        sys.exit(3)

    if serial_no:
        print(f"Opening J-Link probe SN: {serial_no}", file=sys.stderr)
        sys.stderr.flush()
    _open_jlink(jlink, serial_no=serial_no)

    # If it looks like a hex address, it's the nrfutil fallback format.
    # For pylink, we need a device name. Default to Cortex-M33 if address given.
    if device_or_addr.startswith("0x"):
        device = "Cortex-M33"
    else:
        device = device_or_addr

    # Explicitly configure SWD interface and a safe default speed before connect.
    try:
        jlink.set_tif(pylink.enums.JLinkInterfaces.SWD)
        print("Interface: SWD", file=sys.stderr)
        sys.stderr.flush()
    except Exception as e:
        print(f"Warning: could not set SWD interface: {e}", file=sys.stderr)
        sys.stderr.flush()

    try:
        jlink.set_speed(4000)
        print("Speed: 4000 kHz", file=sys.stderr)
        sys.stderr.flush()
    except Exception as e:
        print(f"Warning: could not set speed: {e}", file=sys.stderr)
        sys.stderr.flush()

    try:
        jlink.connect(device)
    except Exception as e:
        print(f"ERROR: J-Link connect to '{device}' failed: {e}", file=sys.stderr)
        print(f"Hint: If your board uses a specific chip (e.g., STM32H743II, nRF54L15), set", file=sys.stderr)
        print(f"  \"logscope.jlink.device\" in VS Code settings to the exact chip name.", file=sys.stderr)
        sys.stderr.flush()
        sys.exit(1)

    if not jlink.target_connected():
        print(f"ERROR: J-Link reports no target connection after connect('{device}').", file=sys.stderr)
        print(f"  Possible causes:", file=sys.stderr)
        print(f"  1. Device name '{device}' doesn't match your target chip. Try the exact", file=sys.stderr)
        print(f"     part number (e.g., STM32H743II) in \"logscope.jlink.device\".", file=sys.stderr)
        print(f"  2. Target board is not powered or is held in reset.", file=sys.stderr)
        print(f"  3. SWD/SWO pins are not connected to the J-Link probe.", file=sys.stderr)
        sys.stderr.flush()
        sys.exit(1)

    print(f"J-Link connected to {device}, CPU halted: {jlink.halted()}", file=sys.stderr)

    if jlink.halted():
        jlink.restart()
        print("Resumed CPU", file=sys.stderr)
    sys.stderr.flush()

    # Parse search ranges from env (format: "<addr> <len> [<addr> <len> ...]")
    raw_ranges = os.environ.get("LOGSCOPE_RTT_SEARCH_RANGES", "0x20000000 0x80000")
    parts = raw_ranges.split()
    search_ranges = []
    try:
        for i in range(0, len(parts), 2):
            search_ranges.append((int(parts[i], 16), int(parts[i + 1], 16)))
    except (ValueError, IndexError):
        print(f"ERROR: Invalid LOGSCOPE_RTT_SEARCH_RANGES: '{raw_ranges}'", file=sys.stderr)
        sys.stderr.flush()
        try:
            jlink.close()
        except Exception:
            pass
        sys.exit(1)
    print(f"RTT search range: {raw_ranges}", file=sys.stderr)
    sys.stderr.flush()

    # Attach with retry (firmware may not have called SEGGER_RTT_Init yet).
    session = DirectMemoryRttSession(jlink)
    attach_deadline = time.monotonic() + 5.0
    while True:
        try:
            session.attach(search_ranges)
            break
        except ValueError as e:
            if time.monotonic() >= attach_deadline:
                print(f"ERROR: No RTT control block found: {e}", file=sys.stderr)
                sys.stderr.flush()
                try:
                    jlink.close()
                except Exception:
                    pass
                sys.exit(2)
            time.sleep(0.1)

    num_up = session.channel_count()
    has_hci = num_up >= 2
    print(f"RTT_READY buffers={num_up} hci={'yes' if has_hci else 'no'}", file=sys.stderr)
    sys.stderr.flush()

    def emit_channel_names():
        """Emit CHANNEL_NAME lines for the current session. Called on initial
        attach and after re-attach so the sidebar reflects post-reset firmware.
        """
        for ch in session.channels:
            name = session.channel_name(ch.index)
            if name:
                print(f"CHANNEL_NAME {ch.index} {name}", file=sys.stderr)
        sys.stderr.flush()

    # Surface channel names for the UI. Task 6 consumes CHANNEL_NAME on the TS side.
    emit_channel_names()

    stdout = os.fdopen(sys.stdout.fileno(), "wb", 0)
    poll_interval = poll_ms / 1000.0
    last_data_time = time.monotonic()
    try:
        SILENCE_THRESHOLD = float(os.environ.get("LOGSCOPE_RTT_SILENCE_THRESHOLD", "30"))
    except ValueError:
        SILENCE_THRESHOLD = 30.0

    # Time-based grace before escalating transient SWD errors to a full
    # reconnect. Hardware testing on nRF54L15 showed the SWD bus stays
    # glitched for ~1 second after a hardware reset, so a count-based or
    # short-budget retry escalates prematurely. Mirrors probe-rs's pattern:
    # let the poll cadence be the retry, only escalate if errors persist.
    SEVERE_ERROR_GRACE_SEC = 0.3

    def write_frame(channel, data):
        """Write framed data: [channel:1][length:4 LE][data:N]"""
        stdout.write(bytes([channel]) + struct.pack('<I', len(data)) + data)

    reconnect_attempts = 0
    MAX_RECONNECT_ATTEMPTS = 3

    def full_reconnect():
        """Close + reopen the J-Link probe, then re-attach the session.
        Mirrors run_pylink_classic's full_reconnect() for transient USB/SWD glitches.
        """
        print("Full J-Link reconnect...", file=sys.stderr)
        sys.stderr.flush()
        t0 = time.monotonic()
        try:
            jlink.close()
        except Exception:
            pass
        time.sleep(0.5)
        try:
            _open_jlink(jlink, serial_no=serial_no)
            jlink.connect(device)
            if jlink.halted():
                jlink.restart()
        except Exception as reconnect_err:
            elapsed_ms = int((time.monotonic() - t0) * 1000)
            print(f"Reconnect failed after {elapsed_ms} ms: {reconnect_err}", file=sys.stderr)
            sys.stderr.flush()
            return False
        try:
            session.attach(search_ranges)
        except Exception as attach_err:
            elapsed_ms = int((time.monotonic() - t0) * 1000)
            print(f"Reconnect re-attach failed after {elapsed_ms} ms: {attach_err}", file=sys.stderr)
            sys.stderr.flush()
            return False
        elapsed_ms = int((time.monotonic() - t0) * 1000)
        print(f"Reconnected OK in {elapsed_ms} ms, buffers={session.channel_count()}", file=sys.stderr)
        sys.stderr.flush()
        emit_channel_names()
        return True

    def cheap_reinit():
        """Re-init SWD by re-running jlink.connect(device) without closing the
        J-Link USB handle. Faster than full_reconnect (no close+reopen).
        Returns True if SWD is responsive after the re-init and session.attach
        succeeds. Logs elapsed time so we can compare against full_reconnect on
        real hardware.
        """
        print("Cheap re-init (jlink.connect without close)...", file=sys.stderr)
        sys.stderr.flush()
        t0 = time.monotonic()
        try:
            jlink.connect(device)
            if jlink.halted():
                jlink.restart()
        except Exception as e:
            elapsed_ms = int((time.monotonic() - t0) * 1000)
            print(f"Cheap re-init connect() failed after {elapsed_ms} ms: {e}",
                  file=sys.stderr)
            sys.stderr.flush()
            return False
        try:
            session.attach(search_ranges)
        except Exception as e:
            elapsed_ms = int((time.monotonic() - t0) * 1000)
            print(f"Cheap re-init session.attach() failed after {elapsed_ms} ms: {e}",
                  file=sys.stderr)
            sys.stderr.flush()
            return False
        elapsed_ms = int((time.monotonic() - t0) * 1000)
        print(f"Cheap re-init OK in {elapsed_ms} ms, buffers={session.channel_count()}",
              file=sys.stderr)
        sys.stderr.flush()
        emit_channel_names()
        return True

    quit_requested = threading.Event()

    def _watch_stdin():
        try:
            for line in sys.stdin:
                if line.strip() == "quit":
                    quit_requested.set()
                    return
        except Exception:
            pass

    stdin_thread = threading.Thread(target=_watch_stdin, daemon=True)
    stdin_thread.start()

    # Time-based recovery state. first_error_time is set on the FIRST error
    # in a streak (and cleared on any successful read or successful recovery);
    # only escalate to full_reconnect when the streak exceeds the grace window.
    first_error_time = None

    while not quit_requested.is_set():
        got_data = False
        try:
            for ch in session.channels:
                data = session.read_channel(ch.index)
                if data:
                    write_frame(ch.index, data)
                    got_data = True
        except TargetResetError as e:
            # Cheap path: read succeeded but RdOff diverged from our tracked
            # value. Re-attach without halting the CPU; the CB is in BSS so
            # the address is stable, but re-scan to be safe.
            print(f"Target reset detected: {e}", file=sys.stderr)
            sys.stderr.flush()
            try:
                session.attach(search_ranges)
                print(f"Reconnected OK, buffers={session.channel_count()}", file=sys.stderr)
                sys.stderr.flush()
                emit_channel_names()
                first_error_time = None
                last_data_time = time.monotonic()
                reconnect_attempts = 0
            except Exception as reattach_err:
                print(f"Re-attach after reset failed: {reattach_err}", file=sys.stderr)
                sys.stderr.flush()
                # Don't immediately reset first_error_time; let the next
                # poll's exception path apply the time-based grace.
            continue
        except BrokenPipeError:
            break
        except Exception as e:
            kind = _classify_jlink_error(e)

            if kind == "probe_fatal":
                print(f"Probe error ({type(e).__name__}): {e}; reconnecting...", file=sys.stderr)
                sys.stderr.flush()
                if not full_reconnect():
                    reconnect_attempts += 1
                    if reconnect_attempts >= MAX_RECONNECT_ATTEMPTS:
                        print("ERROR: full reconnect failed repeatedly; giving up", file=sys.stderr)
                        sys.stderr.flush()
                        try:
                            jlink.close()
                        except Exception:
                            pass
                        sys.exit(4)
                else:
                    reconnect_attempts = 0
                    last_data_time = time.monotonic()
                    first_error_time = None
                continue

            if kind == "target_state":
                # Surface but don't auto-recover; sleep extra and continue
                # polling. Only log the first occurrence so we don't spam.
                if first_error_time is None:
                    print(f"Target-state error: {e}", file=sys.stderr)
                    sys.stderr.flush()
                    first_error_time = time.monotonic()
                time.sleep(poll_interval * 2)
                continue

            # Transient (default): keep polling; only escalate after the
            # grace window expires. Log only the first error in the streak
            # to avoid 50+ "RTT read error" lines during a 1-second SWD
            # downtime on nRF54L15-style hardware resets.
            now = time.monotonic()
            if first_error_time is None:
                first_error_time = now
                print(f"RTT read error: {e}", file=sys.stderr)
                sys.stderr.flush()
            elif now - first_error_time > SEVERE_ERROR_GRACE_SEC:
                print(
                    f"Read errors persisted >{SEVERE_ERROR_GRACE_SEC}s; "
                    f"trying cheap re-init...",
                    file=sys.stderr,
                )
                sys.stderr.flush()
                if cheap_reinit():
                    reconnect_attempts = 0
                    last_data_time = time.monotonic()
                else:
                    print("Cheap re-init failed; escalating to full reconnect...", file=sys.stderr)
                    sys.stderr.flush()
                    if not full_reconnect():
                        reconnect_attempts += 1
                        if reconnect_attempts >= MAX_RECONNECT_ATTEMPTS:
                            print("ERROR: full reconnect failed repeatedly; giving up", file=sys.stderr)
                            sys.stderr.flush()
                            try:
                                jlink.close()
                            except Exception:
                                pass
                            sys.exit(4)
                    else:
                        reconnect_attempts = 0
                        last_data_time = time.monotonic()
                first_error_time = None
            time.sleep(poll_interval)
            continue

        if got_data:
            last_data_time = time.monotonic()
            first_error_time = None
            reconnect_attempts = 0
        else:
            # In direct-memory mode silence is just silence: no host-side
            # restart is needed (the legacy path had to restart to re-sync
            # libjlinkarm's tracked_RdOff, which is now bypassed entirely).
            silence = time.monotonic() - last_data_time
            if SILENCE_THRESHOLD > 0 and silence > SILENCE_THRESHOLD:
                last_data_time = time.monotonic()  # reset timer to avoid log spam

        time.sleep(poll_interval)

    try:
        jlink.close()
    except Exception:
        pass


def _parse_swd_read_line(line):
    """Parse one hex-dump line from nrfutil output. Returns list of word bytes."""
    parts = line.split("|")[0].split()
    result = bytearray()
    for word_hex in parts[1:]:
        try:
            word = int(word_hex, 16)
            result.extend(struct.pack("<I", word))
        except ValueError:
            break
    return result


def _swd_read_chunk(nrfutil_path, addr, nbytes):
    """Run one nrfutil read command and return bytes."""
    import subprocess
    result = subprocess.run(
        [nrfutil_path, "device", "read", "--address", hex(addr),
         "--bytes", str(nbytes), "--direct"],
        capture_output=True, text=True
    )
    data = bytearray()
    for line in result.stdout.splitlines():
        if line.startswith("0x"):
            data.extend(_parse_swd_read_line(line))
    return bytes(data)


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
            data.extend(_swd_read_chunk(nrfutil_path, addr + offset, chunk))
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

    def read_rtt_buffer(wr_off, rd_off):
        """Read available data from the RTT ring buffer."""
        if wr_off > rd_off:
            return swd_read(pbuffer + rd_off, wr_off - rd_off)
        data = swd_read(pbuffer + rd_off, buf_size - rd_off)
        if wr_off > 0:
            data += swd_read(pbuffer, wr_off)
        return data

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

            data = read_rtt_buffer(wr_off, rd_off)

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


def detect_device(nrfutil_path, serial_no=None):
    """Try to auto-detect the connected device via nrfutil."""
    import subprocess
    try:
        cmd = [nrfutil_path, "device", "device-info"]
        if serial_no:
            cmd.extend(["--serial-number", str(serial_no)])
        result = subprocess.run(
            cmd,
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


def _parse_probe_label(emu):
    """Extract a human-readable label from the J-Link emulator product string.

    Note: For on-board J-Links (OB-*), the chip in the product string is the
    DEBUGGER chip, not the target. E.g., "J-Link OB-nRF5340-NordicSemi" means
    the debugger is an nRF5340, but the target could be an nRF54L15 or anything
    else. So we return a probe description, not a target name.
    """
    try:
        product = emu.acProduct
        if isinstance(product, bytes):
            product = product.decode("utf-8", errors="replace")
        # Clean up the product string for display
        # "J-Link OB-nRF5340-NordicSemi" → "J-Link OB"
        # "J-Link EDU Mini" → "J-Link EDU Mini"
        if "OB-" in product:
            return "J-Link (On-Board)"
        return product.strip() if product.strip() else None
    except Exception:
        pass
    return None


def _get_candidate_devices(jlink):
    """Get a list of specific device names to try from the J-Link database.

    Scans the J-Link SDK's built-in device list for known target chips.
    Trying these before generic cores (Cortex-M33 etc.) lets the J-Link know
    the exact RAM layout, which is required for RTT auto-detection on newer chips.

    Includes Nordic, STM32, Silicon Labs, TI, Infineon, and NXP devices.
    """
    candidates = []
    try:
        # Priority patterns: Nordic first, then other common embedded chips.
        # Order matters: first match wins, so put most likely targets first.
        priority_patterns = [
            # Nordic (Cortex-M33 and Cortex-M4)
            "nRF54L15", "nRF54L10", "nRF54L05", "nRF54H20",
            "nRF5340", "nRF9161", "nRF9160", "nRF9151",
            "nRF52840", "nRF52833", "nRF52832",
            # STM32 (Cortex-M7, M4, M33, M0+)
            "STM32H7", "STM32F4", "STM32L4", "STM32U5",
            "STM32WB", "STM32WL", "STM32G4", "STM32F7",
            "STM32L5", "STM32H5", "STM32G0", "STM32L0",
            "STM32C0", "STM32F3", "STM32F1", "STM32F0",
            # Silicon Labs (Cortex-M33)
            "EFR32BG", "EFR32MG", "EFR32FG", "EFM32",
            # TI (Cortex-M4, M33)
            "CC2652", "CC2340", "CC1352", "CC2642",
            # Infineon / Cypress (Cortex-M4, M0+, M33)
            "CY8C6", "PSoC6", "CYW208", "CYW435",
            "XMC4", "XMC1",
            # NXP (Cortex-M33, M4, M7)
            "LPC55", "MIMXRT", "LPC54", "MK",
            # Renesas / Dialog
            "DA145", "DA146", "R7FA",
        ]
        # Valid suffixes for main application cores
        valid_suffixes = ("_M33", "_M4", "_M7", "_M0+",
                          "_XXAA", "_XXAB",
                          "VG", "VE", "VI", "ZE", "ZI", "RE", "RI")
        found = set()
        for i in range(jlink.num_supported_devices()):
            info = jlink.supported_device(i)
            name = info.name
            name_upper = name.upper()
            # Check if it has a recognizable core suffix
            has_valid_suffix = any(name_upper.endswith(s) for s in valid_suffixes)
            if not has_valid_suffix:
                continue
            for pattern in priority_patterns:
                if name.upper().startswith(pattern.upper()) and name not in found:
                    candidates.append(name)
                    found.add(name)
                    break
    except Exception:
        pass
    return candidates


def run_discover():
    """Discover connected J-Link probes and output JSON to stdout."""
    import json
    try:
        import pylink
    except ImportError:
        print(json.dumps({"error": "pylink not installed", "devices": []}))
        return

    # Pre-check: on macOS/Windows, libjlinkarm/JLink_x64.dll is required to
    # enumerate probes. If SEGGER J-Link Software isn't installed in the
    # standard location, surface an actionable error instead of letting pylink
    # fail with a confusing low-level traceback.
    if sys.platform in ("darwin", "win32"):
        if _find_newest_jlink_dll() is None:
            install_path = "/Applications/SEGGER/" if sys.platform == "darwin" else r"C:\Program Files\SEGGER\\"
            msg = (
                f"SEGGER J-Link Software not found at {install_path}. "
                f"Install the J-Link Software and Documentation Pack from "
                f"https://www.segger.com/downloads/jlink and restart VS Code."
            )
            print(f"ERROR: {msg}", file=sys.stderr)
            sys.stderr.flush()
            print(json.dumps({"error": msg, "devices": []}))
            return

    nrfutil_path = sys.argv[2] if len(sys.argv) > 2 else "nrfutil"

    try:
        jlink = _create_jlink()
        emulators = jlink.connected_emulators()
    except Exception as e:
        # J-Link DLL not found or other initialization error
        print(f"J-Link init failed: {e}", file=sys.stderr)
        print(json.dumps({"error": str(e), "devices": []}))
        return

    devices = []
    for emu in emulators:
        serial = emu.SerialNumber
        info = {"serial": serial}
        probe_label = _parse_probe_label(emu)

        # Step 1: Try nrfutil to identify this probe's target chip.
        # nrfutil runs as a subprocess with its own J-Link DLL instance, so
        # --serial-number is needed to avoid the probe selection dialog.
        target_jlink, target_friendly = detect_device(nrfutil_path, serial_no=serial)
        if target_friendly:
            info["targetName"] = target_friendly
            info["device"] = target_jlink
        else:
            # Step 2: nrfutil couldn't identify — use pylink to detect core type.
            # We connect with generic core names (Cortex-M33, Cortex-M4, etc.)
            # since jlink.connect() doesn't validate device names and can't
            # distinguish same-core devices (e.g. nRF52840 vs nRF52832).
            try:
                _open_jlink(jlink, serial_no=serial)
                for core in ["Cortex-M33", "Cortex-M4", "Cortex-M7", "Cortex-M0+"]:
                    try:
                        jlink.connect(core)
                        info["device"] = core
                        break
                    except Exception:
                        continue
                info["targetName"] = probe_label or info.get("device", "Unknown device")
                jlink.close()
            except Exception:
                info["targetName"] = probe_label or "Unknown device"
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

    # Discovery mode — just list connected probes and exit. Short-lived, no
    # orphan risk; skip the watcher.
    if device_or_addr == "discover":
        run_discover()
        return

    # Long-lived helper. Install defense-in-depth cleanup so we always release
    # the J-Link probe even when our parent extension host dies unexpectedly.
    _install_sigterm_handler()
    _install_orphan_watcher()

    poll_ms = int(sys.argv[2]) if len(sys.argv) > 2 else 20
    nrfutil_path = sys.argv[3] if len(sys.argv) > 3 else "nrfutil"
    serial_no = int(sys.argv[4]) if len(sys.argv) > 4 else None

    # Auto-detect device if requested
    if device_or_addr == "auto":
        jlink_name, friendly_name = detect_device(nrfutil_path, serial_no=serial_no)
        if jlink_name:
            print(f"DEVICE_DETECTED {friendly_name}", file=sys.stderr)
            sys.stderr.flush()
            device_or_addr = jlink_name
        else:
            # nrfutil didn't identify the device (not a Nordic chip, or nrfutil
            # not installed). Use generic core names which are safe for any target.
            # Do NOT try specific device names (e.g. nRF52832_XXAA) because
            # jlink.connect() doesn't validate the chip identity and will
            # happily connect with a wrong device name, causing target resets
            # and other issues on non-matching hardware.
            try:
                import pylink
                probe = _create_jlink()
                _open_jlink(probe, serial_no=serial_no)

                # Connect with a generic name first just to get debug access,
                # then read the CPUID register to identify the actual core.
                probe.set_tif(pylink.enums.JLinkInterfaces.SWD)
                probe.set_speed(4000)
                probe.connect("Cortex-M33")  # generic, works for initial debug access

                # CPUID register at 0xE000ED00 identifies the actual core
                CPUID_ADDR = 0xE000ED00
                cpuid = probe.memory_read32(CPUID_ADDR, 1)[0]
                part_no = (cpuid >> 4) & 0xFFF  # bits [15:4] = PartNo

                # ARM core identification from CPUID PartNo field
                CORE_MAP = {
                    0xC20: "Cortex-M0",
                    0xC60: "Cortex-M0+",
                    0xC23: "Cortex-M3",
                    0xC24: "Cortex-M4",
                    0xC27: "Cortex-M7",
                    0xD20: "Cortex-M23",
                    0xD21: "Cortex-M33",
                    0xD22: "Cortex-M55",
                    0xD23: "Cortex-M85",
                }
                detected_core = CORE_MAP.get(part_no)
                if detected_core:
                    print(f"DEVICE_DETECTED {detected_core}", file=sys.stderr)
                    print(f"CPUID: 0x{cpuid:08X}, PartNo: 0x{part_no:03X} → {detected_core}", file=sys.stderr)
                    sys.stderr.flush()
                    device_or_addr = detected_core
                else:
                    print(f"CPUID: 0x{cpuid:08X}, PartNo: 0x{part_no:03X} — unknown core, using Cortex-M33", file=sys.stderr)
                    sys.stderr.flush()
                    device_or_addr = "Cortex-M33"
                probe.close()
            except Exception:
                print("Could not auto-detect device, using Cortex-M33", file=sys.stderr)
                sys.stderr.flush()
                device_or_addr = "Cortex-M33"

    # Try pylink first (native J-Link RTT, works with any J-Link device)
    try:
        import pylink  # noqa: F401
        use_legacy = os.environ.get("LOGSCOPE_RTT_LEGACY", "0") == "1"
        if use_legacy:
            print("Using pylink (legacy libjlinkarm RTT path)", file=sys.stderr)
            sys.stderr.flush()
            run_pylink_classic(device_or_addr, poll_ms, serial_no=serial_no)
        else:
            print("Using pylink (direct-memory RTT, v0.6.0)", file=sys.stderr)
            sys.stderr.flush()
            run_pylink_direct(device_or_addr, poll_ms, serial_no=serial_no)
    except ImportError:
        print("pylink not available, falling back to nrfutil CLI", file=sys.stderr)
        sys.stderr.flush()
        run_nrfutil(device_or_addr, poll_ms, nrfutil_path)


def _exit_skip_cleanup(code):
    """Exit via os._exit() to skip Python's __cxa_finalize cleanup, which can
    trigger a libjlinkarm destructor crash (segfault in ffi_closure_SYSV_inner
    during JLINKARM_Close). os._exit() does NOT flush stdio buffers, so we must
    flush stdout and stderr explicitly first — otherwise any pending output
    (e.g. the discover-mode JSON payload) is lost when the process terminates.

    Regression note: shipped without flush in v0.5.7; user-visible symptom was
    "discover" returning silently with no JSON, manifesting as "No J-Link
    devices found" even with a probe attached. Fixed in v0.5.10 (#11)."""
    try:
        sys.stdout.flush()
    except Exception:
        pass
    try:
        sys.stderr.flush()
    except Exception:
        pass
    os._exit(code)


if __name__ == "__main__":
    try:
        main()
        _exit_skip_cleanup(0)
    except SystemExit as e:
        # sys.exit() throws SystemExit; preserve the exit code but skip cleanup
        code = e.code if isinstance(e.code, int) else (0 if e.code is None else 1)
        _exit_skip_cleanup(code)
