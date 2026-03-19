// WebView client — runs in the browser context inside VS Code's WebView.
// Communicates with the extension host via postMessage / onDidReceiveMessage.

import { detectFault } from "../../parser/fault-detector";

interface DecodedPacket {
  summary: string;
  fields: { name: string; value: string; color?: string }[];
}

interface SerializedEntry {
  timestamp: number;
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

// ── DOM references: existing ────────────────────────────────────
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

// ── DOM references: new (connection states) ─────────────────────
const welcomeEl = document.getElementById("welcome")!;
const viewerEl = document.getElementById("viewer")!;
const connectBtn = document.getElementById("connect-btn") as HTMLButtonElement;
const connectError = document.getElementById("connect-error")!;
const cfgDevice = document.getElementById("cfg-device") as HTMLInputElement;
const cfgAutoConnect = document.getElementById("cfg-auto-connect") as HTMLInputElement;
const devicePickerBtn = document.getElementById("device-picker-btn")!;
const devicePickerText = document.getElementById("device-picker-text")!;
const devicePickerList = document.getElementById("device-picker-list")!;
const newDataBar = document.getElementById("new-data-bar")!;
const endOfLog = document.getElementById("end-of-log")!;
const connDevice = document.getElementById("conn-device")!;
const connectionBar = document.getElementById("connection-bar")!;
const inlineSettings = document.getElementById("inline-settings")!;
const reconnectBar = document.getElementById("reconnect-bar")!;
const settingsBtn = document.getElementById("settings-btn")!;
const connectToggleBtn = document.getElementById("connect-toggle-btn")!;
const connStatusDot = document.getElementById("conn-status-dot")!;
const connStatusText = document.getElementById("conn-status-text")!;
const exportBtn = document.getElementById("export-btn")!;
const reconnectBtn = document.getElementById("reconnect-btn")!;
const dismissBtn = document.getElementById("dismiss-btn")!;
let isConnected = false;
const wrapBtn = document.getElementById("wrap-btn")!;
const timestampBtn = document.getElementById("timestamp-btn")!;

// ── DOM references: transport selector & UART form ──────────────
const transportRttBtn = document.getElementById("transport-rtt")!;
const transportUartBtn = document.getElementById("transport-uart")!;
const rttForm = document.getElementById("rtt-form")!;
const uartForm = document.getElementById("uart-form")!;
const portPickerBtn = document.getElementById("port-picker-btn")!;
const portPickerText = document.getElementById("port-picker-text")!;
const portPickerList = document.getElementById("port-picker-list")!;
const cfgPort = document.getElementById("cfg-port") as HTMLInputElement;
const refreshPortsBtn = document.getElementById("refresh-ports-btn")!;
const baudPickerBtn = document.getElementById("baud-picker-btn")!;
const baudPickerText = document.getElementById("baud-picker-text")!;
const baudPickerList = document.getElementById("baud-picker-list")!;
const cfgBaud = document.getElementById("cfg-baud") as HTMLInputElement;
let selectedTransport: "rtt" | "uart" = "rtt";

// ── State ───────────────────────────────────────────────────────
let autoScroll = true;
let timestampsVisible = true;
const activeSeverities = new Set(["hci", "err", "wrn", "inf", "dbg"]);
let selectedModule = ""; // "" means all modules
let searchText = "";
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let wrapEnabled = false;
let lastConnectConfig: Record<string, unknown> | null = null;

// ── State management ────────────────────────────────────────────
function showState(state: "welcome" | "viewer") {
  welcomeEl.classList.toggle("hidden", state !== "welcome");
  viewerEl.classList.toggle("hidden", state !== "viewer");
}

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

// ── Row creation (XSS-safe: uses textContent, never innerHTML) ──
function createRow(entry: SerializedEntry): HTMLDivElement {
  const row = document.createElement("div") as HTMLDivElement & { _decoded?: DecodedPacket; _raw?: number[] };
  const cssClass = entry.source === "hci" ? "hci" : entry.severity;
  row.className = `log-row ${cssClass}`;

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

// ── Notify extension of filter changes ──────────────────────────
function sendFilterChanged(): void {
  vscode.postMessage({
    type: "filterChanged",
    severities: Array.from(activeSeverities),
    modules: selectedModule ? [selectedModule] : null,
    searchText,
  });
}

// ── Branding link ───────────────────────────────────────
document.getElementById("novelbits-link")?.addEventListener("click", (e) => {
  e.preventDefault();
  vscode.postMessage({ type: "openExternal", url: "https://novelbits.io" });
});

// ── Custom device picker ────────────────────────────────────────
const refreshBtn = document.getElementById("refresh-btn")!;
let pickerDevices: Array<{ serial: number; product: string; core?: string; device?: string }> = [];

devicePickerBtn.addEventListener("click", () => {
  if (pickerDevices.length === 0) return;
  devicePickerList.classList.toggle("hidden");
});

// Close picker when clicking outside
document.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  if (!target.closest("#device-picker")) {
    devicePickerList.classList.add("hidden");
  }
});

function selectDevice(serial: string, label: string) {
  cfgDevice.value = serial;
  devicePickerText.textContent = label;
  devicePickerList.classList.add("hidden");
  connectBtn.disabled = false;
  // Mark selected
  const items = devicePickerList.querySelectorAll(".device-option");
  items.forEach(item => {
    const el = item as HTMLElement;
    el.classList.toggle("selected", el.dataset.serial === serial);
  });
}

function deviceLabel(dev: { serial: number; core?: string; device?: string; targetName?: string }): string {
  const name = dev.targetName || "Unknown device";
  return name + " (SN: " + dev.serial + ")";
}

function populateDeviceDropdown(devices: Array<{ serial: number; core?: string; device?: string; targetName?: string }>) {
  pickerDevices = devices;
  refreshBtn.classList.remove("spinning");
  while (devicePickerList.firstChild) devicePickerList.removeChild(devicePickerList.firstChild);

  if (devices.length === 0) {
    devicePickerText.textContent = "No devices found";
    cfgDevice.value = "";
    connectBtn.disabled = true;
    return;
  }

  for (const dev of devices) {
    const item = document.createElement("div");
    item.className = "device-option";
    item.dataset.serial = String(dev.serial);
    const label = deviceLabel(dev);
    item.textContent = label;
    item.addEventListener("click", () => selectDevice(String(dev.serial), label));
    devicePickerList.appendChild(item);
  }

  // Auto-select first device
  const first = devices[0];
  selectDevice(String(first.serial), deviceLabel(first));
}

refreshBtn.addEventListener("click", () => {
  refreshBtn.classList.add("spinning");
  devicePickerText.textContent = "Scanning...";
  cfgDevice.value = "";
  connectBtn.disabled = true;
  vscode.postMessage({ type: "refreshDevices" });
});

// ── Transport selector ───────────────────────────────────────────
function setTransport(transport: "rtt" | "uart") {
  selectedTransport = transport;
  transportRttBtn.classList.toggle("active", transport === "rtt");
  transportUartBtn.classList.toggle("active", transport === "uart");
  rttForm.classList.toggle("hidden", transport !== "rtt");
  uartForm.classList.toggle("hidden", transport !== "uart");
  connectError.classList.add("hidden");
  // Re-enable connect button if the target transport already has a selection
  if (transport === "uart" && cfgPort.value) {
    connectBtn.disabled = false;
  } else if (transport === "rtt" && cfgDevice.value) {
    connectBtn.disabled = false;
  }
}

transportRttBtn.addEventListener("click", () => {
  setTransport("rtt");
  refreshBtn.classList.add("spinning");
  devicePickerText.textContent = "Scanning...";
  cfgDevice.value = "";
  connectBtn.disabled = true;
  vscode.postMessage({ type: "refreshDevices" });
});

transportUartBtn.addEventListener("click", () => {
  setTransport("uart");
  refreshPortsBtn.classList.add("spinning");
  portPickerText.textContent = "Scanning...";
  cfgPort.value = "";
  connectBtn.disabled = true;
  vscode.postMessage({ type: "refreshPorts" });
});

// ── Port picker (mirrors device picker) ──────────────────────────
let pickerPorts: Array<{ path: string; manufacturer?: string }> = [];

portPickerBtn.addEventListener("click", () => {
  if (pickerPorts.length === 0) return;
  portPickerList.classList.toggle("hidden");
});

function selectPort(path: string, label: string) {
  cfgPort.value = path;
  portPickerText.textContent = label;
  portPickerList.classList.add("hidden");
  connectBtn.disabled = false;
  const items = portPickerList.querySelectorAll(".port-option");
  items.forEach(item => {
    const el = item as HTMLElement;
    el.classList.toggle("selected", el.dataset.path === path);
  });
}

function populatePortList(ports: Array<{ path: string; manufacturer?: string }>) {
  pickerPorts = ports;
  refreshPortsBtn.classList.remove("spinning");
  while (portPickerList.firstChild) portPickerList.removeChild(portPickerList.firstChild);

  if (ports.length === 0) {
    portPickerText.textContent = "No ports found";
    cfgPort.value = "";
    connectBtn.disabled = true;
    return;
  }

  for (const port of ports) {
    const item = document.createElement("div");
    item.className = "port-option";
    item.dataset.path = port.path;

    const pathSpan = document.createElement("span");
    pathSpan.textContent = port.path;
    item.appendChild(pathSpan);

    if (port.manufacturer) {
      const detail = document.createElement("span");
      detail.className = "port-detail";
      detail.textContent = port.manufacturer;
      item.appendChild(detail);
    }

    item.addEventListener("click", () => selectPort(port.path, port.path));
    portPickerList.appendChild(item);
  }

  // Auto-select first port
  const first = ports[0];
  selectPort(first.path, first.path);
}

refreshPortsBtn.addEventListener("click", () => {
  refreshPortsBtn.classList.add("spinning");
  portPickerText.textContent = "Scanning...";
  cfgPort.value = "";
  connectBtn.disabled = true;
  vscode.postMessage({ type: "refreshPorts" });
});

// ── Baud rate picker ─────────────────────────────────────────────
const baudRates = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600, 1000000];

function populateBaudList() {
  while (baudPickerList.firstChild) baudPickerList.removeChild(baudPickerList.firstChild);
  for (const rate of baudRates) {
    const item = document.createElement("div");
    item.className = "baud-option" + (String(rate) === cfgBaud.value ? " selected" : "");
    item.dataset.value = String(rate);
    item.textContent = rate.toLocaleString();
    item.addEventListener("click", () => {
      cfgBaud.value = String(rate);
      baudPickerText.textContent = rate.toLocaleString();
      baudPickerList.classList.add("hidden");
      const items = baudPickerList.querySelectorAll(".baud-option");
      items.forEach(el => {
        (el as HTMLElement).classList.toggle("selected", (el as HTMLElement).dataset.value === String(rate));
      });
    });
    baudPickerList.appendChild(item);
  }
}

baudPickerBtn.addEventListener("click", () => {
  baudPickerList.classList.toggle("hidden");
});

// Initialize baud list on load
populateBaudList();

// ── Close dropdowns on outside click ─────────────────────────────
document.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  if (!target.closest("#port-picker")) {
    portPickerList.classList.add("hidden");
  }
  if (!target.closest("#baud-picker")) {
    baudPickerList.classList.add("hidden");
  }
});

// ── Auto-connect checkbox ────────────────────────────────────────
cfgAutoConnect.addEventListener("change", () => {
  vscode.postMessage({ type: "updateSetting", key: "autoConnect", value: cfgAutoConnect.checked });
});

// ── Connect form ────────────────────────────────────────────────
function getFormConfig() {
  if (selectedTransport === "uart") {
    return {
      transport: "uart",
      device: cfgPort.value,
      baudRate: Number.parseInt(cfgBaud.value, 10) || 115200,
    };
  }
  return {
    transport: "rtt",
    device: cfgDevice.value,
  };
}

connectBtn.addEventListener("click", () => {
  const config = getFormConfig();
  lastConnectConfig = config;
  vscode.postMessage({ type: "connect", config });
});

// ── Connected state buttons ─────────────────────────────────────
connectToggleBtn.addEventListener("click", () => {
  if (isConnected) {
    vscode.postMessage({ type: "disconnect" });
  } else {
    if (lastConnectConfig) {
      vscode.postMessage({ type: "reconnect", config: lastConnectConfig });
    }
  }
});
exportBtn.addEventListener("click", () => vscode.postMessage({ type: "export" }));

reconnectBtn.addEventListener("click", () => {
  if (lastConnectConfig) {
    vscode.postMessage({ type: "reconnect", config: lastConnectConfig });
  }
});

dismissBtn.addEventListener("click", () => {
  reconnectBar.classList.add("hidden");
  showState("welcome");
});

settingsBtn.addEventListener("click", () => {
  const isHidden = inlineSettings.classList.toggle("hidden");
  settingsBtn.classList.toggle("active", !isHidden);
});

// ── Timestamp toggle ────────────────────────────────────────────
timestampBtn.addEventListener("click", () => {
  timestampsVisible = !timestampsVisible;
  timestampBtn.classList.toggle("active", timestampsVisible);
  // Toggle on #viewer so both column headers and timeline rows are affected
  document.getElementById("viewer")!.classList.toggle("hide-timestamps", !timestampsVisible);
});

// ── Auto-disable auto-scroll when user scrolls up ──────────────
let programmaticScroll = false;
timeline.addEventListener("scroll", () => {
  if (programmaticScroll) return;
  const atBottom = timeline.scrollTop + timeline.clientHeight >= timeline.scrollHeight - 30;
  if (atBottom) {
    // Scrolled to bottom — hide new-data bar and re-enable auto-scroll
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
  // MON stays off — user must enable it explicitly
  document.querySelectorAll(".severity-btn").forEach((btn) => {
    const sev = (btn as HTMLElement).dataset.severity!;
    btn.classList.toggle("active", activeSeverities.has(sev));
  });
  refilterTimeline();
  sendFilterChanged();
});

document.getElementById("uncheck-all-btn")!.addEventListener("click", () => {
  activeSeverities.clear();
  document.querySelectorAll(".severity-btn").forEach((btn) => {
    btn.classList.remove("active");
  });
  refilterTimeline();
  sendFilterChanged();
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
    sendFilterChanged();
  });
});

// Module dropdown
moduleSelect.addEventListener("change", () => {
  selectedModule = moduleSelect.value;
  refilterTimeline();
  sendFilterChanged();
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
  sendFilterChanged();
  const items = modulePickerList.querySelectorAll(".picker-option");
  items.forEach(item => {
    (item as HTMLElement).classList.toggle("selected", (item as HTMLElement).dataset.value === value);
  });
}
function rebuildModulePicker() {
  while (modulePickerList.firstChild) modulePickerList.removeChild(modulePickerList.firstChild);
  // "All modules" option
  const allItem = document.createElement("div");
  allItem.className = "picker-option" + (selectedModule === "" ? " selected" : "");
  allItem.dataset.value = "";
  allItem.textContent = "All modules";
  allItem.addEventListener("click", () => selectModule("", "All modules"));
  modulePickerList.appendChild(allItem);
  // Module options
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
    sendFilterChanged();
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
  // Collapse any expanded HCI row before refiltering
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
  // Re-add end-of-log (hidden until new entries arrive)
  endOfLog.classList.add("hidden");
  timeline.appendChild(endOfLog);
  newDataBar.classList.add("hidden");
}

// ── Message handler ─────────────────────────────────────────────
window.addEventListener("message", (event) => {
  // VS Code webview messages are delivered via postMessage from the extension host.
  // Only trusted messages have isTrusted === true (set by the browser, not spoofable).
  // Verify origin is a VS Code webview URI to prevent cross-origin message injection.
  if (!event.isTrusted || !event.origin.startsWith("vscode-webview://")) return;

  const msg = event.data;

  switch (msg.type) {
    // ── New: connection state messages ─────────────────────────
    case "init": {
      const { config, wrapEnabled: wrap } = msg;
      if (config) {
        cfgAutoConnect.checked = config.autoConnect ?? false;
      }
      wrapEnabled = wrap ?? false;
      wrapBtn.classList.toggle("active", wrapEnabled);
      timeline.classList.toggle("wrap-mode", wrapEnabled);
      break;
    }

    case "connecting": {
      connectBtn.disabled = true;
      connectBtn.textContent = "Connecting...";
      connectError.classList.add("hidden");
      // Update connection bar if already in viewer state
      if (connectToggleBtn) {
        connectToggleBtn.textContent = "Connecting...";
        connectToggleBtn.className = "conn-btn";
        connectToggleBtn.disabled = true;
        connStatusDot.className = "dot amber";
        connStatusText.textContent = "Connecting...";
      }
      break;
    }

    case "connected": {
      isConnected = true;
      // Ensure we have a config for reconnect (auto-connect bypasses the form)
      if (!lastConnectConfig) {
        lastConnectConfig = getFormConfig();
      }
      connectBtn.disabled = false;
      connectBtn.textContent = "Connect";
      connDevice.textContent = msg.address ? "\u00B7 " + msg.address : "";
      connStatusDot.className = "dot green";
      const transportLabel = msg.transport || "J-Link RTT";
      connStatusText.textContent = "Connected via " + transportLabel;

      // Disable HCI button when connected via UART (no HCI decoding support)
      const hciBtn = document.querySelector(".hci-btn") as HTMLButtonElement | null;
      if (hciBtn) {
        const isUart = /uart/i.test(transportLabel);
        if (isUart) {
          hciBtn.setAttribute("disabled", "");
          hciBtn.title = "HCI decoding requires J-Link RTT";
          hciBtn.classList.remove("active");
          hciBtn.classList.add("disabled");
          activeSeverities.delete("hci");
        } else {
          hciBtn.removeAttribute("disabled");
          hciBtn.title = "Bluetooth LE HCI packets";
          hciBtn.classList.remove("disabled");
        }
      }

      connectToggleBtn.textContent = "Disconnect";
      connectToggleBtn.className = "conn-btn disconnect";
      (connectToggleBtn as HTMLButtonElement).disabled = false;
      connectionBar.classList.remove("hidden");
      reconnectBar.classList.add("hidden");
      inlineSettings.classList.add("hidden");
      settingsBtn.classList.remove("active");
      showState("viewer");
      break;
    }

    case "disconnected": {
      isConnected = false;
      connectBtn.disabled = false;
      connectBtn.textContent = "Connect";
      // Keep logs visible — toggle button to Connect state
      connStatusDot.className = msg.unexpected ? "dot amber" : "dot";
      connStatusText.textContent = msg.unexpected ? "Connection lost" : "Disconnected";
      connectToggleBtn.textContent = "Connect";
      connectToggleBtn.className = "conn-btn connect";
      (connectToggleBtn as HTMLButtonElement).disabled = false;
      // Show reconnect bar on unexpected disconnect so the user can retry
      if (msg.unexpected) {
        reconnectBar.classList.remove("hidden");
      }
      break;
    }

    case "connectError": {
      connectBtn.disabled = false;
      connectBtn.textContent = "Connect";
      const errText = (msg.message as string).replace(/^ERROR:\s*/i, "");
      connectError.textContent = errText;
      connectError.classList.remove("hidden");
      break;
    }

    case "devices": {
      populateDeviceDropdown(msg.devices);
      break;
    }

    case "serialPorts": {
      populatePortList(msg.ports);
      break;
    }

    // ── Existing: log data messages ───────────────────────────
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

      // Clear all options except "All modules"
      while (moduleSelect.options.length > 1) {
        moduleSelect.remove(1);
      }

      for (const mod of modules.sort((a, b) => a.localeCompare(b))) {
        const option = document.createElement("option");
        option.value = mod;
        option.textContent = mod;
        moduleSelect.appendChild(option);
      }

      // Restore previous selection if it still exists
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
      // Insert a reset row styled like a log entry
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
      // Insert before end-of-log so it stays in proper order
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
