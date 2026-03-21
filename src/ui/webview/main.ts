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

// ── State ───────────────────────────────────────────────────────
let autoScroll = true;
let timestampsVisible = true;
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

function formatWallClock(epochMs: number): string {
  const d = new Date(epochMs);
  return (
    String(d.getHours()).padStart(2, "0") +
    ":" +
    String(d.getMinutes()).padStart(2, "0") +
    ":" +
    String(d.getSeconds()).padStart(2, "0") +
    "." +
    String(d.getMilliseconds()).padStart(3, "0")
  );
}

// ── Row creation (XSS-safe: uses textContent, never innerHTML) ──
function createRow(entry: SerializedEntry): HTMLDivElement {
  const row = document.createElement("div") as HTMLDivElement & { _decoded?: DecodedPacket; _raw?: number[] };
  const cssClass = entry.source === "hci" ? "hci" : entry.severity;
  row.className = `log-row ${cssClass}`;

  const time = document.createElement("span");
  time.className = "time";
  time.textContent = entry.receivedAt ? formatWallClock(entry.receivedAt) : "";

  const ts = document.createElement("span");
  ts.className = "ts";
  ts.textContent = formatTimestamp(entry.timestamp);

  const sev = document.createElement("span");
  sev.className = "sev";
  sev.textContent = entry.source === "hci" ? "HCI" : entry.severity.toUpperCase();

  const mod = document.createElement("span");
  mod.className = "mod";
  mod.textContent = entry.module;

  const msg = document.createElement("span");
  msg.className = "msg";
  msg.textContent = entry.message;

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
function buildDetailDiv(decoded: DecodedPacket, raw?: number[]): HTMLDivElement {
  const detail = document.createElement("div");
  detail.className = "hci-detail";

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
  detail.appendChild(table);

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

    detail.appendChild(toggle);
    detail.appendChild(pre);
  }

  return detail;
}

// ── Expand/collapse HCI rows (delegated click handler) ──────────
function collapseExpandedRow(): void {
  const expanded = timeline.querySelector(".log-row.expanded") as HTMLElement | null;
  if (expanded) {
    expanded.classList.remove("expanded");
    const detail = expanded.nextElementSibling;
    if (detail && detail.classList.contains("hci-detail")) {
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
    if (detail && detail.classList.contains("hci-detail")) {
      detail.remove();
    }
  } else {
    // Collapse any other expanded row first
    collapseExpandedRow();
    // Expand this row
    target.classList.add("expanded");
    if (target._decoded) {
      const detail = buildDetailDiv(target._decoded, target._raw);
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

// ── Filter controls ─────────────────────────────────────────────

// Check all / uncheck all severity buttons
const allDefaultSeverities = ["hci", "err", "wrn", "inf", "dbg"];

document.getElementById("check-all-btn")!.addEventListener("click", () => {
  for (const sev of allDefaultSeverities) activeSeverities.add(sev);
  document.querySelectorAll(".severity-btn").forEach((btn) => {
    const sev = (btn as HTMLElement).dataset.severity!;
    btn.classList.toggle("active", activeSeverities.has(sev));
  });
  refilterTimeline();

});

document.getElementById("uncheck-all-btn")!.addEventListener("click", () => {
  activeSeverities.clear();
  document.querySelectorAll(".severity-btn").forEach((btn) => {
    btn.classList.remove("active");
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
    } else {
      activeSeverities.add(sev);
      btn.classList.add("active");
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
  modulePickerList.classList.toggle("hidden");
});
document.addEventListener("click", (e) => {
  if (!(e.target as HTMLElement).closest("#module-picker")) {
    modulePickerList.classList.add("hidden");
  }
});
function selectModule(value: string, label: string) {
  selectedModule = value;
  moduleSelect.value = value;
  modulePickerText.textContent = label;
  modulePickerList.classList.add("hidden");
  refilterTimeline();

  const items = modulePickerList.querySelectorAll(".picker-option");
  items.forEach(item => {
    (item as HTMLElement).classList.toggle("selected", (item as HTMLElement).dataset.value === value);
  });
}
function rebuildModulePicker() {
  while (modulePickerList.firstChild) modulePickerList.removeChild(modulePickerList.firstChild);
  const allItem = document.createElement("div");
  allItem.className = "picker-option" + (selectedModule === "" ? " selected" : "");
  allItem.dataset.value = "";
  allItem.textContent = "All modules";
  allItem.addEventListener("click", () => selectModule("", "All modules"));
  modulePickerList.appendChild(allItem);
  for (let i = 1; i < moduleSelect.options.length; i++) {
    const mod = moduleSelect.options[i].value;
    const item = document.createElement("div");
    item.className = "picker-option" + (selectedModule === mod ? " selected" : "");
    item.dataset.value = mod;
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
    timeline.removeChild(timeline.firstChild);
  }
  endOfLog.classList.add("hidden");
  timeline.appendChild(endOfLog);
  newDataBar.classList.add("hidden");
}

// ── Message handler ─────────────────────────────────────────────
window.addEventListener("message", (event) => {
  if (!event.isTrusted || !event.origin.startsWith("vscode-webview://")) return;

  const msg = event.data;

  switch (msg.type) {
    case "init": {
      const { wrapEnabled: wrap } = msg;
      wrapEnabled = wrap ?? false;
      wrapBtn.classList.toggle("active", wrapEnabled);
      timeline.classList.toggle("wrap-mode", wrapEnabled);
      break;
    }

    case "connecting": {
      // Update connection bar
      connectToggleBtn.textContent = "Connecting...";
      connectToggleBtn.className = "conn-btn";
      (connectToggleBtn as HTMLButtonElement).disabled = true;
      connStatusDot.className = "dot amber";
      connStatusText.textContent = "Connecting...";
      break;
    }

    case "connected": {
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
      const severityToggles = document.getElementById("severity-toggles")!;
      const modulePicker = document.getElementById("module-picker")!;
      severityToggles.style.display = isRawMode ? "none" : "";
      modulePicker.style.display = isRawMode ? "none" : "";
      timestampBtn.style.display = isRawMode ? "none" : "";

      connectToggleBtn.textContent = "Disconnect";
      connectToggleBtn.className = "conn-btn disconnect";
      (connectToggleBtn as HTMLButtonElement).disabled = false;
      connectionBar.classList.remove("hidden");
      reconnectBar.classList.add("hidden");
      break;
    }

    case "disconnected": {
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
      break;
    }

    case "connectError": {
      connStatusDot.className = "dot amber";
      connStatusText.textContent = "Connection failed";
      connectToggleBtn.textContent = "Connect";
      connectToggleBtn.className = "conn-btn connect";
      (connectToggleBtn as HTMLButtonElement).disabled = false;
      break;
    }

    // ── Log data messages ────────────────────────────────────
    case "entries": {
      const entries: SerializedEntry[] = msg.entries;
      const fragment = document.createDocumentFragment();

      for (const entry of entries) {
        const row = createRow(entry) as HTMLDivElement & { _entry?: SerializedEntry };
        row._entry = entry;

        if (!shouldShow(entry)) {
          row.style.display = "none";
        }

        fragment.appendChild(row);
      }

      timeline.insertBefore(fragment, endOfLog);
      endOfLog.classList.remove("hidden");

      if (autoScroll) {
        programmaticScroll = true;
        timeline.scrollTop = timeline.scrollHeight;
        requestAnimationFrame(() => { programmaticScroll = false; });
        newDataBar.classList.add("hidden");
      } else {
        newDataBar.classList.remove("hidden");
      }
      break;
    }

    case "status": {
      const { connected, entryCount, evictedCount } = msg;
      statusConnection.textContent = connected ? "Connected" : "Disconnected";
      statusCount.textContent = `${entryCount.toLocaleString()} entries`;
      statusEvicted.textContent =
        evictedCount > 0 ? `(${evictedCount.toLocaleString()} evicted)` : "";
      break;
    }

    case "modules": {
      const modules: string[] = msg.modules;
      const currentValue = moduleSelect.value;

      while (moduleSelect.options.length > 1) {
        moduleSelect.remove(1);
      }

      for (const mod of modules.sort((a, b) => a.localeCompare(b))) {
        const option = document.createElement("option");
        option.value = mod;
        option.textContent = mod;
        moduleSelect.appendChild(option);
      }

      if (currentValue && modules.includes(currentValue)) {
        moduleSelect.value = currentValue;
      }
      rebuildModulePicker();
      break;
    }

    case "clear": {
      clearTimeline();
      break;
    }

    case "reset": {
      const sep = document.createElement("div");
      sep.className = "reset-separator";
      const ts = document.createElement("span");
      ts.className = "reset-ts";
      const now = new Date();
      const tz = now.toLocaleTimeString("en-US", { timeZoneName: "short" }).split(" ").pop();
      ts.textContent = now.toTimeString().slice(0, 8) + " " + tz;
      const label = document.createElement("span");
      label.className = "reset-label";
      label.textContent = "\u26A0 Device Reset Detected";
      sep.appendChild(ts);
      sep.appendChild(label);
      timeline.insertBefore(sep, endOfLog);
      if (autoScroll) {
        programmaticScroll = true;
        timeline.scrollTop = timeline.scrollHeight;
        requestAnimationFrame(() => { programmaticScroll = false; });
      }
      break;
    }
  }
});
