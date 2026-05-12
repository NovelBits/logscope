# LogScope TODO

Running list of deferred work — items that are well-understood and ready to pick up but not the highest priority right now. New entries go at the top within each section.

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

### Search filter persists across device-switch
**Origin:** observed 2026-05-11 during a screenshot capture session for the LinkedIn anchor carousel. User disconnected from one nRF54L15DK and connected to another; the previous device's search filter (`Heartbeat`) remained active, hiding most entries in the new connection's buffer. The status bar said "4 entries" but only 1 was visible. Real user confusion.

**The bug:** `searchQuery` (or equivalent webview state) is not cleared on device-change. The filter is a per-session property of the user's intent, not a per-device property of the data.

**Suggested fix:** on the disconnect → reconnect cycle, either:
- Clear the search query automatically (simple, default-safe), or
- Show a non-blocking toast: "Filter 'X' carried over from previous device. [Clear] [Keep]" (preserves user intent when they really do want it)

The toast approach is friendlier but requires UI work. Clearing is one line.

**Pickup notes:**
- Trace `searchQuery` reset path in `src/extension.ts` and `src/ui/webview/main.ts`
- The disconnect handler (or `setupConnectFlow` reconnect path) is the right place to fire it
- Add a Jest test that asserts the search query is empty after a disconnect → reconnect cycle

### Reset detection fires on initial connect to long-running board
**Origin:** observed 2026-05-11 during the LinkedIn carousel capture session. Connecting to a silent-demo board that had been running for several minutes (firmware was steady, no physical reset performed) immediately produced a `⚠ Device Reset Detected` separator in the buffer alongside the firmware's boot lines.

**The bug:** `nrfutil-rtt.ts:370` emits a `reset` event when the helper prints `Reconnected OK`. That message is produced by `full_reconnect()` in `rtt-helper.py`. Either the first RTT attach legitimately goes through `full_reconnect()` (so the helper says "Reconnected OK" on first success), or `handle_read_error()` fires on the first read against a pre-existing control block and triggers a recovery cycle. Either way, LogScope treats first-connect as a reset event, which it is not.

**Why this matters:** muddies the silence-loop fix story (the v0.5.14 change was supposed to make the reset marker fire *only* on real mid-session resets). When a user connects to a long-running peripheral, they should not see a reset banner.

**Suggested fix:** distinguish "first successful attach" from "mid-session recovery" in the helper protocol. Two options:
- Helper emits a distinct first-attach message (e.g. `Attached OK`) on initial success and reserves `Reconnected OK` for actual recovery cycles. `nrfutil-rtt.ts` only emits `reset` on the latter.
- Or: the Node side gates `this.emit("reset")` behind a flag that flips true after the first successful chunk of log data has flowed through.

**Pickup notes:**
- Source of `Reconnected OK`: `src/transport/rtt-helper.py:286` (inside `full_reconnect()`).
- Source of `this.emit("reset")`: `src/transport/nrfutil-rtt.ts:370`.
- The "first successful chunk" gate is simpler to implement (single boolean in `NrfutilRttTransport`) but is less precise than fixing the helper-side semantics.
- Relates to the v0.5.14 work that capped silence escalation; that change was supposed to make reset detection precise but didn't address the first-connect path.

### Sidebar doesn't show which probe is currently connected
**Origin:** observed 2026-05-11 during the LinkedIn carousel capture session. User had two nRF54L15DKs plugged in (SN 1057721387 and SN 1057789294) and switched between them several times during the capture flow. The sidebar's "Device" field shows the target chip name (`nRF54L15`) but not the probe serial number, so there's no way to confirm from the sidebar which physical board the current session is talking to.

**The gap:** in single-probe workflows the active probe is implicit; in multi-probe workflows (Bluetooth LE central + peripheral, mesh nodes, board farms, central-vs-peripheral debugging) the sidebar gives no answer to "which one is this session?"

**Suggested fix:** add a sidebar row that shows the active probe identifier. Two options:
- New row: `Probe 1057721387` (J-Link serial number, or whatever transport-specific identifier applies, e.g. `/dev/tty.usbmodem...` for UART)
- Append to existing `Device` row: `Device nRF54L15 · 1057721387`

Either works; a dedicated row is clearer and avoids `Device` becoming a multi-purpose label.

**Pickup notes:**
- Sidebar state is in `src/ui/sidebar-provider.ts`
- The transport layer already knows the probe identifier (passed as `--dev-id` / `--snr` during connect)
- Surface it via `sidebarProvider.updateState({ probeId: snr })` on successful connect
- Add the row to the sidebar webview template
- Same row applies to UART (port path) and remote RTT (host:port) — make the field generic enough to fit all transports

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
