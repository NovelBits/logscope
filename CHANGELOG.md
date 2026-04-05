# Changelog

All notable changes to LogScope will be documented in this file.

## [0.4.3] — 2026-04-04

### Fixed
- **Sidebar flicker** — eliminated the blinking/flashing under the LOGSCOPE sidebar title during active sessions. Counter updates (Entries, HCI Packets, Errors, Duration) now update in place instead of rebuilding the entire tree
- **Security: error path sanitization** — generic error messages no longer expose file system paths (e.g., `/Users/...`, `/Applications/...`)
- **Security: serial number validation** — serial numbers are validated as digits-only before being passed to device reset commands

### Added
- **Date in wall-clock timestamps** — Time column now shows full date prefix in ISO 8601 format (e.g., `2026-04-04 08:57:28.568`)
- **Sidebar tooltips** — hover over any sidebar item to see the full value (useful for long UART port paths)
- **Windsurf and Kiro IDE support** — lowered VS Code engine requirement to `^1.107.0` for compatibility with Windsurf, Kiro, and Cursor editors (thanks @dhruvkakadiya, fixes #4)
- **Workspace trust restrictions** — `logscope.nrfutil.path` and `logscope.jlink.path` settings are restricted in untrusted workspaces
- **73 new tests** — expanded test coverage from 190 to 263 tests (HCI parser, btsnoop export, session export, security, transport, connection tracker)

### Changed
- Duration timer updates at 1Hz (was 2Hz) with change detection

## [0.4.2] — 2026-04-01

### Changed
- Reduced extension package size by cleaning up bundled assets

## [0.4.1] — 2026-04-01

### Fixed
- **Non-Nordic device detection** — devices connected via J-Link are no longer misidentified as Nordic chips. Previously, an STM32 or EFR32 could be detected as "nRF52832," causing device resets and connection failures. Now uses safe generic core names (Cortex-M33/M4/M7/M0+) for non-Nordic targets. (Fixes #3)
- **RTT on non-Nordic devices** — explicitly sets RTT search ranges via J-Link, enabling RTT on any device with standard ARM SRAM layout. Tested on Silicon Labs EFR32MG24.
- **NO_RTT error handling** — when firmware lacks RTT, LogScope now fails immediately (no pointless retries), shows a clear error card explaining the issue, and does not display a persistent toast notification
- **Panel visibility on connect** — the log viewer panel now opens as soon as you click Connect, so connection status and error cards are always visible
- **CSP connect-src** — resolved Content Security Policy warning in developer console

### Changed
- Log messages now use monospace font (matches your VS Code editor font) for better alignment of structured output (thanks @kartben)
- Improved "No RTT control block found" error message with actionable guidance about RTT search ranges
- User's `logscope.jlink.device` setting is now respected when set to a non-default value

### Added
- EFR32MG24 bare-metal RTT demo firmware in `samples/efr32mg24-rtt-demo/`

## [0.4.0] — 2026-03-31

### Added
- **Anonymous telemetry** for tracking adoption metrics (DAU/MAU, session duration, feature usage)
- All telemetry respects VS Code's built-in telemetry settings (opt-out via Settings > Telemetry Level)
- Zero PII collected: no file paths, no serial numbers, no log content, no device names
- 8 telemetry events: activation, session start/end, connect failed, connect flow abandoned, export, parser change, command
- `telemetry.json` event schema documentation in repo root
- Telemetry section in README documenting what is collected and how to opt out
- First runtime dependency: `@vscode/extension-telemetry`

## [0.3.2] — 2026-03-31

### Changed
- Updated README with improved feature descriptions

## [0.3.1] — 2026-03-31

### Added
- "Why LogScope?" comparison table in README showing LogScope vs nRF Terminal capabilities
- "Extends nRF Connect for VS Code" positioning in README
- FAQ entry for "How is this different from nRF Terminal?"
- Marketplace keywords: nrf-connect, nrf52, nrf54, serial, log-viewer, debug
- 263 unit tests across 18 test suites (HCI parser framing, btsnoop export, session export, RTT transport, connection tracker, security)

### Security
- Workspace trust restrictions for executable path settings (jlink.path, nrfutil.path)
- Error path sanitization to prevent internal filesystem path leakage
- Serial number input validation

## [0.3.0] — 2026-03-21

### Added
- **Multi-parser support** — choose between Zephyr, nRF5 SDK, and Raw mode via Change Settings or Command Palette
- **nRF5 SDK parser** — parses `<info> module: message` format with full severity mapping (error/warning/info/debug) and optional tick timestamps
- **Raw mode** — display log lines as-is with no parsing, for bare printf, ESP-IDF, or any non-standard log format. Hides severity/module/timestamp controls for a clean view
- **Host timestamps (Time column)** — wall-clock time when each line was received, always visible in all modes. Useful for correlating logs with real-world events
- **Timestamp toggle renamed** — "Time" button renamed to "Timestamp" to clarify it controls the device timestamp column, not the wall-clock time
- `logscope.parser` setting — persists parser selection across sessions (values: `zephyr`, `nrf5`, `raw`)
- `LogScope: Select Parser` command in Command Palette
- Host timestamps included in text export (ISO prefix) and JSONL export

### Changed
- Parser selection added to Change Settings QuickPick flow (alongside Transport, Device, Baud Rate)
- Sidebar shows current parser in both connected and disconnected states
- ANSI escape code stripping shared across all parsers via `src/parser/utils.ts`

## [0.2.6] — 2026-03-23

### Changed
- Activity bar icon updated — structured log columns design (level | module | message)
- Sidebar: "Help & Feedback" replaced with "Documentation" (by Novel Bits) and "Report Issue" (GitHub)

## [0.2.5] — 2026-03-23

### Fixed
- **Multi-probe support** — pass J-Link serial number through the full connection chain, preventing the SEGGER probe selection dialog from appearing when multiple boards are connected
- **Board disconnection detection** — detect when a board is physically unplugged and show "Connection lost" instead of spinning indefinitely
- **Windows device discovery** — Python resolution now tries both `python` and `python3` across all platforms; UART transport no longer hardcodes `python3`
- **Windows RTT connectivity** — use the newest J-Link DLL on the system instead of potentially outdated versions that lack support for newer chips (e.g., nRF54L15)
- **Device auto-detection with multi-probe** — pass serial number to `nrfutil device device-info` so the correct probe is queried when multiple J-Link probes are connected
- **RTT auto-detection on newer chips** — scan the J-Link device database for specific chip names (e.g., `NRF54L15_M33`) instead of falling back to generic `Cortex-M33`, which lacks the RAM layout needed for RTT control block detection
- **RTT connect retries** — automatically retry RTT connection up to 2 times with a 2-second delay, improving reliability after board reset or re-plug
- **Graceful RTT shutdown** — helper process listens for a "quit" command on stdin for clean shutdown instead of relying on process kill

### Changed
- Python environment setup (`ensurePythonEnv`) now installs required packages per transport (pylink-square for RTT, pyserial for UART) instead of bundling everything
- Python check on activation — shows a warning with "Download Python" link if Python is not found, with a dismissible option

## [0.2.4] — 2026-03-23

### Fixed
- Fix device scanning on Windows — Python resolution now tries both `python` and `python3` across all platforms
- UART transport no longer hardcodes `python3` (broken on Windows where only `python` exists)

## [0.2.3] — 2026-03-21

### Changed
- New icon: magnifying glass over colored log lines (replaces oscilloscope waveform)
- Activity bar icon updated to match new branding (monochrome magnifier + log lines)

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
