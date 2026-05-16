# LogScope Roadmap

This document captures the path from v0.6.x to 1.0. It's strategic intent, not a tracked task list (see `TODO.md` for the granular work).

## Vision

LogScope 1.0 is the embedded-firmware log viewer that **Bluetooth LE engineers reach for first**. Built by Novel Bits, the team behind the Bluetooth Developer Academy and the most-cited Bluetooth LE tutorials on the web.

Where SEGGER RTT Viewer ends at "raw bytes streamed to a console," LogScope begins. It parses, decodes, correlates, and visualizes embedded firmware activity with first-class understanding of Zephyr, nRF Connect SDK, and the Bluetooth LE stack.

## What "1.0" means

- **Stability:** zero known critical bugs, comprehensive test coverage across CB parsing, multi-vendor probes, and recovery paths. Real users in production.
- **Polish:** every interactive surface feels intentional, not beta. Connect flow, error toasts, sidebar, log panel, settings; all consistent and discoverable.
- **Bluetooth LE expertise visible everywhere:** features only a tool from a Bluetooth LE company would think to build (see Theme 1 below). The thing that makes a reviewer say "you can tell who built this."
- **Multi-device, multi-session, multi-modal:** matches how real embedded teams work. No more single-probe limitation.
- **Documentation that teaches, not just references:** first 5 minutes is a tutorial; the rest is a reference; cookbook entries cover custom parsers, BLE debug sessions, and CI integration.

## Themes

### Theme 1: Bluetooth LE first-class citizen

The biggest differentiator. Today LogScope decodes HCI commands and events from Zephyr's `btmonitor` channel. 1.0 deepens this to the point where LogScope is the obvious tool for any BLE debug task on Zephyr or nRF Connect SDK.

- Full HCI 5.x command/event coverage with named fields, not just opcodes
- L2CAP signaling channel decode (Connection Parameter Update Request, etc.)
- ATT / GATT protocol decode: Read / Write / Notify / Indicate with characteristic UUID context resolved against the current GATT database
- SMP pairing-flow visualization: LE Legacy + LE Secure Connections step-by-step, with each PDU labeled by its role in the flow
- Advertising data decoder: AD types parsed into named fields (Complete Local Name, Service UUIDs, Manufacturer Data with Company Identifier name resolved)
- Connection timing analytics: connection interval, peripheral latency, supervision timeout, throughput, and visualization of the negotiated parameters over time
- Inline Bluetooth Core Spec hyperlinks: click any HCI event / ATT error / SMP failure code to jump to the section in the Core Spec that defines it (leverages the bluetooth-spec MCP)
- BLE error code lookup with vendor-quirks context (Nordic-specific HCI errors, Apple-specific GATT behaviors, Android-specific GAP edge cases)
- Optional sniffer correlation: import a pcap from nRF Sniffer / Wireshark and align it with the RTT timeline so you see both sides of the wire

### Theme 2: Multi-device workflows

Today's single-probe limit is the most-requested UX gap. Real BLE work involves central + peripheral, gateway + sensor, mesh nodes; never just one device.

- Concurrent connections to multiple probes from one LogScope window
- Cross-probe timeline correlation: timestamps aligned, events from different devices threaded into a unified view
- Per-probe filters layered on top of the unified view (show only Central's HCI events plus Peripheral's app logs, etc.)
- Multi-probe session save / replay (every probe captured into one session file)

### Theme 3: Session management

Captures, replay, share, compare. The "I want to attach this session to a bug report" workflow.

- Session save: full session capture to `.logscope` file (entries + metadata + parser config + watch patterns)
- Session replay: load a captured session, navigate offline, share with collaborators or auditors who don't have the hardware
- Session compare: two captures side-by-side with diff view (firmware A vs firmware B, this CI run vs the last green one)
- "Attach this `.logscope` to the GitHub issue" workflow: one-click export, reproducible bug reports

### Theme 4: Recovery & reliability

Sub-second mid-session recovery, no probe surprises.

- Cb_addr caching: skip the 512 KB CB scan on re-attach (gets Nordic reset recovery to ~1.5 s)
- Further recovery investigation: target sub-second on Nordic (currently ~2.5 s floor due to USB close+reopen)
- Remote J-Link Remote Server: shipped, polished, documented (the natural workflow for shared lab boards and CI)
- Better non-Nordic chip auto-detect: STM32, SiLabs, TI, ESP32 chip families recognized, right J-Link device name surfaced
- All "fake reset banner" / "initial connect" UX rough edges resolved
- Graceful handling of probe disconnect / USB cable wobble (already mostly working as of v0.6.x; further hardening)

### Theme 5: Custom parsers + ecosystem

LogScope today ships Zephyr / HCI / raw parsers. To grow beyond the Zephyr ecosystem (FreeRTOS, NuttX, vendor RTOSes, bare-metal firmware), users need to teach LogScope their format.

- Custom parser API: write a small JavaScript / TypeScript module or a declarative config that defines pattern → fields mapping
- Parser cookbook: stock examples for FreeRTOS-cli, ESP-IDF, Mbed OS, SiLabs RAIL
- Parser sharing: marketplace-like discovery, or just a GitHub directory the community contributes to

### Theme 6: Polish & docs

- All TODO.md items closed
- Comprehensive docs site (already on Vercel, Starlight/Astro)
- Tutorial videos: first 5 minutes with LogScope, BLE debug session walkthrough, custom parser tutorial
- Recorded "what does this tool do" demo for the Marketplace listing page

## Proposed sequencing (rough)

Roughly 5 focused sprints, each shippable as an incremental v0.7 / v0.8 / etc. on the way to 1.0.

**Sprint 1 (the foundation):** Session save / restore (Theme 3) + cb_addr caching for faster Nordic reset recovery (Theme 4). Both well-spec'd already; both unblock other work.

**Sprint 2 (the signature):** Bluetooth LE deep decode (Theme 1, minimum: ATT / GATT + inline Core Spec hyperlinks). This is the move that signals "Novel Bits built this." Use the bluetooth-spec MCP we already maintain.

**Sprint 3 (the workflow win):** Multi-probe / multi-session (Theme 2). Biggest UX gap; biggest scope risk. The single-probe assumption is baked into the sidebar provider, transport state, and the panel.

**Sprint 4 (the platform):** Remote RTT polished and shipped (Theme 4) + non-Nordic auto-detect improvements + custom parser API skeleton (Theme 5).

**Sprint 5 (the launch):** Polish pass over every interactive surface. Tutorial videos. Marketplace listing refresh. 1.0 announcement.

## Out of scope for 1.0

Things that are tempting but should wait for 1.x:

- Non-J-Link probe support (CMSIS-DAP, ST-Link). Real ask but expands the support surface significantly.
- Embedded-Linux-style logging (journald, dmesg). Different problem space.
- A CLI mode that captures sessions without VS Code. Could be a future companion tool.
- Cloud-hosted session storage. Distinct deployment surface; revisit after 1.0.
- Web version of LogScope. Distinct product.

## Risks worth naming

- **The Nordic reset-recovery floor.** Direct-memory RTT bottoms out at ~1.5 s even after cb_addr caching, because J-Link DLL requires a USB close+reopen to unjam the DAP. Getting below that requires either a different RTT mechanism or a J-Link DLL improvement we don't control.
- **Multi-probe complexity.** Single-probe is baked deep into the architecture. Multi-probe is the kind of feature that can swallow a sprint and then some.
- **BLE deep decode maintenance.** Bluetooth Core Spec evolves (6.2, 6.3, ...). Whatever we ship has to be maintainable as new versions land.
