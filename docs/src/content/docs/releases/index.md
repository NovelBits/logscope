---
title: Releases
description: All LogScope releases with full notes, in chronological order. Auto-generated from CHANGELOG.md.
---

LogScope ships frequently. Each release below has its own page with the full notes; the list is generated from the canonical [`CHANGELOG.md`](https://github.com/NovelBits/logscope/blob/main/CHANGELOG.md) in the repository, so it always reflects what has actually shipped.

For installation and getting started, see [Installation](/logscope/getting-started/installation/). For new-feature announcements and release highlights, follow [Novel Bits on LinkedIn](https://www.linkedin.com/company/novelbits).

## All releases

<!-- RELEASES-LIST-START -->

- **[v0.6.5](/logscope/releases/v-0-6-5/)** &mdash; 2026-05-16 &mdash; Marketplace listing optimization
- **[v0.6.4](/logscope/releases/v-0-6-4/)** &mdash; 2026-05-13 &mdash; Duplicate "Device Reset Detected" banner
- **[v0.6.3](/logscope/releases/v-0-6-3/)** &mdash; 2026-05-13 &mdash; Column auto-fit (double-click the resize handle) now correctly fits the Module column too. v0.6.2's fix used `cell.scrollWidth`, which equal
- **[v0.6.2](/logscope/releases/v-0-6-2/)** &mdash; 2026-05-13 &mdash; Double-clicking the resize handle on a column header now correctly auto-fits the column to its widest visible content. In v0.5.17 through v0
- **[v0.6.1](/logscope/releases/v-0-6-1/)** &mdash; 2026-05-13 &mdash; Republish of v0.6.0 with a smaller VSIX. v0.6.0 was auto-published by the GitHub Actions release workflow on `v*` tag push, before a `.vscod
- **[v0.6.0](/logscope/releases/v-0-6-0/)** &mdash; 2026-05-13 &mdash; Same code as [0.6.1] but with a bloated VSIX (6.4 MB) that inadvertently included a local `.cocoindex_code/` indexing database. Auto-publish _(superseded by 0.6.1)_
- **[v0.5.18](/logscope/releases/v-0-5-18/)** &mdash; 2026-05-12 &mdash; Critical fix for an orphan-helper bug that left LogScope appearing connected with zero entries after a VS Code window reload.
- **[v0.5.17](/logscope/releases/v-0-5-17/)** &mdash; 2026-05-12 &mdash; Parity cleanup release plus three multi-probe / device-switch UX fixes from the 2026-05-11 capture session. Every setting in `package.json`
- **[v0.5.16](/logscope/releases/v-0-5-16/)** &mdash; 2026-05-12 &mdash; Telemetry pipeline repair after a 25-day silent outage. No user-facing functionality changes.
- **[v0.5.15](/logscope/releases/v-0-5-15/)** &mdash; 2026-04-30 &mdash; Two edge-case fixes from the 2026-04-17 audit.
- **[v0.5.14](/logscope/releases/v-0-5-14/)** &mdash; 2026-04-30 &mdash; Two bug fixes. Resolves [#17](https://github.com/NovelBits/logscope/issues/17).
- **[v0.5.13](/logscope/releases/v-0-5-13/)** &mdash; 2026-04-29 &mdash; UX patch — copy-from-log-rows now produces usable output.
- **[v0.5.12](/logscope/releases/v-0-5-12/)** &mdash; 2026-04-29 &mdash; UART configurability + connect-flow UX. Resolves [#9](https://github.com/NovelBits/logscope/issues/9).
- **[v0.5.11](/logscope/releases/v-0-5-11/)** &mdash; 2026-04-29 &mdash; Hardening release. Adds defenses against the regression class that produced [#11](https://github.com/NovelBits/logscope/issues/11) so it can
- **[v0.5.10](/logscope/releases/v-0-5-10/)** &mdash; 2026-04-29 &mdash; Critical bugfix release. Resolves [#11](https://github.com/NovelBits/logscope/issues/11).
- **[v0.5.9](/logscope/releases/v-0-5-9/)** &mdash; 2026-04-28 &mdash; UX release. Continuation of [#11](https://github.com/NovelBits/logscope/issues/11) — when discovery returns empty, the most common silent fa
- **[v0.5.8](/logscope/releases/v-0-5-8/)** &mdash; 2026-04-27 &mdash; Diagnostics and documentation release. Triggered by [#11](https://github.com/NovelBits/logscope/issues/11) — a user whose probe was visible
- **[v0.5.7](/logscope/releases/v-0-5-7/)** &mdash; 2026-04-17 &mdash; Maintenance release. No new features.
- **[v0.5.6](/logscope/releases/v-0-5-6/)** &mdash; 2026-04-15 &mdash; Preserve logs when moving tabs between windows
- **[v0.5.5](/logscope/releases/v-0-5-5/)** &mdash; 2026-04-10 &mdash; Cancel connecting
- **[v0.5.4](/logscope/releases/v-0-5-4/)** &mdash; 2026-04-10 &mdash; Per-probe J-Link device overrides
- **[v0.5.3](/logscope/releases/v-0-5-3/)** &mdash; 2026-04-10 &mdash; (Same changes as v0.5.4. Changelog was not included in v0.5.3 release.)
- **[v0.5.2](/logscope/releases/v-0-5-2/)** &mdash; 2026-04-09 &mdash; License sidebar UI hidden
- **[v0.5.1](/logscope/releases/v-0-5-1/)** &mdash; 2026-04-08 &mdash; STM32 and other SWD-only boards failing to connect
- **[v0.5.0](/logscope/releases/v-0-5-0/)** &mdash; 2026-04-08 &mdash; LogScope output channel
- **[v0.4.5](/logscope/releases/v-0-4-5/)** &mdash; 2026-04-06 &mdash; Initial LogScope output channel (expanded in v0.5.0 with full diagnostics)
- **[v0.4.4](/logscope/releases/v-0-4-4/)** &mdash; 2026-04-06 &mdash; Skipped due to a Marketplace publishing conflict.
- **[v0.4.3](/logscope/releases/v-0-4-3/)** &mdash; 2026-04-04 &mdash; Sidebar flicker
- **[v0.4.2](/logscope/releases/v-0-4-2/)** &mdash; 2026-04-01 &mdash; Reduced extension package size by cleaning up bundled assets
- **[v0.4.1](/logscope/releases/v-0-4-1/)** &mdash; 2026-04-01 &mdash; Non-Nordic device detection
- **[v0.4.0](/logscope/releases/v-0-4-0/)** &mdash; 2026-03-31 &mdash; Anonymous telemetry
- **[v0.3.2](/logscope/releases/v-0-3-2/)** &mdash; 2026-03-31 &mdash; Updated README with improved feature descriptions
- **[v0.3.1](/logscope/releases/v-0-3-1/)** &mdash; 2026-03-31 &mdash; "Why LogScope?" comparison table in README showing LogScope vs nRF Terminal capabilities
- **[v0.3.0](/logscope/releases/v-0-3-0/)** &mdash; 2026-03-21 &mdash; Multi-parser support
- **[v0.2.6](/logscope/releases/v-0-2-6/)** &mdash; 2026-03-23 &mdash; Activity bar icon updated — structured log columns design (level | module | message)
- **[v0.2.5](/logscope/releases/v-0-2-5/)** &mdash; 2026-03-23 &mdash; Multi-probe support
- **[v0.2.4](/logscope/releases/v-0-2-4/)** &mdash; 2026-03-23 &mdash; Fix device scanning on Windows — Python resolution now tries both `python` and `python3` across all platforms
- **[v0.2.3](/logscope/releases/v-0-2-3/)** &mdash; 2026-03-21 &mdash; New icon: magnifying glass over colored log lines (replaces oscilloscope waveform)
- **[v0.2.2](/logscope/releases/v-0-2-2/)** &mdash; 2026-03-20 &mdash; Include updated changelog in marketplace listing (was missing 0.2.0/0.2.1 entries)
- **[v0.2.1](/logscope/releases/v-0-2-1/)** &mdash; 2026-03-20 &mdash; Fix panel showing "Disconnected" when closed and reopened during active connection
- **[v0.2.0](/logscope/releases/v-0-2-0/)** &mdash; 2026-03-20 &mdash; Serial UART transport
- **[v0.1.7](/logscope/releases/v-0-1-7/)** &mdash; 2026-03-19 &mdash; Prevent J-Link TCP/IP dialog popup when no USB probe is connected
- **[v0.1.1](/logscope/releases/v-0-1-1/)** &mdash; 2026-03-19 &mdash; Crash and fault detection — auto-detects hard faults, bus faults, watchdog resets, assertion failures
- **[v0.1.0](/logscope/releases/v-0-1-0/)** &mdash; 2026-03-18 &mdash; Initial VS Code Marketplace release

<!-- RELEASES-LIST-END -->

## Stay updated

- Watch [the GitHub repo](https://github.com/NovelBits/logscope) to get notified of new releases.
- Star the repo if you find LogScope useful.
- Report issues or request features via [GitHub Issues](https://github.com/NovelBits/logscope/issues).
