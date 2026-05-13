"""Hand-crafted SEGGER RTT control-block byte fixtures."""
import struct

RTT_MAGIC = b"SEGGER RTT\x00\x00\x00\x00\x00\x00"  # 16 bytes
assert len(RTT_MAGIC) == 16


def build_buffer_descriptor(name_ptr, p_buffer, size, wr_off, rd_off, flags):
    """Pack one SEGGER_RTT_BUFFER_UP/DOWN descriptor (24 bytes, little-endian u32 fields)."""
    return struct.pack("<IIIIII", name_ptr, p_buffer, size, wr_off, rd_off, flags)


def build_cb(up_buffers, down_buffers=()):
    """Build a full control block: magic + max_up + max_down + buffer descriptors."""
    return (RTT_MAGIC
            + struct.pack("<II", len(up_buffers), len(down_buffers))
            + b"".join(up_buffers)
            + b"".join(down_buffers))


def cb_one_up(p_buffer=0x20001000, size=1024, wr_off=0, rd_off=0):
    """Standard single-up-buffer CB."""
    return build_cb([build_buffer_descriptor(0, p_buffer, size, wr_off, rd_off, 0)])


def cb_with_hci(wr0=0, wr1=0):
    """Two up-buffers: channel 0 (logs) + channel 1 (HCI)."""
    return build_cb([
        build_buffer_descriptor(0, 0x20001000, 1024, wr0, 0, 0),
        build_buffer_descriptor(0, 0x20001400, 1024, wr1, 0, 0),
    ])


def cb_zero_pbuffer():
    """CB with one initialized channel + one uninitialized (pBuffer=0)."""
    return build_cb([
        build_buffer_descriptor(0, 0x20001000, 1024, 0, 0, 0),
        build_buffer_descriptor(0, 0, 0, 0, 0, 0),
    ])
