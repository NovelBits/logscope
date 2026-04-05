---
title: Free vs Pro
description: What's included in LogScope Free and what Pro unlocks
---

LogScope Free is a fully functional log viewer. Pro adds advanced monitoring capabilities.

## Feature Comparison

| Feature | Free | Pro |
|---------|------|-----|
| Real-time log viewing | Yes | Yes |
| J-Link RTT and Serial UART | Yes | Yes |
| Zephyr, nRF5 SDK, and Raw parsers | Yes | Yes |
| Severity and module filtering | Yes | Yes |
| Text search | Yes | Yes |
| HCI packet decoding | Yes | Yes |
| Export (Text, JSONL, btsnoop) | Yes | Yes |
| Auto-connect | Yes | Yes |
| Multi-probe support | Yes | Yes |
| Fault detection | Yes | Yes |
| **Watch patterns** | **3 patterns** | **Unlimited** |

## What Stays Free Forever

All current features remain free. LogScope Pro only adds new capabilities on top of the free tier. We will never move existing free features behind a paywall.

## Pricing

- **Free:** $0, forever
- **Pro:** $9/month or $79/year per seat

Visit [novelbits.io/tools/pricing](https://novelbits.io/tools/pricing) for details.

## How the Free Limit Works

With 3 free watch patterns, you can:

- Add patterns via the sidebar presets or custom flow
- See colored dot markers and live sidebar counters
- Click counters to scroll to matches
- Use all pattern options (regex, module scope, custom colors)

The sidebar shows your usage: "2/3 used" on the Add Watch Pattern button, and "3/3 free" on the Watch Patterns label when at the limit.

When you try to add a 4th pattern, LogScope shows an upgrade prompt with options to enter a license key or view pricing.

If you add patterns directly in `settings.json` beyond the limit, only the first 3 are active. A notification explains the limit.
