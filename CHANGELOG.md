# Changelog

All notable changes to LogScope will be documented in this file.

## [0.6.0] - 2026-05-13

### Architecture
- Direct-memory RTT path replaces libjlinkarm's high-level RTT API. LogScope now reads the SEGGER RTT control block directly via target memory reads (the approach used by probe-rs, OpenOCD, and Nordic's nrfutil) instead of routing through `JLINK_RTTERMINAL_*`. This bypasses libjlinkarm's host-side `tracked_RdOff` cache.
- The legacy path remains available via `LOGSCOPE_RTT_LEGACY=1` for one-flip rollback if the new path causes regressions.

### Fixed
- Mid-session board resets now surface the new boot banner within ~50 ms. Pressing the reset button while LogScope is connected no longer silently drops new boot data: the new code detects target resets via probe-rs's `last_written_rd_off` pattern (write RdOff, remember it, re-attach when the target's RdOff no longer matches what we wrote) and transparently re-attaches without halting the CPU.

### Added
- Channel names from the SEGGER_RTT control block display in the sidebar (for example, "Terminal" instead of "Channel 0"). Names come from the `sName` pointer in each up-buffer descriptor.
- Python test suite at `test/python/` covering CB scanning, parsing, ring-buffer read math, and the session state machine including reset detection. Run via `npm run test:python` (34 tests, 0.02s).
- CI step runs the Python tests on every PR.

### Rollback
- If you hit a regression, set the `LOGSCOPE_RTT_LEGACY=1` environment variable for the VS Code process to force the old `JLINK_RTTERMINAL_*` path. Please file an issue at https://github.com/NovelBits/logscope/issues with the reproduction details.

## [0.5.18] - 2026-05-12

Critical fix for an orphan-helper bug that left LogScope appearing connected with zero entries after a VS Code window reload.

### Fixed
- **Reloading VS Code while LogScope is connected no longer leaves an orphan helper holding the J-Link probe.** When VS Code reloads its window, the extension host is torn down immediately. Previously, `disconnect()` queued the force-kill of the Python helper subprocess via a 500ms `setTimeout` — which never fired because the event loop was already dead. The helper survived as an orphan re-parented to init (PID 1), kept polling RTT, and silently drained log data away from any subsequent LogScope session. The next "Connect" looked successful (probe is multiplexed across processes by SEGGER's J-Link service) but no entries ever appeared because the orphan was reading the RTT buffer first. Fix: two layers of defense.
  - **Layer 1 (extension):** `disconnect()` now kills the helper synchronously instead of via `setTimeout`. The graceful `quit\n` message still goes out first (best-effort), but a SIGTERM follows immediately on the same tick. `disconnectAll()` also now cleans up mid-connect transports (helper spawned but RTT_READY not yet seen), which had the same orphan risk.
  - **Layer 2 (Python helper):** `rtt-helper.py` now installs a SIGTERM handler that exits cleanly via `os._exit(0)`, and a daemon thread that polls `os.getppid()` every 2 seconds. If our parent process dies (PID changes, or becomes 1 on Unix), the helper bails immediately, releasing the J-Link probe. This catches edge cases where Layer 1's signal never arrives (extension host crashed, etc.). Windows orphan detection works differently and is tracked as future work.

## [0.5.17] - 2026-05-12

Parity cleanup release plus three multi-probe / device-switch UX fixes from the 2026-05-11 capture session. Every setting in `package.json` is now actually consumed by the code, every setting consumed by the code is declared, and the sidebar finally tells you which probe is talking.

### Fixed
- **Search filter no longer carries over to a new connection.** Disconnecting from board A and connecting to board B used to keep the previous search filter active, hiding entries on the new board (the status bar would say "4 entries" while only 1 was visible). The webview now clears its search state on every new `connected` message, so filters are scoped to the current session.
- **No more fake "Device Reset Detected" banner on initial connect via the `Reconnected OK` path.** The Python helper's `full_reconnect()` recovery routine emits "Reconnected OK" when it completes, and on a first-attach scenario this could fire before any user data has flowed. `NrfutilRttTransport` now gates the `reset` event behind a `firstDataReceived` flag that flips true only after the first chunk of log data is parsed. A second path (the parser's `*** Booting` detection firing on historical RTT buffer drain) is tracked in TODO.md as a follow-up.
- **Sidebar now shows the active probe serial when connected via J-Link RTT.** Multi-probe workflows (Bluetooth LE central+peripheral, mesh, board farms) previously had no way to tell from the sidebar which of several attached probes the current session was talking to: the "Device" row showed the chip name (`nRF54L15`) only. A new "Probe" row sits next to "J-Link Device" and shows the probe serial.

### Added
- **Column-width persistence.** Resizable log-viewer column widths now survive panel closes and VS Code restarts via the new `logscope.columnWidths` setting (set automatically when you drag a column edge).
- **Double-click a column edge to auto-fit** the column to the widest visible content. Useful after applying a filter, or whenever a long module name or message is being clipped.
- **`logscope.jlink.remoteHost` setting** is now declared in `package.json`. The remote-RTT plumbing for connecting to a J-Link Remote Server was already in the code (read via `-ip <host>` arg in the helper), but the setting was not surfaced in the VS Code Settings UI. Marked experimental; full UI for remote-RTT is in progress on a worktree.
- **CI parity check** (`scripts/check-runtime-config-keys.mjs`) uses the TypeScript compiler API to verify every `logscope.*` setting declared in `package.json` is actually read at runtime, and every runtime read corresponds to a declared setting. Wired into `.github/workflows/ci.yml`; PRs that drift either direction now fail.
- **Privacy & Telemetry docs page** at `docs.novelbits.io/logscope/reference/privacy-telemetry/`. Documents the eight event types LogScope reports to Application Insights, the anonymous install ID model, what is never collected, and how to opt out via VS Code's `telemetry.telemetryLevel` setting.

### Removed
- **Six dead settings** that were declared in `package.json` but never consumed in code: `logscope.rtt.address` (its "auto" Zephyr-ELF detection module was never wired in), `logscope.rtt.host`, `logscope.rtt.port` (referenced a "jlink-telnet" transport that does not exist), `logscope.jlink.interface`, `logscope.jlink.speed`, `logscope.jlink.autoStart` (their only consumer was a `JLinkManager` class that was never imported anywhere). Users who set these previously saw no behavior change. The default debug interface remains hardcoded SWD in `rtt-helper.py`, which is what every shipped version has always used.
- **Two dead source modules:** `src/rtt-detect.ts` (orphan Zephyr ELF auto-detection helper) and `src/transport/jlink-manager.ts` (orphan J-Link manager class). Combined ~350 lines of code that no production code path imported.

### Fixed
- `reference/settings.md` docs page now matches `package.json` exactly. The three high-severity "documented but not real" entries flagged in the 2026-05-12 parity audit are gone.

## [0.5.16] - 2026-05-12

Telemetry pipeline repair after a 25-day silent outage. No user-facing functionality changes.

### Fixed
- **Telemetry routing repointed to a fresh Azure Application Insights resource.** On 2026-04-17 the previous workspace-based App Insights component entered a "silent-drop" state: the ingestion endpoint kept returning HTTP 200 with itemsAccepted=1, but the Log Analytics workspace stopped storing events. The package's internal HTTPS layer swallows 400-class failures silently, so the outage went undetected for 25 days. v0.5.16 ships a new connection string pointing at a freshly provisioned resource (Bluefield flow type, dedicated Log Analytics workspace) that is verified end-to-end.

### Added
- **Non-silent telemetry catch block.** Synchronous send failures now log to the LogScope output channel once per session via `logger.logError` instead of being silently swallowed. Note: this does not catch async HTTP failures inside the @vscode/extension-telemetry package; those still need to be detected via the upstream GitHub Action.
- **Daily GitHub Action health check** (`.github/workflows/telemetry-health.yml`). POSTs a synthetic event to App Insights every day at 13:00 UTC and (when the `APPINSIGHTS_API_KEY` secret is configured) verifies the event lands in the workspace. Workflow failure auto-emails repo admins, providing 24-hour detection on the same fault mode that took 25 days to spot last time.

## [0.5.15] — 2026-04-30

Two edge-case fixes from the 2026-04-17 audit.

### Fixed
- **Stale modules in the toolbar dropdown after Clear.** Clicking Clear emptied the log viewer and ring buffer but left `session.modules` populated, so the All modules dropdown kept listing modules whose entries had been deleted. Now the session's module set and the webview's dropdown are both reset on Clear; new entries repopulate them as they arrive.
- **`Reset Device` now honors `logscope.jlink.path`.** The reset action shelled out via `JLinkExe` from PATH regardless of the user's configured path, which silently used a different SEGGER binary than the connect path. Now reads the setting and falls back to `JLinkExe` only if it's empty or invalid.

## [0.5.14] — 2026-04-30

Two bug fixes. Resolves [#17](https://github.com/NovelBits/logscope/issues/17).

### Fixed
- **Quiet RTT devices no longer hit a destructive reconnect loop** ([#17](https://github.com/NovelBits/logscope/issues/17)). LogScope's silence-recovery path used to escalate from a host-side `restart_rtt()` (non-destructive) to `full_reconnect()` after only 6 seconds of silence — and `full_reconnect()` halts the target via `jlink.connect()`, breaking active BLE connections, sensor timing, and any in-flight work. For genuinely quiet devices (BLE peripherals advertising and waiting for connections, sensors logging once a minute, etc.) this fired continuously and held the device in a reset loop. Two changes: silence now caps at the lightweight `restart_rtt()` (stage 0 → stage 1, then stays put until data arrives — never escalates to `full_reconnect()`); the default silence threshold is raised from 3s to 30s. The destructive `full_reconnect()` still runs on real RTT errors via `handle_read_error()`, which is the appropriate trigger.
- **New setting `logscope.rtt.silenceThreshold`** (default `30`) lets users tune the silence window or disable silence-based recovery entirely (set to `0`).
- **Wrap toggle now applies retroactively to all log rows.** The `.msg` flex item had `flex: 0 0 auto`, which sized it to content's natural width — so even when wrap-mode flipped `white-space: normal`, there was nothing to wrap *within*. Now uses `flex: 1 1 0; min-width: 0` in wrap-mode so the row's available width constrains the message and text wraps cleanly.

## [0.5.13] — 2026-04-29

UX patch — copy-from-log-rows now produces usable output.

### Fixed
- **Copying multiple log rows** previously emitted each cell on its own line because the row uses `display: flex` with span children, and browsers serialize flex children as block-level on copy. Selections spanning two or more rows are now reformatted on the fly: each row becomes one tab-separated line (date + clock + timestamp + level + module + message), and rows are joined with newlines. Spreadsheet- and markdown-table-friendly. Single-cell selections still use the browser default so partial-message copies aren't disturbed.
- **Device-reset banners** are now included in copied output as `--- ⚠ Device Reset Detected · <timestamp> ---` separator lines, preserving the boot-boundary context users rely on when sharing logs that span a reset.

## [0.5.12] — 2026-04-29

UART configurability + connect-flow UX. Resolves [#9](https://github.com/NovelBits/logscope/issues/9).

### Added
- **UART data bits, stop bits, and parity settings** — `logscope.uart.dataBits` (5/6/7/8), `logscope.uart.stopBits` ("1"/"1.5"/"2"), `logscope.uart.parity` ("none"/"odd"/"even"/"mark"/"space"). Defaults preserve 8N1 behavior, so existing users see no change. Plumbed through `uart-serial.ts` → `uart-helper.py` → pyserial. Validated through the Change Settings flow; non-default frame configs are pyserial-validated but firmware-side hardware testing is an open invitation — if it's broken on a specific platform, please file an issue.
- **Change Settings entries** — Data Bits, Stop Bits, and Parity now appear alongside Baud Rate in the Change Settings menu when transport is UART, each showing the current value as the description. Sub-pickers mark the active value with `(current)`.
- **Connect-wizard hint items** — non-clickable advisory rows (lightbulb icon) at the end of the Transport, Parser, and Baud Rate pickers explain when to pick each option and where the advanced UART settings live. Marked with an internal `_hint` flag so accidentally clicking them keeps the wizard open instead of abandoning it.
- **Forget Device confirmation modal** — clicking the trash icon now shows "Your parser, baud rate, watch patterns, and other settings are kept. Only the saved probe/port is cleared, so you'll see the full Connect wizard next time" before clearing. Removes the "did I just lose my config?" anxiety.
- **Wireshark export prerequisites in description** — the Wireshark format option now reads "HCI packets only — needs firmware with bt_monitor enabled (J-Link RTT)" so users self-select-out before clicking instead of getting a warning afterward.

## [0.5.11] — 2026-04-29

Hardening release. Adds defenses against the regression class that produced [#11](https://github.com/NovelBits/logscope/issues/11) so it can't sneak through CI again.

### Added
- **Helper smoke test** — Jest spawns `python3 rtt-helper.py discover` on every PR and asserts the helper produces valid JSON with a `devices` key. Catches the exit-without-flush regression class regardless of whether pylink or SEGGER tools are installed in CI.
- **Empty-stdout detection in `discoverDevices`** — when the helper exits with code 0 but produces no output, the user now sees a clear "helper produced no output — likely a LogScope bug, please report at the issue tracker" message instead of degrading to silent "no devices found." Previous behavior misattributed the issue to "no probe connected."

### Changed
- **`parseDiscoverResult` extracted as a pure function** — pulled JSON parsing out of the spawn callback so it's unit-testable. 10 new tests cover every branch (valid JSON, helper-reported error, empty-stdout-bug detection, stderr fallback, exit-code-aware behavior).
- **`.vscodeignore` uses `build-*/**` wildcard** — prevents stray Zephyr build directories from breaking `vsce package`.

## [0.5.10] — 2026-04-29

Critical bugfix release. Resolves [#11](https://github.com/NovelBits/logscope/issues/11).

### Fixed
- **Discover-mode JSON output silently dropped on exit** — v0.5.7 added `os._exit()` to bypass a libjlinkarm destructor crash, but `os._exit()` does **not** flush stdio buffers. The discover helper was successfully detecting probes via pylink, then `print(json.dumps(...))` wrote the JSON into Python's stdout buffer, then `os._exit(0)` terminated the process before the buffer was flushed. The JSON never reached LogScope, which interpreted "empty stdout" as "no devices found." Symptoms: every user with v0.5.7–v0.5.9 saw "No J-Link devices found" even when a probe was attached and JLink Commander could see it. Fix: explicit `sys.stdout.flush()` and `sys.stderr.flush()` before `os._exit()`.

This regression was platform-agnostic (Intel and Apple Silicon, macOS and Windows). It was caught when reproducing [#11](https://github.com/NovelBits/logscope/issues/11) locally — pylink enumerated the probe correctly when called directly, but the same call inside the helper produced no output.

## [0.5.9] — 2026-04-28

UX release. Continuation of [#11](https://github.com/NovelBits/logscope/issues/11) — when discovery returns empty, the most common silent failure mode is another tool (nRF Connect for VS Code, JLink Commander, RTT Viewer) holding the probe. The "No J-Link devices found" message gave no hint that contention was a possibility.

### Added
- **Common-causes hint when no probe is found** — the empty-state error card now lists the three most likely reasons (no probe connected, another tool holding the probe, driver refresh needed) instead of the previous one-line message
- **Contention hint in the device picker** — the QuickPick empty state now suggests closing RTT/VCOM sessions in nRF Connect, JLink Commander, or RTT Viewer

### Changed
- **Error-card detail supports multi-line text** — `white-space: pre-line` on `.error-card-detail` so `\n` characters render as actual line breaks

## [0.5.8] — 2026-04-27

Diagnostics and documentation release. Triggered by [#11](https://github.com/NovelBits/logscope/issues/11) — a user whose probe was visible in nRF Connect but not in LogScope, with no diagnostic info to explain why.

### Added
- **Friendly "SEGGER J-Link Software not found" error** — when `libjlinkarm.dylib` (macOS) or `JLink_x64.dll` (Windows) is missing from the standard install path, LogScope now shows a clear error card with a "Download SEGGER J-Link" button instead of an empty "No J-Link devices found" message
- **Helper stderr forwarded to the LogScope output channel** — discovery and connection errors from the Python RTT helper now appear in `View → Output → LogScope`, so failures are self-diagnosing instead of silent
- **Diagnostic detail in the device picker empty state** — when discovery returns no probes, the QuickPick now shows the underlying reason (e.g., "SEGGER J-Link Software not found at /Applications/SEGGER/")

### Changed
- **README and docs prerequisites** — SEGGER J-Link Software is now listed alongside nrfutil as a required dependency for J-Link RTT, with install paths and a download link. Troubleshooting page updated to call out the SEGGER vs. nRF-Connect-bundled-libs discrepancy.

## [0.5.7] — 2026-04-17

Maintenance release. No new features.

### Fixed
- **Crash during extension exit** — `os._exit()` in the Python RTT helper avoids a segfault in `JLINKARM_Close` during Python's C destructor chain on shutdown
- **Duplicate process event listeners** — merged two `proc.on("exit")` and two `proc.on("error")` listeners in the RTT transport into single handlers, fixing inconsistent cleanup on helper exit
- **Invalid watch pattern regex no longer crashes activation** — a malformed regex in `logscope.watchPatterns` (e.g., `"pattern": "["` with `regex: true`) used to throw during activation and prevent the extension from loading. Invalid patterns are now skipped with a warning notification listing them by name
- **Memory leak when LogScope tab closed but transport still streaming** — `pendingEntries` was accumulating forever because the flush timer never drained while the panel was disposed. Now cleared on panel dispose and skipped in `addEntries` when panel is closed (ring buffer remains the source of truth and replays on reopen)
- **Clearer error when reconnecting to a probe that is no longer plugged in** — pre-flight probe presence check shows "Device disconnected" with Rescan button instead of a pylink traceback
- **Empty state message no longer shows alongside Device Reset Detected separator** — empty state is now hidden when a reset separator is added

## [0.5.6] — 2026-04-15

### Added
- **Preserve logs when moving tabs between windows** — log history is now restored from the ring buffer when a LogScope tab is moved to a new VS Code window. Contributed by [@Trond-F-Christiansen](https://github.com/Trond-F-Christiansen) in [#10](https://github.com/NovelBits/logscope/pull/10).
- **Distinct parser icons** — Zephyr (lightning bolt), nRF5 SDK (package), and Raw (terminal) now have unique icons in the parser picker
- **Pre-built demo firmware** — ready-to-flash hex files for nRF54L15, nRF52840, and FRDM-MCXN947 in `samples/prebuilt/`
- **CLAUDE.md** — contributor guide with build instructions and project conventions

### Fixed
- **Reset Device works with all boards** — now uses JLinkExe instead of nrfutil, fixing reset on STM32, NXP, SiLabs, and other non-Nordic boards
- **Timestamp ordering after tab move** — entries are now replayed in correct chronological order when restoring logs after moving a tab to a new window

## [0.5.5] — 2026-04-10

### Added
- **Cancel connecting** — connection progress notification is now cancellable; click Cancel to abort without waiting for the 15-second timeout
- **Python setup progress** — first-time users see "Setting up Python environment (one-time setup)..." instead of generic "Connecting..." while dependencies install
- **Rescan command** — new `LogScope: Rescan Devices` command performs a lightweight device rescan without reopening the full guided connect wizard. Error card "Rescan" button now uses this
- **Forget Device** — new sidebar action (trash icon) clears saved device/port settings, returning the sidebar to the clean welcome view
- **Empty state message** — webview shows "No log data yet. Connect a device..." when no data is present
- **ARIA accessibility** — `aria-pressed` on severity toggle buttons, `aria-label` on error dismiss button, `aria-haspopup`/`aria-expanded`/`role` attributes on module picker dropdown

### Changed
- **Webview ready handshake** — replaced hardcoded 150ms setTimeout delays with an event-based ready signal. The webview posts a "ready" message when loaded, and the extension queues state updates until ready. Eliminates race conditions on slow machines
- **Step counter numbers** — guided connect flow now shows correct "Step X of 4" for all transports (was showing wrong totals for UART and RTT flows)
- **Status bar connecting state** — shows spinning "LogScope: Connecting..." indicator during connection attempts
- **Connection progress** — connect flow wrapped in `vscode.window.withProgress` notification
- **Export button always visible** — export action in sidebar is now shown even when disconnected (data may still be in the ring buffer)
- **UART transport logging** — routed through logger.ts output channel instead of raw console.log

### Fixed
- **connectInFlight feedback** — shows "Connection already in progress" message instead of silently ignoring duplicate connect attempts
- **userDisconnecting race condition** — replaced 100ms setTimeout with synchronous flag reset after disconnect, preventing false "Connection lost" messages after intentional disconnects

## [0.5.4] — 2026-04-10

### Added
- **Per-probe J-Link device overrides** — device name is now saved per J-Link probe serial number. Switching between boards (e.g., STM32 and Nordic DK) automatically uses the correct device name without manual settings changes
- **J-Link Device in guided connect flow** — new step in the connection wizard lets you pick Auto-detect, a generic core (Cortex-M4, M7, M33, etc.), or enter an exact chip name
- **J-Link Device in Change Settings** — accessible via the sidebar Change Settings menu when connected via RTT
- **J-Link Device shown in sidebar** — displays the current device override (or "Auto") in both connected and disconnected states
- **Accurate CPUID-based core detection** — auto-detect now reads the ARM CPUID register (0xE000ED00) to identify the actual core type (M0/M0+/M3/M4/M7/M23/M33/M55/M85) instead of trial-and-error connection
- **Version number in sidebar** — LogScope version shown at the bottom of the sidebar for easy reference

### Fixed
- **Extension activation delay** — deferred synchronous Python path resolution to a setTimeout so the extension activates instantly and commands respond immediately after VS Code reload
- **Incorrect core detection** — all boards were previously detected as Cortex-M33 regardless of actual core. Now correctly identifies Cortex-M4 (STM32F4), Cortex-M7 (STM32H7), etc.

## [0.5.3] — 2026-04-10

(Same changes as v0.5.4. Changelog was not included in v0.5.3 release.)

## [0.5.2] — 2026-04-09

### Changed
- **License sidebar UI hidden** — "Enter License Key / Upgrade to Pro" removed from sidebar until Pro tier launches
- **All features unlocked** — `isProFeatureAvailable()` returns true for all users
- **Documentation and Report Issue visible when connected** — these links now appear in the sidebar during active sessions, not just when disconnected

### Fixed
- **9 documentation pages updated** — removed inaccurate Pro/licensing references, rewrote watch patterns docs, added output channel and STM32 troubleshooting sections, fixed nrfutil requirement (now optional)

## [0.5.1] — 2026-04-08

### Fixed
- **STM32 and other SWD-only boards failing to connect** — rtt-helper.py now explicitly sets SWD interface and a safe default speed (4 MHz) before calling `jlink.connect()`. Without this, pylink defaulted to whatever the probe's last interface state was (often JTAG), causing `connect()` to silently return a partial session that then failed at `jlink.halted()` with "Target is not connected". Affects standalone J-Link probes connecting to STM32, NXP, and other Cortex-M targets. Nordic DKs with J-Link OB were unaffected since they only support SWD. (thanks @littleYangYu91, fixes #3)
- **Unclear error when target connection fails** — added explicit `target_connected()` check after `connect()` with a detailed error message listing possible causes (wrong device name, board not powered, SWD pins not wired)
- **Tightened date column width** — date column was leaving ~30px of empty space past the timestamp text when the date toggle was enabled. Reduced from 185px/220px to 155px/185px to match the rendered width

## [0.5.0] — 2026-04-08

### Added
- **LogScope output channel** — new dedicated output channel under **View > Output > LogScope** for diagnostic logs. Shows connection attempts, retries, errors, and detailed helper process output to make troubleshooting connection issues much easier
- **Verbose connection diagnostics** — connection attempts now log the full spawn command, Python and helper paths, nrfutil path, environment variables, helper process PID, exit codes, and every line of stderr from the rtt-helper. Critical for diagnosing issues on non-Nordic boards
- **Effective device name logging** — logs both the user's `logscope.jlink.device` setting and the effective value being sent to the helper, plus whether it was auto-resolved or a user override

### Changed
- **Watch patterns sidebar UI hidden pending redesign** — the watch patterns section has been removed from the sidebar. Existing patterns configured in settings continue to work and produce highlights in the log view. Management is available via the Command Palette:
  - `LogScope: Add Watch Pattern`
  - `LogScope: Remove Watch Pattern`
  - This is temporary while we rebuild the UI with proper lifecycle handling

## [0.4.5] — 2026-04-06

### Added
- Initial LogScope output channel (expanded in v0.5.0 with full diagnostics)

## [0.4.4] — 2026-04-06

Skipped due to a Marketplace publishing conflict.

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
