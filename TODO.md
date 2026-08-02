# LogScope TODO

Running list of deferred work — items that are well-understood and ready to pick up but not the highest priority right now. New entries go at the top within each section.

## Transport / RTT

### CPUID fallback should hint at setting `logscope.jlink.device` when it can't resolve a chip-specific name

**Origin:** GitHub issue #23 (pfvogel, 2026-05-13). User on Ubuntu VM connecting to a custom nRF54L15 board hit `JLinkReadException: Unspecified error` on the very first `memory_read` of the RTT magic scan in `session.attach()`. Root cause: `nrfutil` was not installed in his VM, so `detect_device()` returned `None, None` and the auto-resolution fell through to the CPUID-based fallback in `main()`. The CPUID fallback only identifies the ARM core (`Cortex-M33`), not the specific chip. libjlinkarm with the generic `Cortex-M33` device profile has no chip-specific memory map, and on this hardware it refuses memory reads from `0x20000000` (the standard ARM SRAM base) with "Unspecified error."

**Why this matters:** any user without `nrfutil` (Linux distros where it isn't packaged, fresh VMs, non-Nordic-development setups) hits this. The error message they see is the truncated Python traceback in the TransportError, which gives no hint that the workaround is to set the device name. JLinkRTTViewer works for the same user because they typed the chip name when they configured the connection there.

**Suggested fix (~10-15 min):** in `rtt-helper.py`, when the CPUID fallback resolves to a generic core name, additionally print a hint to stderr (which surfaces in the LogScope output channel and in the TransportError) suggesting the user set `logscope.jlink.device` to the chip-specific J-Link device name. Optionally, ship a short curated list of common Nordic/STM32/SiLabs/TI chip names in the hint so the user has examples to choose from. Don't fail the connect; just surface guidance.

**Bonus:** consider falling through to a slightly more permissive memory-read approach in `session.attach()` for the generic-core case (smaller initial scan range, or only try `0x20000000` + 0x10000 = 64KB first), so users who DO have RTT at a standard address get a working connection even with a generic device name. Not a hard requirement but would improve out-of-box experience.

### v0.6.1 follow-ups (post-v0.6.0 direct-memory RTT)

The mid-session-reset bug (originally tracked below as "Helper doesn't re-sync RTT control block after a target reset") was **fixed in v0.6.0** via the direct-memory RTT rewrite. Recovery is now automatic (~2.5 to 3 seconds on nRF54L15). These v0.6.1 items are optimizations and known-limitation follow-ups.

**Duplicate "Device Reset Detected" banner on TS side.** Hardware testing (2026-05-13) consistently showed two reset banners in the log panel for a single physical reset event. Helper only emits one `Reconnected OK` line, so the duplication is on the TypeScript side. Suspect: chunk-boundary in stderr buffering causes the per-line check in `_handleStderrLine` to fire twice when "Reconnected OK" arrives split across two read chunks. Investigate `nrfutil-rtt.ts` line splitting and consider adding a debounce/de-duplication on the `reset` emit.

**Cache `cb_addr` across reconnects to skip the memory scan.** `session.attach()` currently reads up to 512 KB of memory searching for the SEGGER RTT magic on every attach (initial AND re-attach). Cached `cb_addr` from the initial attach should be the first thing tried; only fall back to scan on mismatch. Empirical: scan is roughly half of `full_reconnect()`'s 2.5 s wall time on nRF54L15. Adding a `known_cb_addr` parameter to `session.attach()` and using it inside `full_reconnect()` should cut recovery to ~1.2 to 1.5 seconds.

**Investigate non-Nordic recovery time.** The `cheap_reinit()` path was added in v0.6.0 and fast-fails (~3 ms) on the nRF54L15 because the J-Link DLL apparently jams DAP state during reset on Nordic chips. On other vendors' hardware (STM32, SiLabs, TI) `jlink.connect()` may successfully re-init the AP/DP without USB cycling, in which case recovery becomes sub-second. Test on STM32H7 and EFR32 boards to confirm. If verified, the v0.6.0 design pays off as advertised on non-Nordic hardware.

**Shorten the 500 ms USB sleep in `full_reconnect()`.** The intentional `time.sleep(0.5)` between `close()` and `_open_jlink()` was added defensively. On modern J-Link probes (V12 firmware) USB re-enumeration is faster. Test 100 to 300 ms and pick the minimum that works reliably. Potential 200 to 400 ms savings.

**Test with non-silent firmware.** All hardware testing for v0.6.0 used the silent_demo firmware on nRF54L15DK. Confirm that recovery time on chatty firmware (regular logging every few seconds) is similar; sleep modes may shorten the SWD-jam window.

### Fake "Device Reset Detected" banner on initial connect to long-running board
**Origin:** observed 2026-05-11 during the LinkedIn carousel capture session. Initial fix attempted in v0.5.17 (boot-detection grace window in `extension.ts`) got reverted during the orphan-helper-bug investigation. With v0.5.18's orphan fix in place, the grace-window approach is safe to re-apply.

**The bug:** when LogScope attaches to a board that has been running for a while, the J-Link first drains the RTT control block's historical contents — which typically includes the firmware's original boot banner from when it was first powered on. The parser at `extension.ts` line 140 sees `*** Booting` in the drained text and fires `panel?.sendReset()`, producing a "Device Reset Detected" separator even though no reset has actually happened.

**Suggested fix (same approach as the reverted v0.5.17 attempt, now safe):** add a 2-second grace window after each connect. Boot banners during the initial drain quietly update `bootDetected` but do not fire the reset banner. Any boot banner past the grace window IS a real reset and fires.

### Fake "Device Reset Detected" banner on initial connect to long-running board
**Origin:** observed 2026-05-11 during the LinkedIn carousel capture session. Initial fix attempted in v0.5.17 (boot-detection grace window in `extension.ts`) got reverted during the orphan-helper-bug investigation. With v0.5.18's orphan fix in place, the grace-window approach is safe to re-apply.

**The bug:** when LogScope attaches to a board that has been running for a while, the J-Link first drains the RTT control block's historical contents — which typically includes the firmware's original boot banner from when it was first powered on. The parser at `extension.ts` line 140 sees `*** Booting` in the drained text and fires `panel?.sendReset()`, producing a "Device Reset Detected" separator even though no reset has actually happened.

**Suggested fix (same approach as the reverted v0.5.17 attempt, now safe):** add a 2-second grace window after each connect. Boot banners during the initial drain quietly update `bootDetected` but do not fire the reset banner. Any boot banner past the grace window IS a real reset and fires.

**Pickup notes:**
- Track `connectStartedAt: number | null = null` at module level.
- Set in `doConnect()` alongside `bootDetected = true`.
- Gate `panel?.sendReset()` in `handleChunk()` on `Date.now() - connectStartedAt > BOOT_RESET_GRACE_MS` (2000ms is fine).
- This is independent of the RTT-resync work above — both fixes are needed for a clean reset-detection story.

## UX / Connect-flow

### Guided-connect: avoid orphan sidebar state when wizard is abandoned
**Origin:** audit finding #8 (Important) in `docs/research/logscope-edge-cases-audit-2026-04-17.md`. Considered for the 2026-04-30 audit batch alongside #13/#8.1/#8.2/#4.2/#7.3, **implemented and reverted** because the fix-as-shipped removed mid-wizard sidebar feedback.

**The bug:** during the RTT guided-connect wizard, the sidebar's `selectedDevice`/`selectedDeviceLabel` are committed at step 3 (after device pick) before step 4 (target-device picker) completes. If the user abandons at step 4 (Esc, click away, or Back-too-far), the sidebar is left showing a probe they never actually connected to. Worse: the next time they look at the sidebar they may see a Reconnect button for that orphan probe.

**The reverted fix (commit lost; was in `extension.ts` `guidedConnect()` step 3 RTT branch):**
- Removed the `sidebarProvider.updateState({ transport: "rtt", selectedDevice, selectedDeviceLabel })` call at line ~796
- Re-added it at line ~846, just before `await doConnect()`, so sidebar only commits on success

**Why it was reverted:** the simple form removes mid-wizard sidebar feedback. While the user is on the target-device picker (step 4), the sidebar still shows their previous state — which feels like "did my pick register?" The QuickPick itself is the primary feedback, but the sidebar is also a visible surface and going stale in the middle of a flow is jarring.

**Better approach (for next attempt):** snapshot the previous sidebar state at wizard start, write the in-progress state mid-wizard for visual feedback, and roll back to the snapshot on abandonment. Pseudocode:
```typescript
const snapshot = sidebarProvider.snapshot();
try {
  // ... guided wizard, may write intermediate state ...
  await doConnect();  // commits permanently
} catch (BackError or undefined return) {
  sidebarProvider.restore(snapshot);
}
```

Requires adding `snapshot()` / `restore()` methods to `SidebarProvider`. Not a huge change but more invasive than the simple defer.

**Pickup notes:**
- Add snapshot/restore methods to `src/ui/sidebar-provider.ts`
- Wrap `guidedConnect()` body in try/finally with snapshot capture and restore-on-abandon
- Verify the UART branch (step 4 baud rate) doesn't have the same issue — looks like it commits state right before doConnect already, but check
- Telemetry abandonment events (`trackConnectFlowAbandoned`) are the natural restore points

### Log filter: exclude/mute a single chatty source (deselect one, not re-select all)
**Origin:** field request from a user call (2026-07-21); two users independently asked for it.
Today the log-source filter is select-what-you-want. Users want the inverse: keep everything visible but deselect/mute one specific noisy source (e.g. a chatty process/thread) without having to re-select every source they still care about. Add a per-source "mute/exclude" toggle so a single high-volume source can be hidden with one click, leaving the rest untouched.

### Shell/terminal integration alongside the log view
**Origin:** field request from a user call (2026-07-21).
Users want an interactive device shell in the same tool as the log: a shell/console pane (RTT shell or UART) sitting next to the log panel (top/bottom or left/right split), so they can interact with the device and see the correlated log without leaving LogScope. Ideally the shell's own output can be filtered together with the log.

## Hardening / Tests

### Python helper output contract test (pytest)
**Origin:** considered alongside the v0.5.11 hardening work after the v0.5.7→v0.5.10 silent-stdout regression (see [#11](https://github.com/NovelBits/logscope/issues/11)). Shipped #1 (Jest smoke test) and #2 (Node-side empty-stdout detection); deferred #3.

**What:** add a pytest suite under `test/python/` that exercises `src/transport/rtt-helper.py` directly in Python, asserting:
- `discover` always emits valid JSON with a `devices` key, regardless of pylink/SEGGER availability
- Each documented exit code (0, 2, 3, 4, 5) is reachable via the documented error paths
- The `_exit_skip_cleanup()` helper flushes stdout and stderr before `os._exit()`
- The framed stdout protocol used during `run_pylink` (channel + length + data) round-trips correctly with mocked pylink

**Why it's deferred:** the existing Jest smoke test (`test/rtt-helper-smoke.test.ts`) already catches the specific regression class that motivated this work — exit-without-flush. The pytest suite would add finer-grained Python-level coverage (e.g. catch a future contributor who refactors `_exit_skip_cleanup` and forgets the flush) but requires standing up Python test infrastructure (pytest, fixtures, possibly venv setup in CI) that we don't currently have.

**Pickup notes:**
- Add `requirements-dev.txt` with `pytest` (and `pytest-mock` for mocking pylink)
- Add a `test/python/` directory with `conftest.py` + tests
- Add a step to `.github/workflows/ci.yml` that runs `python3 -m pytest test/python/`
- The flush check can be a unit test that monkeypatches `os._exit` and verifies stdio was flushed before the call

### Single-session limitation: no concurrent multi-probe view
**Origin:** observed 2026-05-11 during the LinkedIn carousel capture session. Attempted to capture two LogScope panels side-by-side (one streaming HCI traffic from Board A, the other streaming generic application logs from Board B) for a "multi-probe" feature slide. LogScope only supports one active session per VS Code window: "Connect New Device" replaces the current connection rather than opening a parallel panel. The slide was scrapped because the feature doesn't exist as claimed.

**The gap:** Bluetooth LE workflows (central + peripheral debug), mesh node bring-up, and dev-board farms commonly need to watch multiple devices' RTT/UART simultaneously. Today this requires opening a second VS Code window. Cumbersome and not what most users will think to try.

**Suggested fix:** support concurrent sessions within a single VS Code window. Either:
- Multiple LogScope tab instances, each with its own session/sidebar/log buffer
- Or a "split view" within one LogScope tab, two log streams in a single grid

Tab-instance approach is closer to VS Code idioms (each tab is independent). Split-view is more compact for true side-by-side comparison work.

**Pickup notes:**
- Session/panel state in `src/extension.ts` and `src/ui/panel.ts` currently assumes a single global session. Lifting to a `Map<sessionId, Session>` is the structural change.
- Sidebar would need to gain a "session picker" or per-tab attachment.
- Each session's RTT transport, ring buffer, watch matcher, and webview need separate instances.
- License-gate consideration: multi-session is a natural Pro feature (limits to N=1 for free, unlimited for Pro), aligned with the existing license system.
- Marketing implications: this was supposed to be a slide-7 feature on the LinkedIn anchor carousel. After it ships, dedicate a launch post.
