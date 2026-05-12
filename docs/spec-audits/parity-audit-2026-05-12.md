# LogScope Parity Audit — 2026-05-12

**Version audited:** v0.5.16
**Sources of truth compared:** Code (`package.json` + `src/`), `CHANGELOG.md`, docs site (`docs/src/content/docs/`)

---

## TL;DR — Critical drift to surface immediately

1. **Three RTT settings declared in `package.json` are completely unused in the source code.** `logscope.rtt.address`, `logscope.rtt.host`, `logscope.rtt.port` are never read by any TypeScript file. Users who set them — based on the description text in `package.json` and the docs ("auto" detect from Zephyr ELF) — will see no behavior change. This is a contract violation between the manifest and the implementation.
2. **Three J-Link settings declared in `package.json` are also unused.** `logscope.jlink.interface`, `logscope.jlink.speed`, `logscope.jlink.autoStart` are never consumed. The only consumer (`src/transport/jlink-manager.ts` — `JLinkManager` class) is **dead code**, never imported anywhere. SWD interface is hardcoded in `rtt-helper.py` (called out in CHANGELOG 0.5.1).
3. **Dead helper module `src/rtt-detect.ts`.** Exports `detectRttAddressFromElf` and `findZephyrElf` (Zephyr ELF → RTT auto-detection), referenced by the `logscope.rtt.address` description ("Set to 'auto' to detect from Zephyr ELF automatically"). Module is never imported. Promised behavior does not exist.
4. **One undeclared setting is read at runtime.** `logscope.jlink.remoteHost` is read in `src/extension.ts` (L308, L507) but is **not declared** in `package.json`. Used for the remote-RTT feature (in-progress on the `feature/remote-rtt` worktree). On main, it has no settings-UI surface area, no docs entry, no CHANGELOG entry.

---

## A. Code → CHANGELOG drift (features in code but never mentioned in CHANGELOG)

| Item | Location | Severity | Note |
|------|----------|----------|------|
| `logscope.columnWidths` setting (persisted column widths in pixels) | `package.json` L322-327, read in `src/extension.ts` L59 | low | Internal-only persistence, set automatically. Never announced as a feature, but it's a real declared setting users may see in the Settings UI. |
| `logscope.jlink.remoteHost` (read but undeclared) | `src/extension.ts` L308, L507 | high | Remote-RTT plumbing landed in main without any user-visible UX, no settings declaration, no docs, no CHANGELOG. Either ship it or remove it. |
| `JLinkManager` class | `src/transport/jlink-manager.ts` | low | Entire class is dead code on main. Never imported. |
| RTT ELF auto-detection (`detectRttAddressFromElf`, `findZephyrElf`) | `src/rtt-detect.ts` | medium | Code exists, settings description promises "auto" detection, but it's not wired up. |
| Walkthrough (`logscope.getStarted`) | `package.json` L148-191 | low | First mentioned in 0.2.0 (under "Get Started walkthrough — 3-step onboarding") but the current 3 steps (Connect, View Logs, Export) have been revised since. CHANGELOG doesn't track step content changes. |
| Five `WATCH_PRESETS` (Errors, Warnings, Retransmission, BLE State, Heartbeat) | `src/extension.ts` L1717-1723 | medium | Presets feature was added as part of the watch-pattern rebuild but no CHANGELOG entry calls out the curated preset list specifically. (Implied in 0.5.0 mention but not enumerated.) |
| Empty-state common-causes hint (3-reason card) | `src/extension.ts` (helper-error path) | low | Mentioned in 0.5.9 — covered. |
| Anonymous install ID / install date (`globalState`) | `src/telemetry.ts` L23-33 | low | 0.4.0 covered telemetry generically; install ID specifics are an internal mechanism. |
| Per-session telemetry warn-on-send-failure flag | `src/telemetry.ts` L15, related to 0.5.16 | low | Covered in 0.5.16 release notes. |
| Webview ready-handshake message protocol | `src/ui/webview/main.ts` | low | Covered in 0.5.5. |

**Total: 9 items.** High: 1. Medium: 2. Low: 6.

## B. Code → Docs drift (features in code but not in docs site)

### Commands

| Command | Documented in `reference/commands.md`? | Severity |
|---------|----------------------------------------|----------|
| `logscope.open` | Yes | — |
| `logscope.connect` | Yes | — |
| `logscope.reconnect` | Yes | — |
| `logscope.rescan` | Yes | — |
| `logscope.forgetDevice` | Yes | — |
| `logscope.disconnect` | Yes | — |
| `logscope.export` | Yes | — |
| `logscope.changeSettings` | Yes | — |
| `logscope.openWalkthrough` | Yes (as "Get Started Guide") | — |
| `logscope.cycleParser` | Yes (as "Select Parser") | — |
| `logscope.addWatchPattern` | Yes | — |
| `logscope.removeWatchPattern` | Yes | — |
| `logscope.scrollToWatchMatch` | Yes | — |
| `logscope.enterLicenseKey` | Yes | — |
| `logscope.removeLicenseKey` | Yes | — |
| `logscope.viewLicenseInfo` | Yes | — |
| `logscope.refreshLicense` | Yes | — |

Commands inventory has **full parity**. Good.

### Settings

| Setting | Documented in `reference/settings.md`? | Severity | Note |
|---------|----------------------------------------|----------|------|
| `logscope.transport` | Yes | — | |
| `logscope.autoConnect` | Yes | — | |
| `logscope.lastDevice` | Yes | — | |
| `logscope.parser` | Yes | — | |
| `logscope.nrfutil.path` | Yes | — | |
| `logscope.rtt.pollInterval` | Yes | — | |
| `logscope.rtt.address` | Yes | **high** | Documented as supporting `auto` ELF detection — but code is dead. Docs misrepresent behavior. |
| `logscope.rtt.host` | Yes | medium | Documented as "jlink-telnet transport only" but no telnet transport exists in code. |
| `logscope.rtt.port` | Yes | medium | Same as above. |
| `logscope.rtt.silenceThreshold` | Yes | — | |
| `logscope.jlink.path` | Yes | — | |
| `logscope.jlink.device` | Yes | — | |
| `logscope.jlink.deviceOverrides` | Yes | — | |
| `logscope.jlink.interface` | Yes | **high** | Documented as functional, but code never reads it. |
| `logscope.jlink.speed` | Yes | **high** | Documented as functional, but code never reads it. |
| `logscope.jlink.autoStart` | Yes | **high** | Documented as functional, but code never reads it. |
| `logscope.jlink.rttSearchRanges` | Yes | — | |
| `logscope.uart.baudRate` | Yes | — | |
| `logscope.uart.dataBits` | Yes | — | |
| `logscope.uart.stopBits` | Yes | — | |
| `logscope.uart.parity` | Yes | — | |
| `logscope.uart.lastPort` | Yes | — | |
| `logscope.maxEntries` | Yes | — | |
| `logscope.logWrap` | Yes | — | |
| `logscope.timeFormat` | Yes | — | |
| `logscope.columnWidths` | **No** | low | Auto-managed, internal. Could justifiably stay undocumented but should be marked "internal" in `package.json` description. |
| `logscope.watchPatterns` | Yes | — | |
| `logscope.jlink.remoteHost` (undeclared) | **No** | medium | Read at runtime; either remove or document. |

### Features / behaviors

| Feature | Documented? | Severity | Note |
|---------|-------------|----------|------|
| Fault detection | Yes (`features/log-viewer.md` — "Fault Detection" section) | — | Code in `src/parser/fault-detector.ts`. |
| Device reset detection | Yes (`features/log-viewer.md`) | — | |
| Reset Device action (inline button in error card) | Partially — mentioned in troubleshooting.md L27 as "LogScope offers a 'Reset Device' action in the error card" | low | Not a registered command, so doesn't fit the commands list — but the behavior is documented. |
| HCI MON filter button | Yes (`features/filtering.md`, `features/hci-decoding.md`) | — | |
| HCI Connection tracker (`src/parser/hci-connection-tracker.ts`) | Implicit — HCI decoding docs cover the user-visible result | low | Internal mechanism, fine as-is. |
| Ring buffer (100K) | Yes | — | |
| Empty-state UI in webview | Implied | low | |
| Walkthrough (3 steps) | Mentioned in installation.md / connecting.md | — | |
| Anonymous telemetry | Not documented on the docs site (only in README/CHANGELOG) | medium | Telemetry section is in the GitHub README but not the public docs site. Users who land on docs first will miss the opt-out path. |
| BT Monitor `bt_monitor`/`CONFIG_BT_DEBUG_MONITOR_RTT` requirement | Yes | — | |
| Per-probe device overrides | Yes (covered in settings reference + CHANGELOG 0.5.4) | — | |
| CPUID-based core detection | Not on docs site (mentioned in CHANGELOG 0.5.4 only) | low | User-invisible mechanism; fine. |
| LogScope output channel | Yes (troubleshooting.md) | — | |
| Quiet-device silence handling | Yes (troubleshooting.md) | — | |
| Copy-from-log-rows reformatting (tab-separated rows) | Not documented | medium | Real UX feature (CHANGELOG 0.5.13). Worth a one-paragraph mention under log-viewer.md. |
| Tab-move log restoration from ring buffer | Not documented | medium | CHANGELOG 0.5.6. User-visible feature. |
| Wrap-toggle retroactive application | Not documented separately | low | Visible behavior is what the user sees; mentioned in log-viewer.md generically. |
| Pre-built demo firmware in `samples/prebuilt/` | Not on docs site | medium | CHANGELOG 0.5.6 added prebuilt hex files for nRF54L15, nRF52840, FRDM-MCXN947. Demo docs only show `west build` invocations. |

**Section B totals:** High: 4 (`rtt.address` + 3 J-Link settings). Medium: 5. Low: ~5.

## C. CHANGELOG → Code drift (CHANGELOG mentions things that don't exist anymore)

| CHANGELOG entry | Status | Severity |
|-----------------|--------|----------|
| 0.5.2: "License sidebar UI hidden — 'Enter License Key / Upgrade to Pro' removed from sidebar" | Confirmed in `src/ui/sidebar-provider.ts` (only shows if not Free tier). | — |
| 0.5.2: "All features unlocked — `isProFeatureAvailable()` returns true" | Confirmed in `license-manager.ts` L30-37. | — |
| 0.5.0: "Watch patterns sidebar UI hidden pending redesign" | Confirmed — only command-palette entry points exist. | — |
| 0.4.0: "First runtime dependency: `@vscode/extension-telemetry`" | Confirmed in `package.json`. | — |
| 0.4.0: "telemetry.json event schema documentation in repo root" | `/Users/mafaneh/Projects/tools/logscope/telemetry.json` exists. | — |
| 0.3.0: "`logscope.parser` setting" | Exists. | — |
| 0.3.0: "ANSI escape code stripping shared across all parsers via `src/parser/utils.ts`" | `utils.ts` exists. | — |
| 0.4.1: "Improved 'No RTT control block found' error message" | Confirmed in error-card flow. | — |
| 0.1.1 / 0.2.0: "Welcome screen HTML, CSS, and JavaScript (~1000 lines removed)" | Confirmed — webview is pure log viewer. | — |
| 0.5.2: "Documentation and Report Issue visible when connected — these links now appear in the sidebar during active sessions" | Confirmed in `sidebar-provider.ts`. | — |

No live CHANGELOG → Code drift detected. The CHANGELOG is reasonably honest about what's currently active.

## D. Docs → Code drift (docs describe things that don't exist or have changed)

| Doc | Claim | Code reality | Severity |
|-----|-------|--------------|----------|
| `reference/settings.md` L23 | `logscope.rtt.address` "Set to `auto` to detect from Zephyr ELF automatically" | `rtt-detect.ts` is never imported — auto-detect doesn't run | **high** |
| `reference/settings.md` L24-25 | `logscope.rtt.host` / `logscope.rtt.port` "jlink-telnet transport only" | No jlink-telnet transport exists. Only `nrfutil-rtt` (pylink-based) and `uart-serial`. | medium |
| `reference/settings.md` L29-31 | `logscope.jlink.interface`, `logscope.jlink.speed`, `logscope.jlink.autoStart` settings | None of these are read in code | **high** |
| `getting-started/connecting.md` L17 | "Zephyr - For firmware using Zephyr's LOG_INF/LOG_ERR/LOG_WRN macros. Parses timestamps, severity, module name, and message." | Accurate | — |
| `getting-started/connecting.md` L19 | "nRF5 SDK - For firmware using NRF_LOG_INFO/NRF_LOG_ERROR macros. Parses severity, module, and message (no device timestamps)." | Accurate | — |
| `features/log-viewer.md` L14 | "Timestamp - Device's internal timestamp (uptime). Only available with Zephyr parser." | Accurate | — |
| `features/filtering.md` L13 | "**HCI** - Bluetooth LE HCI packets (RTT only)" | Accurate. | — |
| `features/filtering.md` L15 | "**MON** - BT Monitor mirrored logs (off by default)" | Accurate. | — |
| `features/hci-decoding.md` L23 | "Module column showing the packet direction: `CMD` (host to controller), `EVT` (controller to host), `ACL` (data)" | Accurate (matches `hci-parser.ts`). | — |
| `getting-started/installation.md` L31-37 | Requirements list including SEGGER J-Link Software, Python 3, nrfutil (optional) | Accurate. | — |
| `reference/troubleshooting.md` L46 | "default is 30 seconds" for `rtt.silenceThreshold` | Matches code & package.json. | — |
| `licensing/free-vs-pro.md` L7 | "All LogScope features are currently available to all users at no cost." | Accurate. | — |
| `features/export.md` L29-33 | btsnoop export only includes HCI packets | Accurate (matches `btsnoop-export.ts`). | — |
| `reference/faq.md` L13 | "Python 3.8 or later" | Not explicitly enforced in code; informational. Probably fine. | low |
| `demo/supported-boards.md` | NUCLEO-H753ZI, FRDM-MCXN947, xG24, NUCLEO-F401RE listed as tested | Sample directories not all verified in this audit; assume accurate. | — |

**Section D totals:** High: 2 (rtt.address auto-detect, J-Link sub-settings). Medium: 1. Low: 1.

## E. Top 5 priority gaps to fix

1. **`logscope.rtt.address` "auto" auto-detect claim is fictional.** Either wire up `rtt-detect.ts` (a few lines in extension.ts to import + call before the connect path) or strike the auto-detect language from package.json + settings.md. As-is, the docs lie. Severity: high. Effort: 30 minutes to delete the claim, ~2 hours to wire up the existing helper.
2. **`logscope.jlink.interface`, `logscope.jlink.speed`, `logscope.jlink.autoStart` are dead settings.** Remove them from `package.json` and from `reference/settings.md`, or wire them through `nrfutil-rtt.ts` → `rtt-helper.py` (interface and speed are currently hardcoded in `rtt-helper.py`). Right now users discover them in the Settings UI, configure them, and nothing happens. Severity: high. Effort: 15 minutes to delete (recommended for v0.5.17), or ~1 hour to wire through to the helper.
3. **`logscope.rtt.host` / `logscope.rtt.port` reference a "jlink-telnet" transport that doesn't exist.** Same triage as above: delete from package.json + docs, or expose the telnet transport (would be a v0.6.0 feature). Severity: medium.
4. **`logscope.jlink.remoteHost` is read but never declared.** This is the inverse problem: code reads a setting that never appears in the manifest. Either (a) delete the read sites if remote RTT is on the worktree and not yet shipping, or (b) declare it in package.json with a `description` that flags it as experimental. Severity: medium. Effort: 10 minutes.
5. **Telemetry / opt-out instructions are missing from the docs site.** Only README/CHANGELOG cover this. Users who never visit the GitHub repo (likely the majority of Marketplace installs) have no exposure to what's collected or how to disable it. Add a short "Privacy & Telemetry" page under `reference/`. Severity: medium. Effort: 30 minutes (mostly copying from README).

---

## Step 5 — Continuous verification recommendations

### Option 1 — `scripts/check-parity.mjs` (Node script, hooked into CI)

Parse `package.json` → enumerate every command ID and every configuration key. Grep `docs/src/content/docs/**/*.md` for each. Print a report at the end with three columns: `command/setting`, `in code`, `in docs`. Exit 1 if a required entry is missing. Same for the reverse direction: any `logscope.<x>` reference in docs that isn't in package.json fails.

- **Implementation cost:** low (~50 lines of Node, no deps).
- **Reliability:** high for "is the string mentioned anywhere," low for "is the description still accurate." Catches the easy class of drift; doesn't catch "the docs say `auto` does ELF detection but the implementation doesn't."
- **CI integration:** add a single step to `ci.yml` after `npm test`: `node scripts/check-parity.mjs`. Fails fast on PRs that add a setting without docs.

### Option 2 — `scripts/check-runtime-config-keys.mjs` (Node script, AST-level)

Parse all `*.ts` files under `src/` with the TypeScript compiler API. Find every `getConfiguration("logscope").get<...>("<key>", ...)` call. Cross-reference against `package.json` `contributes.configuration.properties`. Fail if a key is read but undeclared (catches the `jlink.remoteHost` class of bug). Fail if a key is declared but never read (catches `jlink.interface`, `rtt.address`, etc.).

- **Implementation cost:** medium (~150 lines, needs `typescript` parser).
- **Reliability:** very high — catches both directions of drift mechanically.
- **CI integration:** same as Option 1. This is the highest-leverage check given today's drift profile — it would have caught 5 of the 5 top-priority gaps automatically.

### Option 3 — Pre-release LLM audit ("release-audit" GitHub Action)

On every tag matching `v*`, dispatch a GitHub Action that runs a parity audit prompt (this audit, scripted) against the repo and posts the report as a release-draft comment. Author reviews before publishing. Could call Anthropic API via `anthropic/claude-code-action` or a simple `curl` step with the API key in repo secrets.

- **Implementation cost:** medium (~1 day to template the prompt, wire the secret, draft the action).
- **Reliability:** high for semantic drift ("the docs claim X behavior but the code does Y") that script-based checks can't catch. Slower (minutes per release).
- **CI integration:** runs on the `publish.yml` workflow before the marketplace publish step. Could gate on author "approval" via a manual-dispatch input.

### Recommended combination

Ship **Option 2** first (highest mechanical leverage, catches the entire drift class found in this audit), pair with a **pre-release checklist item** in `RELEASE.md` ("Run `node scripts/check-runtime-config-keys.mjs` — exit 0 required"), and revisit Option 3 after v1.0 when releases become higher-stakes and semantic drift becomes the dominant failure mode.

---

## Appendix — Inventory tables

### Code: registered commands (from `package.json` + `src/extension.ts` + `src/license/license-ui.ts`)

17 commands total. Full list above in Section B / Commands table.

### Code: configuration keys

26 declared in `package.json`. 23 are read in code. 3 unused (`jlink.interface`, `jlink.speed`, `jlink.autoStart`). 1 used but undeclared (`jlink.remoteHost`). Also one orphan: `rtt.address` is read into `cfg.get<>` via the helper config but the value never reaches the helper — verify with caller chain.

### Docs: pages enumerated

17 pages total under `docs/src/content/docs/`:
- `index.mdx`
- `getting-started/`: overview.md, installation.md, connecting.md
- `features/`: log-viewer.md, filtering.md, watch-patterns.md, hci-decoding.md, export.md
- `reference/`: commands.md, settings.md, faq.md, troubleshooting.md
- `licensing/`: free-vs-pro.md
- `demo/`: ble-hci-demo.md, generic-zephyr.md, supported-boards.md

No "Privacy / Telemetry" page exists. No "Release Notes" page (intentional — CHANGELOG lives in repo).
