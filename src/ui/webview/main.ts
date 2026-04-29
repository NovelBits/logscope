// WebView client — runs in the browser context inside VS Code's WebView.
// Communicates with the extension host via postMessage / onDidReceiveMessage.
// Connection controls now live in the sidebar; this is a pure log viewer.

import { detectFault } from "../../parser/fault-detector";

interface DecodedPacket {
  summary: string;
  fields: { name: string; value: string; color?: string }[];
}

interface SerializedEntry {
  timestamp: number;
  receivedAt?: number;
  severity: string;
  module: string;
  message: string;
  source: string;
  decoded?: DecodedPacket;
  raw?: number[];
  watchHits?: { name: string; color: string }[];
}

// ── VS Code API handle ──────────────────────────────────────────
// @ts-expect-error — acquireVsCodeApi is injected by the WebView host
const vscode = acquireVsCodeApi();

// ── DOM references ──────────────────────────────────────────────
const timeline = document.getElementById("timeline")!;
const moduleSelect = document.getElementById("module-select") as HTMLSelectElement;
const modulePickerBtn = document.getElementById("module-picker-btn")!;
const modulePickerText = document.getElementById("module-picker-text")!;
const modulePickerList = document.getElementById("module-picker-list")!;
const searchInput = document.getElementById("search-input") as HTMLInputElement;
const autoScrollBtn = document.getElementById("auto-scroll-btn")!;
const clearBtn = document.getElementById("clear-btn")!;
const statusConnection = document.getElementById("status-connection")!;
const statusCount = document.getElementById("status-count")!;
const statusEvicted = document.getElementById("status-evicted")!;

const viewerEl = document.getElementById("viewer")!;
const newDataBar = document.getElementById("new-data-bar")!;
const endOfLog = document.getElementById("end-of-log")!;
const emptyState = document.getElementById("empty-state")!;
const connDevice = document.getElementById("conn-device")!;
const connectionBar = document.getElementById("connection-bar")!;
const reconnectBar = document.getElementById("reconnect-bar")!;
const connectToggleBtn = document.getElementById("connect-toggle-btn")!;
const connStatusDot = document.getElementById("conn-status-dot")!;
const connStatusText = document.getElementById("conn-status-text")!;
const exportBtn = document.getElementById("export-btn")!;
const reconnectBtn = document.getElementById("reconnect-btn")!;
const dismissBtn = document.getElementById("dismiss-btn")!;
let isConnected = false;
const wrapBtn = document.getElementById("wrap-btn")!;
const timestampBtn = document.getElementById("timestamp-btn")!;
const dateBtn = document.getElementById("date-btn")!;

// ── State ───────────────────────────────────────────────────────
let autoScroll = true;
let timestampsVisible = true;
let dateVisible = false;
const activeSeverities = new Set(["hci", "err", "wrn", "inf", "dbg"]);
let selectedModule = ""; // "" means all modules
let searchText = "";
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let wrapEnabled = false;

// ── Timestamp formatting ────────────────────────────────────────
function formatTimestamp(us: number): string {
  const totalSec = Math.floor(us / 1_000_000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  const millis = Math.floor((us % 1_000_000) / 1_000);
  return (
    String(hours).padStart(2, "0") +
    ":" +
    String(minutes).padStart(2, "0") +
    ":" +
    String(seconds).padStart(2, "0") +
    "." +
    String(millis).padStart(3, "0")
  );
}

let use12HourTime = false;

function formatDate(epochMs: number): string {
  const d = new Date(epochMs);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatClock(epochMs: number): string {
  const d = new Date(epochMs);
  const mins = String(d.getMinutes()).padStart(2, "0");
  const secs = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");

  if (use12HourTime) {
    let hours = d.getHours();
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12 || 12;
    return `${hours}:${mins}:${secs}.${ms} ${ampm}`;
  }
  return `${String(d.getHours()).padStart(2, "0")}:${mins}:${secs}.${ms}`;
}

// ── Row creation (XSS-safe: uses textContent, never innerHTML) ──
function createRow(entry: SerializedEntry): HTMLDivElement {
  const row = document.createElement("div") as HTMLDivElement & { _decoded?: DecodedPacket; _raw?: number[] };
  const cssClass = entry.source === "hci" ? "hci" : entry.severity;
  row.className = `log-row ${cssClass}`;

  const time = document.createElement("span");
  time.className = "time";
  if (entry.receivedAt) {
    time.dataset.epoch = String(entry.receivedAt);
    const dateSpan = document.createElement("span");
    dateSpan.className = "time-date";
    dateSpan.textContent = formatDate(entry.receivedAt);
    const clockSpan = document.createElement("span");
    clockSpan.className = "time-clock";
    clockSpan.textContent = formatClock(entry.receivedAt);
    time.appendChild(dateSpan);
    time.appendChild(clockSpan);
  }

  const ts = document.createElement("span");
  ts.className = "ts";
  ts.textContent = formatTimestamp(entry.timestamp);

  const sev = document.createElement("span");
  sev.className = "sev";
  sev.textContent = entry.source === "hci" ? "HCI" : entry.severity.toUpperCase();

  const mod = document.createElement("span");
  mod.className = "mod";
  mod.textContent = entry.module;
  mod.title = entry.module;

  const msg = document.createElement("span");
  msg.className = "msg";
  msg.textContent = entry.message;
  msg.title = entry.message;

  // Make HCI rows with decoded data expandable
  if (entry.decoded) {
    row.classList.add("hci-expandable");
    row.setAttribute("tabindex", "0");
    row._decoded = entry.decoded;
    row._raw = entry.raw;

    // Expand icon inside module column (right edge, like a tree disclosure)
    const expandIcon = document.createElement("span");
    expandIcon.className = "expand-icon";
    expandIcon.textContent = "\u25B6";
    mod.appendChild(expandIcon);
  }

  // Fault detection
  const fault = detectFault(entry.message);
  if (fault) {
    row.classList.add("fault");
    // Auto-pause scrolling so the fault doesn't fly past
    if (autoScroll) {
      autoScroll = false;
      autoScrollBtn.classList.remove("active");
      showFaultNotification();
    }
  }

  // Watch pattern markers
  if (entry.watchHits && entry.watchHits.length > 0) {
    const markers = document.createElement("span");
    markers.className = "watch-markers";
    for (const hit of entry.watchHits) {
      const dot = document.createElement("span");
      dot.className = "watch-dot";
      dot.style.backgroundColor = hit.color;
      dot.title = hit.name;
      markers.appendChild(dot);
    }
    row.appendChild(markers);
  }

  row.appendChild(time);
  row.appendChild(ts);
  row.appendChild(sev);
  row.appendChild(mod);
  row.appendChild(msg);

  return row;
}

// ── Fault notification ──────────────────────────────────────────
function showFaultNotification(): void {
  // Remove any existing notification
  const existing = document.querySelector(".fault-notification");
  if (existing) existing.remove();

  const notification = document.createElement("div");
  notification.className = "fault-notification";
  notification.textContent = "Fault detected \u2014 auto-scroll paused";
  document.body.appendChild(notification);

  // Auto-dismiss after animation completes
  setTimeout(() => notification.remove(), 3000);
}

// ── Hex dump formatting ─────────────────────────────────────────
function formatHexDump(raw: number[]): string {
  const lines: string[] = [];
  for (let i = 0; i < raw.length; i += 16) {
    const offset = i.toString(16).padStart(4, "0");
    const chunk = raw.slice(i, i + 16);
    const hexParts: string[] = [];
    const asciiParts: string[] = [];
    for (let j = 0; j < 16; j++) {
      if (j < chunk.length) {
        hexParts.push(chunk[j].toString(16).padStart(2, "0"));
        asciiParts.push(chunk[j] >= 0x20 && chunk[j] <= 0x7e ? String.fromCodePoint(chunk[j]) : ".");
      } else {
        hexParts.push("  ");
        asciiParts.push(" ");
      }
    }
    const hexLeft = hexParts.slice(0, 8).join(" ");
    const hexRight = hexParts.slice(8).join(" ");
    lines.push(offset + "  " + hexLeft + "  " + hexRight + "  " + asciiParts.join(""));
  }
  return lines.join("\n");
}

// ── Build detail div for expanded HCI rows ──────────────────────
function buildDetailDiv(decoded: DecodedPacket, raw?: number[], row?: HTMLElement): HTMLDivElement {
  const detail = document.createElement("div");
  detail.className = "hci-detail";

  // Spacer to align content with the message column
  const spacer = document.createElement("div");
  spacer.className = "hci-detail-spacer";
  // Measure the offset of the .msg element in the parent row
  if (row) {
    const msgEl = row.querySelector(".msg") as HTMLElement | null;
    if (msgEl) {
      spacer.style.width = msgEl.offsetLeft - 10 + "px"; // 10px = row padding
    }
  }
  detail.appendChild(spacer);

  // Content wrapper
  const content = document.createElement("div");
  content.className = "hci-detail-content";

  // Fields table
  const table = document.createElement("table");
  table.className = "hci-fields";
  for (const field of decoded.fields) {
    const tr = document.createElement("tr");
    const tdName = document.createElement("td");
    tdName.className = "field-name";
    tdName.textContent = field.name;
    const tdValue = document.createElement("td");
    tdValue.className = "field-value";
    tdValue.textContent = field.value;
    if (field.color) {
      tdValue.style.color = field.color;
    }
    tr.appendChild(tdName);
    tr.appendChild(tdValue);
    table.appendChild(tr);
  }
  content.appendChild(table);

  // Hex dump toggle + content
  if (raw && raw.length > 0) {
    const toggle = document.createElement("div");
    toggle.className = "hex-toggle";
    toggle.textContent = "\u25B6 Show raw hex (" + raw.length + " bytes)";

    const pre = document.createElement("pre");
    pre.className = "hex-dump hidden";
    pre.textContent = formatHexDump(raw);

    toggle.addEventListener("click", (e: Event) => {
      e.stopPropagation();
      const isHidden = pre.classList.toggle("hidden");
      toggle.textContent = (isHidden ? "\u25B6 Show" : "\u25BC Hide") + " raw hex (" + raw.length + " bytes)";
    });

    content.appendChild(toggle);
    content.appendChild(pre);
  }

  detail.appendChild(content);
  return detail;
}

// ── Expand/collapse HCI rows (delegated click handler) ──────────
function collapseExpandedRow(): void {
  const expanded = timeline.querySelector(".log-row.expanded") as HTMLElement | null;
  if (expanded) {
    expanded.classList.remove("expanded");
    const detail = expanded.nextElementSibling;
    if (detail?.classList.contains("hci-detail")) {
      detail.remove();
    }
  }
}

timeline.addEventListener("click", (e: Event) => {
  const target = (e.target as HTMLElement).closest(".hci-expandable") as (HTMLDivElement & { _decoded?: DecodedPacket; _raw?: number[] }) | null;
  if (!target) return;

  if (target.classList.contains("expanded")) {
    // Collapse this row
    target.classList.remove("expanded");
    const detail = target.nextElementSibling;
    if (detail?.classList.contains("hci-detail")) {
      detail.remove();
    }
  } else {
    // Collapse any other expanded row first
    collapseExpandedRow();
    // Expand this row
    target.classList.add("expanded");
    if (target._decoded) {
      const detail = buildDetailDiv(target._decoded, target._raw, target);
      target.after(detail);
    }
  }
});

// ── Keyboard support for expandable HCI rows ────────────────────
timeline.addEventListener("keydown", (e: Event) => {
  const keyEvent = e as KeyboardEvent;
  if (keyEvent.key === "Enter" || keyEvent.key === " ") {
    const target = keyEvent.target as HTMLElement;
    if (target.classList.contains("hci-expandable")) {
      keyEvent.preventDefault();
      target.click();
    }
  }
});

// ── Copy reformatting ───────────────────────────────────────────
// Each .log-row uses display:flex with span children (.time, .ts, .sev, .mod,
// .msg). When a user selects across rows, the browser's default serializer
// emits each span on its own line because flex children behave like blocks
// for selection purposes — copy-pasting then looks like a vertical list of
// every cell, not one line per row. We intercept the copy event, find the
// log rows in the selection, and rebuild the clipboard payload as one
// tab-separated line per row. Single-span selections (e.g. copying part of
// a single message) fall through to default browser behavior.
function getRowText(row: HTMLElement): string {
  // Reset separators carry contextual meaning ("the entries that follow are
  // from a different boot"). Include them as a delineated line so a pasted
  // log keeps the boot boundary visible.
  if (row.classList.contains("reset-separator")) {
    const ts = row.querySelector(".reset-ts")?.textContent?.trim() ?? "";
    const label = row.querySelector(".reset-label")?.textContent?.trim() ?? "Device Reset Detected";
    return `--- ${label}${ts ? " · " + ts : ""} ---`;
  }

  const cells: string[] = [];
  for (const cls of [".time", ".ts", ".sev", ".mod", ".msg"]) {
    const el = row.querySelector(cls);
    let text: string | undefined;
    if (cls === ".time") {
      // .time has two children (.time-date + .time-clock) that are visually
      // separated via CSS margin, but textContent concatenates them with no
      // separator. Join with a space so the clipboard payload is readable.
      const date = el?.querySelector(".time-date")?.textContent?.trim();
      const clock = el?.querySelector(".time-clock")?.textContent?.trim();
      text = [date, clock].filter(Boolean).join(" ");
    } else {
      text = el?.textContent?.trim();
    }
    if (text) cells.push(text);
  }
  return cells.join("\t");
}

const COPYABLE_SELECTOR = ".log-row, .reset-separator";

document.addEventListener("copy", (e: ClipboardEvent) => {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;

  // Collect every .log-row or .reset-separator that intersects the selection.
  // We walk the common ancestor for fully-contained rows, then check each
  // endpoint's ancestor chain to catch single-row selections where the
  // TreeWalker root is the row itself.
  const range = selection.getRangeAt(0);
  const rows = new Set<HTMLElement>();
  const walker = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_ELEMENT, {
    acceptNode: (node) => {
      const el = node as HTMLElement;
      const isCopyable = el.classList?.contains("log-row") || el.classList?.contains("reset-separator");
      if (!isCopyable) return NodeFilter.FILTER_SKIP;
      return range.intersectsNode(el) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  let cur: Node | null = walker.nextNode();
  while (cur) { rows.add(cur as HTMLElement); cur = walker.nextNode(); }

  for (const node of [range.startContainer, range.endContainer]) {
    const el = (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement) as HTMLElement | null;
    const rowEl = el?.closest(COPYABLE_SELECTOR) as HTMLElement | null;
    if (rowEl) rows.add(rowEl);
  }

  // Single-element selections: let the browser do its thing — the user is
  // probably grabbing a substring, not a full row. Multi-row: reformat.
  if (rows.size <= 1) return;

  const sorted = Array.from(rows).sort((a, b) =>
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
  );
  const text = sorted.map(getRowText).join("\n");
  e.preventDefault();
  e.clipboardData?.setData("text/plain", text);
});

// ── Visibility check ────────────────────────────────────────────
function shouldShow(entry: SerializedEntry): boolean {
  // MON entries (BT Monitor mirrored logs): separate toggle
  if (entry.source === "hci" && entry.module === "MON") return activeSeverities.has("mon");
  // HCI entries: check if "hci" toggle is active
  if (entry.source === "hci" && !activeSeverities.has("hci")) return false;
  // Log entries: check severity toggle
  if (entry.source !== "hci" && !activeSeverities.has(entry.severity)) return false;
  if (selectedModule && entry.module !== selectedModule) return false;
  if (searchText) {
    const lower = searchText.toLowerCase();
    const levelLabel = entry.source === "hci" ? "hci" : entry.severity.toLowerCase();
    if (
      !entry.message.toLowerCase().includes(lower) &&
      !entry.module.toLowerCase().includes(lower) &&
      !levelLabel.includes(lower) &&
      !formatTimestamp(entry.timestamp).includes(lower)
    ) {
      return false;
    }
  }
  return true;
}

// ── Connection bar buttons ──────────────────────────────────────
connectToggleBtn.addEventListener("click", () => {
  if (isConnected) {
    vscode.postMessage({ type: "disconnect" });
  } else {
    // Ask extension to reconnect via sidebar state
    vscode.postMessage({ type: "triggerConnect" });
  }
});
exportBtn.addEventListener("click", () => vscode.postMessage({ type: "export" }));

reconnectBtn.addEventListener("click", () => {
  vscode.postMessage({ type: "triggerConnect" });
});

dismissBtn.addEventListener("click", () => {
  reconnectBar.classList.add("hidden");
});

// ── Timestamp toggle ────────────────────────────────────────────
timestampBtn.addEventListener("click", () => {
  timestampsVisible = !timestampsVisible;
  timestampBtn.classList.toggle("active", timestampsVisible);
  viewerEl.classList.toggle("hide-timestamps", !timestampsVisible);
});

// ── Auto-disable auto-scroll when user scrolls up ──────────────
let programmaticScroll = false;
timeline.addEventListener("scroll", () => {
  if (programmaticScroll) return;
  const atBottom = timeline.scrollTop + timeline.clientHeight >= timeline.scrollHeight - 30;
  if (atBottom) {
    newDataBar.classList.add("hidden");
    if (!autoScroll) {
      autoScroll = true;
      autoScrollBtn.classList.add("active");
    }
  } else if (autoScroll) {
    autoScroll = false;
    autoScrollBtn.classList.remove("active");
  }
});

// ── Wrap toggle ─────────────────────────────────────────────────
wrapBtn.addEventListener("click", () => {
  wrapEnabled = !wrapEnabled;
  wrapBtn.classList.toggle("active", wrapEnabled);
  timeline.classList.toggle("wrap-mode", wrapEnabled);
  vscode.postMessage({ type: "updateSetting", key: "logscope.logWrap", value: wrapEnabled });
});

dateBtn.addEventListener("click", () => {
  dateVisible = !dateVisible;
  dateBtn.classList.toggle("active", dateVisible);
  viewerEl.classList.toggle("show-date", dateVisible);
});

// ── Filter controls ─────────────────────────────────────────────

// Check all / uncheck all severity buttons
const allDefaultSeverities = ["hci", "err", "wrn", "inf", "dbg"];

document.getElementById("check-all-btn")!.addEventListener("click", () => {
  for (const sev of allDefaultSeverities) activeSeverities.add(sev);
  document.querySelectorAll(".severity-btn").forEach((btn) => {
    const sev = (btn as HTMLElement).dataset.severity!;
    const isActive = activeSeverities.has(sev);
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-pressed", String(isActive));
  });
  refilterTimeline();

});

document.getElementById("uncheck-all-btn")!.addEventListener("click", () => {
  activeSeverities.clear();
  document.querySelectorAll(".severity-btn").forEach((btn) => {
    btn.classList.remove("active");
    btn.setAttribute("aria-pressed", "false");
  });
  refilterTimeline();

});

// Severity toggle buttons
document.querySelectorAll(".severity-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const sev = (btn as HTMLElement).dataset.severity!;
    if (activeSeverities.has(sev)) {
      activeSeverities.delete(sev);
      btn.classList.remove("active");
      btn.setAttribute("aria-pressed", "false");
    } else {
      activeSeverities.add(sev);
      btn.classList.add("active");
      btn.setAttribute("aria-pressed", "true");
    }
    refilterTimeline();
  });
});

// Module dropdown
moduleSelect.addEventListener("change", () => {
  selectedModule = moduleSelect.value;
  refilterTimeline();

});

// Module custom picker
modulePickerBtn.addEventListener("click", () => {
  const isHidden = modulePickerList.classList.toggle("hidden");
  modulePickerBtn.setAttribute("aria-expanded", String(!isHidden));
});
document.addEventListener("click", (e) => {
  if (!(e.target as HTMLElement).closest("#module-picker")) {
    modulePickerList.classList.add("hidden");
    modulePickerBtn.setAttribute("aria-expanded", "false");
  }
});
function selectModule(value: string, label: string) {
  selectedModule = value;
  moduleSelect.value = value;
  modulePickerText.textContent = label;
  modulePickerList.classList.add("hidden");
  modulePickerBtn.setAttribute("aria-expanded", "false");
  refilterTimeline();

  const items = modulePickerList.querySelectorAll(".picker-option");
  items.forEach(item => {
    (item as HTMLElement).classList.toggle("selected", (item as HTMLElement).dataset.value === value);
  });
}
function rebuildModulePicker() {
  while (modulePickerList.firstChild) modulePickerList.firstChild.remove();
  const allItem = document.createElement("div");
  allItem.className = "picker-option" + (selectedModule === "" ? " selected" : "");
  allItem.dataset.value = "";
  allItem.setAttribute("role", "option");
  allItem.textContent = "All modules";
  allItem.addEventListener("click", () => selectModule("", "All modules"));
  modulePickerList.appendChild(allItem);
  for (let i = 1; i < moduleSelect.options.length; i++) {
    const mod = moduleSelect.options[i].value;
    const item = document.createElement("div");
    item.className = "picker-option" + (selectedModule === mod ? " selected" : "");
    item.dataset.value = mod;
    item.setAttribute("role", "option");
    item.textContent = mod;
    item.addEventListener("click", () => selectModule(mod, mod));
    modulePickerList.appendChild(item);
  }
}

// Search input with 150ms debounce
searchInput.addEventListener("input", () => {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    searchText = searchInput.value;
    refilterTimeline();
  
  }, 150);
});

// Auto-scroll toggle
autoScrollBtn.addEventListener("click", () => {
  autoScroll = !autoScroll;
  autoScrollBtn.classList.toggle("active", autoScroll);
  if (autoScroll) {
    programmaticScroll = true;
    timeline.scrollTop = timeline.scrollHeight;
    requestAnimationFrame(() => { programmaticScroll = false; });
    newDataBar.classList.add("hidden");
  }
});

// New data bar — click to scroll to bottom
newDataBar.addEventListener("click", () => {
  autoScroll = true;
  autoScrollBtn.classList.add("active");
  programmaticScroll = true;
  timeline.scrollTop = timeline.scrollHeight;
  requestAnimationFrame(() => { programmaticScroll = false; });
  newDataBar.classList.add("hidden");
});

// Right-click copy on log rows
timeline.addEventListener("contextmenu", (e: Event) => {
  const mouseEvent = e as MouseEvent;
  const target = (mouseEvent.target as HTMLElement).closest(".log-row") as HTMLElement | null;
  if (target) {
    e.preventDefault();
    const text = target.textContent ?? "";
    navigator.clipboard.writeText(text.trim());
  }
});

// Clear button
clearBtn.addEventListener("click", () => {
  vscode.postMessage({ type: "clear" });
});

// ── Refilter: hide/show existing rows based on current filters ──
function refilterTimeline(): void {
  collapseExpandedRow();
  const rows = timeline.querySelectorAll(".log-row");
  rows.forEach((row) => {
    const el = row as HTMLDivElement & { _entry?: SerializedEntry };
    if (el._entry) {
      el.style.display = shouldShow(el._entry) ? "" : "none";
    }
  });
}

// ── Safe DOM clear helper ───────────────────────────────────────
function clearTimeline(): void {
  while (timeline.firstChild) {
    timeline.firstChild.remove();
  }
  emptyState.classList.remove("hidden");
  timeline.appendChild(emptyState);
  endOfLog.classList.add("hidden");
  timeline.appendChild(endOfLog);
  newDataBar.classList.add("hidden");
}

// ── Message handler helpers ──────────────────────────────────────
function handleInitMessage(msg: { wrapEnabled?: boolean; timeFormat?: string }): void {
  wrapEnabled = msg.wrapEnabled ?? false;
  wrapBtn.classList.toggle("active", wrapEnabled);
  timeline.classList.toggle("wrap-mode", wrapEnabled);
  use12HourTime = msg.timeFormat === "12h";
  viewerEl.classList.toggle("time-12h", use12HourTime);
}

function handleConnectingMessage(): void {
  document.getElementById("error-card")!.className = "hidden";
  connectToggleBtn.textContent = "Connecting...";
  connectToggleBtn.className = "conn-btn";
  (connectToggleBtn as HTMLButtonElement).disabled = true;
  connStatusDot.className = "dot amber";
  connStatusText.textContent = "Connecting...";
}

function handleConnectedMessage(msg: { address?: string; transport?: string; parserMode?: string }): void {
  isConnected = true;
  connDevice.textContent = msg.address ? "\u00B7 " + msg.address : "";
  connStatusDot.className = "dot green";
  const transportLabel = msg.transport || "J-Link RTT";
  connStatusText.textContent = "Connected via " + transportLabel;

  // Hide HCI and MON buttons when connected via UART (RTT-only features)
  const hciBtn = document.querySelector(".hci-btn") as HTMLButtonElement | null;
  const monBtn = document.querySelector(".mon-btn") as HTMLButtonElement | null;
  const isUart = /uart/i.test(transportLabel);
  if (hciBtn) {
    hciBtn.style.display = isUart ? "none" : "";
    if (isUart) {
      hciBtn.classList.remove("active");
      activeSeverities.delete("hci");
    }
  }
  if (monBtn) {
    monBtn.style.display = isUart ? "none" : "";
    if (isUart) {
      monBtn.classList.remove("active");
      activeSeverities.delete("mon");
    }
  }

  // Raw mode: hide severity toggles, module picker, timestamp toggle
  const isRawMode = msg.parserMode === "raw";
  viewerEl.classList.toggle("raw-mode", isRawMode);
  // nRF5 and Raw parsers don't produce device timestamps — hide the column
  const noDeviceTs = msg.parserMode === "nrf5" || msg.parserMode === "raw";
  viewerEl.classList.toggle("no-device-ts", noDeviceTs);
  const severityToggles = document.getElementById("severity-toggles")!;
  const modulePicker = document.getElementById("module-picker")!;
  severityToggles.style.display = isRawMode ? "none" : "";
  modulePicker.style.display = isRawMode ? "none" : "";
  timestampBtn.style.display = noDeviceTs ? "none" : "";

  connectToggleBtn.textContent = "Disconnect";
  connectToggleBtn.className = "conn-btn disconnect";
  (connectToggleBtn as HTMLButtonElement).disabled = false;
  connectionBar.classList.remove("hidden");
  reconnectBar.classList.add("hidden");
}

function handleDisconnectedMessage(msg: { unexpected?: boolean }): void {
  isConnected = false;

  if (msg.unexpected) {
    // Unexpected disconnect: keep logs visible, show reconnect bar
    connStatusDot.className = "dot amber";
    connStatusText.textContent = "Connection lost";
    connectToggleBtn.textContent = "Connect";
    connectToggleBtn.className = "conn-btn connect";
    (connectToggleBtn as HTMLButtonElement).disabled = false;
    reconnectBar.classList.remove("hidden");
  } else {
    // User-initiated disconnect: keep logs visible, update connection bar
    connStatusDot.className = "dot amber";
    connStatusText.textContent = "Disconnected";
    connDevice.textContent = "";
    connectToggleBtn.textContent = "Connect";
    connectToggleBtn.className = "conn-btn connect";
    (connectToggleBtn as HTMLButtonElement).disabled = false;
  }
}

function handleConnectErrorMessage(msg: {
  headline: string;
  detail: string;
  actions: { label: string; command: string; args?: unknown[] }[];
  severity: "error" | "warning";
}): void {
  const card = document.getElementById("error-card")!;
  card.className = `error-card ${msg.severity}`;
  card.textContent = "";  // clear previous content

  // Header row: headline + dismiss button
  const header = document.createElement("div");
  header.className = "error-card-header";

  const headline = document.createElement("span");
  headline.className = "error-card-headline";
  headline.textContent = msg.headline;
  header.appendChild(headline);

  const dismiss = document.createElement("button");
  dismiss.className = "error-card-dismiss";
  dismiss.title = "Dismiss";
  dismiss.setAttribute("aria-label", "Dismiss error");
  dismiss.textContent = "\u00D7";  // × character
  dismiss.addEventListener("click", () => { card.className = "hidden"; });
  header.appendChild(dismiss);

  card.appendChild(header);

  // Detail text
  const detail = document.createElement("div");
  detail.className = "error-card-detail";
  detail.textContent = msg.detail;
  card.appendChild(detail);

  // Action buttons
  if (msg.actions.length > 0) {
    const actions = document.createElement("div");
    actions.className = "error-card-actions";

    for (const a of msg.actions) {
      const btn = document.createElement("button");
      btn.className = "error-card-btn";
      btn.textContent = a.label;
      btn.addEventListener("click", () => {
        vscode.postMessage({ type: "errorAction", action: a.command, args: a.args || [] });
        card.className = "hidden";
      });
      actions.appendChild(btn);
    }

    card.appendChild(actions);
  }

  // Also update the status bar
  connStatusDot.className = "dot amber";
  connStatusText.textContent = "Connection failed";
  connectToggleBtn.textContent = "Connect";
  connectToggleBtn.className = "conn-btn connect";
  (connectToggleBtn as HTMLButtonElement).disabled = false;
}

function handleEntriesMessage(msg: { entries: SerializedEntry[] }): void {
  const entries = msg.entries;
  const fragment = document.createDocumentFragment();

  for (const entry of entries) {
    const row = createRow(entry) as HTMLDivElement & { _entry?: SerializedEntry };
    row._entry = entry;

    if (!shouldShow(entry)) {
      row.style.display = "none";
    }

    fragment.appendChild(row);
  }

  emptyState.classList.add("hidden");
  endOfLog.before(fragment);
  endOfLog.classList.remove("hidden");

  if (autoScroll) {
    programmaticScroll = true;
    timeline.scrollTop = timeline.scrollHeight;
    requestAnimationFrame(() => { programmaticScroll = false; });
    newDataBar.classList.add("hidden");
  } else {
    newDataBar.classList.remove("hidden");
  }
}

function handleStatusMessage(msg: { connected: boolean; entryCount: number; evictedCount: number }): void {
  const { connected, entryCount, evictedCount } = msg;
  statusConnection.textContent = connected ? "Connected" : "Disconnected";
  statusCount.textContent = `${entryCount.toLocaleString()} entries`;
  statusEvicted.textContent =
    evictedCount > 0 ? `(${evictedCount.toLocaleString()} evicted)` : "";
}

function handleModulesMessage(msg: { modules: string[] }): void {
  const modules = msg.modules;
  const currentValue = moduleSelect.value;

  while (moduleSelect.options.length > 1) {
    moduleSelect.remove(1);
  }

  for (const mod of modules.toSorted((a, b) => a.localeCompare(b))) {
    const option = document.createElement("option");
    option.value = mod;
    option.textContent = mod;
    moduleSelect.appendChild(option);
  }

  if (currentValue && modules.includes(currentValue)) {
    moduleSelect.value = currentValue;
  }
  rebuildModulePicker();
}

function handleResetMessage(): void {
  const sep = document.createElement("div");
  sep.className = "reset-separator";
  const ts = document.createElement("span");
  ts.className = "reset-ts";
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const tz = now.toLocaleTimeString("en-US", { timeZoneName: "short" }).split(" ").pop();
  ts.textContent = dateStr + " " + now.toTimeString().slice(0, 8) + " " + tz;
  const label = document.createElement("span");
  label.className = "reset-label";
  label.textContent = "\u26A0 Device Reset Detected";
  sep.appendChild(ts);
  sep.appendChild(label);
  emptyState.classList.add("hidden");
  endOfLog.before(sep);
  if (autoScroll) {
    programmaticScroll = true;
    timeline.scrollTop = timeline.scrollHeight;
    requestAnimationFrame(() => { programmaticScroll = false; });
  }
}

// ── Notify extension host that the webview script is ready ─────
vscode.postMessage({ type: "ready" });

// ── Message handler ─────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
window.addEventListener("message", (event) => {
  if (!event.isTrusted || !event.origin.startsWith("vscode-webview://")) return;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const msg = event.data as any;

  switch (msg.type) {
    case "init":         handleInitMessage(msg); break;
    case "connecting":   handleConnectingMessage(); break;
    case "connected":    handleConnectedMessage(msg); break;
    case "disconnected": handleDisconnectedMessage(msg); break;
    case "connectError": handleConnectErrorMessage(msg as any); break;
    case "entries":      handleEntriesMessage(msg); break;
    case "status":       handleStatusMessage(msg); break;
    case "modules":      handleModulesMessage(msg); break;
    case "clear":        clearTimeline(); break;
    case "reset":        handleResetMessage(); break;
    case "scrollToWatch": {
      const patternName = msg.patternName as string;
      const rows = document.querySelectorAll(".log-row");
      let lastMatch: Element | null = null;
      for (const row of rows) {
        const dots = row.querySelectorAll(".watch-dot");
        for (const dot of dots) {
          if (dot.getAttribute("title") === patternName) {
            lastMatch = row;
            break;
          }
        }
      }
      if (lastMatch) {
        lastMatch.scrollIntoView({ behavior: "smooth", block: "center" });
        lastMatch.classList.add("watch-highlight");
        setTimeout(() => lastMatch!.classList.remove("watch-highlight"), 1500);
      }
      break;
    }
  }
});
