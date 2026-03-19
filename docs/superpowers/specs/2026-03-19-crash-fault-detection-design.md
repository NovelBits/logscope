# Crash/Fault Detection v0.4 — Design Spec

## Overview

Detect common Zephyr RTOS crash and fault patterns in real-time log output. Highlight matched rows and auto-pause scrolling so faults don't fly past.

## Detection

A pure function in `src/parser/fault-detector.ts` that checks each log message against regex patterns. Returns a fault type if matched, `null` if not.

### Patterns

| Category | Patterns |
|----------|----------|
| Hard faults | `HARD FAULT`, `BUS FAULT`, `MEMORY FAULT`, `USAGE FAULT`, `SECURE FAULT` |
| Zephyr fatal | `ZEPHYR FATAL ERROR` |
| Assertions | `ASSERTION FAIL`, `__ASSERT`, `k_panic` |
| Stack overflow | `stack overflow`, `STACK OVERFLOW` |
| Watchdog | `watchdog`, `WDT timeout` |
| Generic crash | `Halting system`, `Fatal exception` |

All matching is case-insensitive.

### Function Signature

```typescript
interface FaultMatch {
  type: "hard-fault" | "assertion" | "stack-overflow" | "watchdog" | "fatal";
}

function detectFault(message: string): FaultMatch | null;
```

## UI Behavior

### Row Highlighting
- Matched rows get a `fault` CSS class
- Red left border, subtle red background tint
- Small warning indicator in the severity column

### Auto-Scroll Pause
- When a fault is detected, auto-scroll is paused immediately
- A brief notification appears: "Fault detected — auto-scroll paused"
- Notification auto-dismisses after 3 seconds
- User can re-enable auto-scroll normally via the existing toggle

## Architecture

| File | Change |
|------|--------|
| `src/parser/fault-detector.ts` | New file — pure detection function |
| `src/ui/webview/main.ts` | In `createRow()`, call detector, apply CSS class, pause auto-scroll |
| `src/ui/webview/styles.css` | `.log-row.fault` styling |
| `test/parser/fault-detector.test.ts` | Unit tests for each pattern type |

No changes to the extension host side — this is entirely webview-local.

## Testing

- Each fault pattern type detects correctly
- Case insensitivity works
- Normal log messages (containing partial matches like "watchdog timer initialized") do not false-positive
- Empty/undefined messages handled gracefully

## Future (not in v0.4)

- Multi-line fault block grouping (detect fault start, capture subsequent lines until terminator, collapsible group)
- Fault summary panel
