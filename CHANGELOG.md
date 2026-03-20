# Changelog

All notable changes to LogScope will be documented in this file.

## [0.2.2] — 2026-03-20

### Fixed
- Include updated changelog in marketplace listing (was missing 0.2.0/0.2.1 entries)

## [0.2.1] — 2026-03-20

### Fixed
- Fix panel showing "Disconnected" when closed and reopened during active connection

## [0.2.0] — 2026-03-20

### Added
- **Serial UART transport** — connect via USB CDC ACM or UART bridge with configurable baud rate
- **Sidebar connection controls** — transport, device, and baud rate selection via VS Code-native QuickPick flows with back navigation and step indicators
- **viewsWelcome** first-run experience with "Connect Device" and "Get Started Guide" links
- **Guided connect flow** — multi-step QuickPick: pick transport → scan devices/ports → select → connect
- **Reconnect with saved settings** — one-click reconnect from sidebar without re-picking everything
- **Change Settings** — modify individual connection settings (transport, device, baud rate) without full re-flow
- **View title toolbar icons** — connect/disconnect, open viewer, export, and settings gear always accessible
- **Get Started walkthrough** — 3-step onboarding with themed SVG illustrations
- **UART port labels** — port picker shows "J-Link (Port 1)" style labels with manufacturer, serial number, and port path
- **HCI packet and error counts** in sidebar session info
- UART demo firmware sample for nRF54L15 DK

### Changed
- Connection controls moved from webview welcome screen to VS Code sidebar (TreeView + QuickPick pattern)
- Webview panel is now a pure log viewer — no more welcome/viewer state toggle
- Logs stay visible during disconnect/reconnect
- Filter toggle buttons (Time, Wrap, Auto, Clear) restyled to match severity button aesthetics
- Switching transport or device while connected: old connection stays active until new selection is confirmed, then seamlessly switches
- Boot detection assumes device has already booted on connect — first reset is now correctly detected

### Fixed
- sendConnected race condition with panel initialization delay
- Concurrent connect guard prevents overlapping connection attempts
- Boot detection reset on reconnect (no more spurious "Device Reset Detected" separators)
- Removed vestigial inline settings panel (RTT address input with no handler)
- Removed dead filterChanged messages (sent from webview but never handled)
- Error path in connect flow now correctly resets sidebar state

### Removed
- Welcome screen HTML, CSS, and JavaScript (~1000 lines removed)
- Device/port/baud pickers from webview (replaced by sidebar QuickPick flows)
- Novel Bits branding footer from sidebar (branding lives in activity bar icon)

## [0.1.7] — 2026-03-19

### Fixed
- Prevent J-Link TCP/IP dialog popup when no USB probe is connected
- Error banner moved below Connect button and centered for cleaner layout
- Strip "ERROR:" prefix from error messages (red styling is sufficient)

### Security
- Fix message origin verification in webview (SonarCloud S2819)
- Replace regex patterns vulnerable to backtracking DoS in HCI parser (S5852)
- Replace Math.random() with crypto.randomBytes() for session IDs and nonces (S2245)
- Resolve python3 to absolute path before spawning (S4036)
- Pin GitHub Actions dependencies to full commit SHA (S7637)

### Changed
- Modernize code: replaceAll(), Number.parseInt(), String.fromCodePoint()
- Use proper localeCompare for string sorting
- Add GitHub Actions CI (build + test on push/PR) and auto-publish on version tags
- Add CHANGELOG.md
- Internal docs removed from public repo

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
