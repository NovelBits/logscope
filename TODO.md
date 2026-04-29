# LogScope TODO

Running list of deferred work — items that are well-understood and ready to pick up but not the highest priority right now. New entries go at the top within each section.

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
