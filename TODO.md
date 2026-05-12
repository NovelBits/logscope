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
