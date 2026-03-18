// WebView client — runs in the browser context inside VS Code's WebView.
// Communicates with the extension host via postMessage / onDidReceiveMessage.

interface SerializedEntry {
  timestamp: number;
  severity: string;
  module: string;
  message: string;
  source: string;
}

// ── VS Code API handle ──────────────────────────────────────────
// @ts-expect-error — acquireVsCodeApi is injected by the WebView host
const vscode = acquireVsCodeApi();

// ── DOM references: existing ────────────────────────────────────
const timeline = document.getElementById("timeline")!;
const moduleSelect = document.getElementById("module-select") as HTMLSelectElement;
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
const cfgDevice = document.getElementById("cfg-device") as HTMLSelectElement;
const cfgAutoConnect = document.getElementById("cfg-auto-connect") as HTMLInputElement;
const connDevice = document.getElementById("conn-device")!;
const connectionBar = document.getElementById("connection-bar")!;
const inlineSettings = document.getElementById("inline-settings")!;
const reconnectBar = document.getElementById("reconnect-bar")!;
const settingsBtn = document.getElementById("settings-btn")!;
const disconnectBtn = document.getElementById("disconnect-btn")!;
const exportBtn = document.getElementById("export-btn")!;
const reconnectBtn = document.getElementById("reconnect-btn")!;
const dismissBtn = document.getElementById("dismiss-btn")!;
const wrapBtn = document.getElementById("wrap-btn")!;
const timestampBtn = document.getElementById("timestamp-btn")!;

// ── State ───────────────────────────────────────────────────────
let autoScroll = true;
let timestampsVisible = true;
const activeSeverities = new Set(["err", "wrn", "inf", "dbg"]);
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
  const row = document.createElement("div");
  row.className = `log-row ${entry.severity}`;

  const ts = document.createElement("span");
  ts.className = "ts";
  ts.textContent = formatTimestamp(entry.timestamp);

  const sev = document.createElement("span");
  sev.className = "sev";
  sev.textContent = entry.severity.toUpperCase();

  const mod = document.createElement("span");
  mod.className = "mod";
  mod.textContent = entry.module;

  const msg = document.createElement("span");
  msg.className = "msg";
  msg.textContent = entry.message;

  row.appendChild(ts);
  row.appendChild(sev);
  row.appendChild(mod);
  row.appendChild(msg);

  return row;
}

// ── Visibility check ────────────────────────────────────────────
function shouldShow(entry: SerializedEntry): boolean {
  if (!activeSeverities.has(entry.severity)) return false;
  if (selectedModule && entry.module !== selectedModule) return false;
  if (searchText) {
    const lower = searchText.toLowerCase();
    if (
      !entry.message.toLowerCase().includes(lower) &&
      !entry.module.toLowerCase().includes(lower)
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

// ── Auto-connect checkbox ────────────────────────────────────────
cfgAutoConnect.addEventListener("change", () => {
  vscode.postMessage({ type: "updateSetting", key: "autoConnect", value: cfgAutoConnect.checked });
});

// ── Connect form ────────────────────────────────────────────────
function getFormConfig() {
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
disconnectBtn.addEventListener("click", () => vscode.postMessage({ type: "disconnect" }));
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
  timeline.classList.toggle("hide-timestamps", !timestampsVisible);
});

// ── Auto-disable auto-scroll when user scrolls up ──────────────
timeline.addEventListener("scroll", () => {
  if (!autoScroll) return;
  const atBottom = timeline.scrollTop + timeline.clientHeight >= timeline.scrollHeight - 20;
  if (!atBottom) {
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
    timeline.scrollTop = timeline.scrollHeight;
  }
});

// Clear button
clearBtn.addEventListener("click", () => {
  vscode.postMessage({ type: "clear" });
});

// ── Refilter: hide/show existing rows based on current filters ──
function refilterTimeline(): void {
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
}

// ── Message handler ─────────────────────────────────────────────
window.addEventListener("message", (event) => {
  const msg = event.data;

  switch (msg.type) {
    // ── New: connection state messages ─────────────────────────
    case "init": {
      const { config, wrapEnabled: wrap } = msg;
      if (config) {
        if (config.lastDevice) {
          cfgDevice.value = config.lastDevice;
        } else if (config.device) {
          cfgDevice.value = config.device;
        }
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
      break;
    }

    case "connected": {
      connectBtn.disabled = false;
      connectBtn.textContent = "Connect";
      connDevice.textContent = msg.address;
      connectionBar.classList.remove("hidden");
      reconnectBar.classList.add("hidden");
      inlineSettings.classList.add("hidden");
      settingsBtn.classList.remove("active");
      showState("viewer");
      break;
    }

    case "disconnected": {
      connectBtn.disabled = false;
      connectBtn.textContent = "Connect";
      if (msg.unexpected) {
        // Show reconnect bar, keep logs visible
        reconnectBar.classList.remove("hidden");
        connectionBar.classList.add("hidden");
      } else {
        showState("welcome");
      }
      break;
    }

    case "connectError": {
      connectBtn.disabled = false;
      connectBtn.textContent = "Connect";
      connectError.textContent = msg.message;
      connectError.classList.remove("hidden");
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

      timeline.appendChild(fragment);

      if (autoScroll) {
        timeline.scrollTop = timeline.scrollHeight;
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

      for (const mod of modules.sort()) {
        const option = document.createElement("option");
        option.value = mod;
        option.textContent = mod;
        moduleSelect.appendChild(option);
      }

      // Restore previous selection if it still exists
      if (currentValue && modules.includes(currentValue)) {
        moduleSelect.value = currentValue;
      }
      break;
    }

    case "clear": {
      clearTimeline();
      break;
    }
  }
});
