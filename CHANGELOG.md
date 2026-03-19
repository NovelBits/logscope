# Changelog

All notable changes to LogScope will be documented in this file.

## [0.1.1] — 2026-03-19

### Added
- Crash and fault detection — auto-detects hard faults, bus faults, watchdog resets, assertion failures
- Enhanced search with regex support and match highlighting
- Filter bar controls: severity toggles, module dropdown, wrap toggle, auto-scroll
- Wireshark btsnoop export (.pcap) — one-click RTT-to-Wireshark
- Deep HCI packet decoding: AD structures, encryption events, command returns, connection tracking
- Expandable HCI rows with decoded fields and hex dump (Chrome DevTools-style)
- ASCII alongside hex in decoded value fields
- Sticky column headers with timestamp toggle
- Board reset detection via boot banner
- Auto-connect on reload with last device memory
- Device discovery via J-Link probe scanning (pylink + nrfutil)
- Multi-format export: Text (.log) and JSON Lines (.jsonl)
- Novel Bits branding: logo footer, sidebar help link, status bar tooltip

### Fixed
- Keep viewer visible on disconnect — shows reconnect bar instead of welcome screen
- Unified connection bar with toggle button for stable layout
- Column alignment for expanded HCI fields and module column
- Reconnect after auto-connect saves config correctly
- Reset detection uses boot banner instead of unreliable silence threshold
- btsnoop export: correct BT Monitor header per record and epoch format

## [0.1.0] — 2026-03-18

### Added
- Initial VS Code Marketplace release
- Real-time RTT log viewing via pylink (J-Link native) with zero packet loss
- HCI trace support — interleaved Bluetooth LE packets in log viewer
- Zephyr RTOS log parsing with ANSI color stripping
- Activity Bar icon with oscilloscope waveform
- Sidebar TreeView with connection status and quick actions
- Welcome screen with device dropdown (Nordic, ST, Infineon, SiLabs, NXP, Generic)
- Board reset recovery with automatic reconnect
- Line wrap toggle and horizontal scroll
- 100K entry circular buffer
- Auto-install pylink venv on first connect
- Demo firmware samples for nRF54L15 DK

### Supported Devices
- Nordic: nRF54L15, nRF5340, nRF52840, nRF52833, nRF52832, nRF52820, nRF52810, nRF52811, nRF9160, nRF9151, nRF9161
- Generic: Any J-Link-connected Cortex-M device
