# LogScope TODO

Running list of deferred work — items that are well-understood and ready to pick up but not the highest priority right now. New entries go at the top within each section.

## Transport / RTT

### Helper doesn't re-sync RTT control block after a target reset
**Origin:** observed 2026-05-12 while testing the orphan-helper fix in v0.5.18. With a live connection, pressing the board reset button does NOT make the new boot banner appear in the LogScope viewer. The new boot lines stay invisible until a disconnect/reconnect cycle, which forces a full RTT re-init by spawning a fresh helper process.

**The bug:** after a firmware reset the target's RTT control block has fresh offsets (WrOff=0, RdOff=0 if SRAM was cleared) but libjlinkarm's host-side cached `tracked_RdOff` is stale from before the reset. `jlink.rtt_read()` returns 0 bytes because libjlinkarm thinks it has already consumed everything past the new buffer's WrOff.

**What does NOT work (verified empirically 2026-05-12):** periodic `rtt_stop()` + `rtt_start()` from within the same pylink session. Despite SEGGER docs implying this re-syncs, libjlinkarm caches the host-side `tracked_RdOff` across stop/start in the same process. Only a full close-and-reopen of the J-Link probe (essentially `full_reconnect()` or a fresh helper subprocess) clears the cache — and `full_reconnect()` halts the target CPU on `jlink.connect()`, which reintroduces the issue #17 regression.

**Why this matters:** every user who connects to a long-running board and resets the firmware sees zero feedback in real time. Disconnect/reconnect works around it but is friction. This is also what's behind the "stuck in buffer" symptom users hit when debugging boot sequences.

**The right fix (v0.6.0 candidate):** implement RTT on top of direct target memory reads, bypassing libjlinkarm's high-level `JLINK_RTTERMINAL_*` API entirely. This is what RTT Viewer (SEGGER), probe-rs (Rust open source), OpenOCD, and Nordic's nrfutil all do. The control block layout is public (SEGGER's open-source `SEGGER_RTT.h`). Full implementation spec: `docs/session-handoff-2026-05-12-logscope-rtt.md` in the brain repo.

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
