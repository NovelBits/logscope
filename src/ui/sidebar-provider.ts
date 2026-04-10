import * as vscode from "vscode";

export interface SidebarState {
  connected: boolean;
  connecting: boolean;
  transport: "rtt" | "uart";
  selectedDevice: string;        // serial number or port path
  selectedDeviceLabel: string;   // human-readable
  baudRate: number;
  autoConnect: boolean;
  parser: "zephyr" | "nrf5" | "raw";
  connectedTransport: string;    // "J-Link RTT" or "Serial UART"
  connectedAddress: string;
  entryCount: number;
  hciPacketCount: number;
  errorCount: number;
  watchCounters: { name: string; count: number; color: string }[];
  licenseTier: string;
  hasLastSession: boolean;       // true if we have saved transport+device
}

export class LogScopeSidebarProvider implements vscode.TreeDataProvider<SidebarItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<SidebarItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private readonly state: SidebarState = {
    connected: false,
    connecting: false,
    transport: "rtt",
    selectedDevice: "",
    selectedDeviceLabel: "",
    baudRate: 115200,
    autoConnect: false,
    parser: "zephyr" as const,
    connectedTransport: "",
    connectedAddress: "",
    entryCount: 0,
    hciPacketCount: 0,
    errorCount: 0,
    watchCounters: [],
    licenseTier: "Free",
    hasLastSession: false,
  };

  private connectStartTime: number | null = null;
  private durationInterval: ReturnType<typeof setInterval> | null = null;
  private lastDurationString = "";

  // Cached items for in-place updates (avoids full tree rebuild)
  private cachedEntries: SidebarItem | null = null;
  private cachedHci: SidebarItem | null = null;
  private cachedErrors: SidebarItem | null = null;
  private cachedDuration: SidebarItem | null = null;
  private _version = "";

  set version(v: string) { this._version = v; }

  /** Initialize state from VS Code settings and set context keys */
  initFromSettings(): void {
    const cfg = vscode.workspace.getConfiguration("logscope");
    this.state.transport = cfg.get<string>("transport", "rtt") === "uart" ? "uart" : "rtt";
    this.state.baudRate = cfg.get<number>("uart.baudRate", 115200);
    this.state.autoConnect = cfg.get<boolean>("autoConnect", false);
    const parserVal = cfg.get<string>("parser", "zephyr");
    this.state.parser = (parserVal === "nrf5" || parserVal === "raw") ? parserVal : "zephyr";

    // Restore last device
    if (this.state.transport === "uart") {
      const lastPort = cfg.get<string>("uart.lastPort", "");
      this.state.selectedDevice = lastPort;
      this.state.selectedDeviceLabel = lastPort || "";
    } else {
      const lastDevice = cfg.get<string>("lastDevice", "");
      this.state.selectedDevice = lastDevice;
      this.state.selectedDeviceLabel = lastDevice ? `SN: ${lastDevice}` : "";
    }

    this.state.hasLastSession = !!this.state.selectedDevice;
    this.updateContextKeys();
    this._onDidChangeTreeData.fire(undefined);
  }

  // ── Getters ──────────────────────────────────────────────────

  get currentTransport(): "rtt" | "uart" {
    return this.state.transport;
  }

  get currentDevice(): string {
    return this.state.selectedDevice;
  }

  get currentDeviceLabel(): string {
    return this.state.selectedDeviceLabel;
  }

  get currentBaudRate(): number {
    return this.state.baudRate;
  }

  get connectedTransportLabel(): string {
    return this.state.connectedTransport;
  }

  get connectedAddress(): string {
    return this.state.connectedAddress;
  }

  get isConnected(): boolean {
    return this.state.connected;
  }

  get isConnecting(): boolean {
    return this.state.connecting;
  }

  get currentAutoConnect(): boolean {
    return this.state.autoConnect;
  }

  get hasLastSession(): boolean {
    return this.state.hasLastSession;
  }

  // ── State updates ────────────────────────────────────────────

  updateState(partial: Partial<SidebarState>): void {
    const prev = { ...this.state };
    Object.assign(this.state, partial);

    // Track connection start time
    if (!prev.connected && this.state.connected) {
      this.connectStartTime = Date.now();
      this.startDurationTimer();
    } else if (prev.connected && !this.state.connected) {
      this.connectStartTime = null;
      this.stopDurationTimer();
      this.clearCachedItems();
    }

    // Update hasLastSession when device is set
    if (this.state.selectedDevice) {
      this.state.hasLastSession = true;
    }

    this.updateContextKeys();

    // Structural changes require a full tree rebuild
    const structuralChange =
      prev.connected !== this.state.connected ||
      prev.connecting !== this.state.connecting ||
      prev.connectedTransport !== this.state.connectedTransport ||
      prev.connectedAddress !== this.state.connectedAddress ||
      prev.parser !== this.state.parser ||
      prev.transport !== this.state.transport ||
      prev.selectedDevice !== this.state.selectedDevice ||
      prev.selectedDeviceLabel !== this.state.selectedDeviceLabel ||
      prev.hasLastSession !== this.state.hasLastSession;

    if (structuralChange) {
      this.clearCachedItems();
      this._onDidChangeTreeData.fire(undefined);
      return;
    }

    // Counter-only changes: update cached items in place (no tree rebuild)
    if (this.state.connected) {
      this.updateCachedCounters();
    }
  }

  /** Update cached item descriptions in place and fire targeted refreshes */
  private updateCachedCounters(): void {
    if (this.cachedEntries) {
      const newDesc = this.state.entryCount.toLocaleString();
      if (this.cachedEntries.description !== newDesc) {
        this.cachedEntries.description = newDesc;
        this._onDidChangeTreeData.fire(this.cachedEntries);
      }
    }

    if (this.cachedHci) {
      const newDesc = this.state.hciPacketCount.toLocaleString();
      if (this.cachedHci.description !== newDesc) {
        this.cachedHci.description = newDesc;
        this._onDidChangeTreeData.fire(this.cachedHci);
      }
    }

    if (this.cachedErrors && this.state.errorCount > 0) {
      const newDesc = this.state.errorCount.toLocaleString();
      if (this.cachedErrors.description !== newDesc) {
        this.cachedErrors.description = newDesc;
        this._onDidChangeTreeData.fire(this.cachedErrors);
      }
    }

    // If HCI or errors just appeared (were 0, now > 0), need full rebuild to add the item
    if ((!this.cachedHci && this.state.hciPacketCount > 0) ||
        (!this.cachedErrors && this.state.errorCount > 0)) {
      this.clearCachedItems();
      this._onDidChangeTreeData.fire(undefined);
      return;
    }

  }

  private clearCachedItems(): void {
    this.cachedEntries = null;
    this.cachedHci = null;
    this.cachedErrors = null;
    this.cachedDuration = null;
  }

  private startDurationTimer(): void {
    this.stopDurationTimer();
    this.durationInterval = setInterval(() => {
      if (!this.connectStartTime || !this.cachedDuration) return;
      const elapsed = Math.floor((Date.now() - this.connectStartTime) / 1000);
      const h = Math.floor(elapsed / 3600);
      const m = Math.floor((elapsed % 3600) / 60);
      const s = elapsed % 60;
      const str = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
      if (str !== this.lastDurationString) {
        this.lastDurationString = str;
        this.cachedDuration.description = str;
        this._onDidChangeTreeData.fire(this.cachedDuration);
      }
    }, 1000);
  }

  private stopDurationTimer(): void {
    if (this.durationInterval) {
      clearInterval(this.durationInterval);
      this.durationInterval = null;
    }
    this.lastDurationString = "";
  }

  private updateContextKeys(): void {
    vscode.commands.executeCommand("setContext", "logscope.connected", this.state.connected);
    vscode.commands.executeCommand("setContext", "logscope.connecting", this.state.connecting);
    vscode.commands.executeCommand("setContext", "logscope.hasLastSession", this.state.hasLastSession);
  }

  // ── TreeDataProvider ─────────────────────────────────────────

  getTreeItem(element: SidebarItem): vscode.TreeItem {
    return element;
  }

  getChildren(): SidebarItem[] {
    // ── State 1: Connected — show session info ──────────────
    if (this.state.connected) {
      return this.buildConnectedItems();
    }

    // ── State 2: Connecting ─────────────────────────────────
    if (this.state.connecting) {
      return [
        SidebarItem.info("Connecting...", "loading~spin", ""),
      ];
    }

    // ── State 3: Disconnected with last session — show config + actions
    if (this.state.hasLastSession) {
      return this.buildLastSessionItems();
    }

    // ── State 4: First time — return empty → viewsWelcome shows
    return [];
  }

  private buildConnectedItems(): SidebarItem[] {
    const items: SidebarItem[] = [];
    const transportLabel = this.state.connectedTransport || (this.state.transport === "rtt" ? "J-Link RTT" : "Serial UART");

    const connItem = SidebarItem.info("Connected", "plug", transportLabel);
    connItem.id = "info::connection-status";
    items.push(connItem);

    if (this.state.connectedAddress) {
      items.push(SidebarItem.info("Device", "device-desktop", this.state.connectedAddress));
    }

    // Show J-Link device setting when connected via RTT
    if (this.state.transport === "rtt") {
      const cfg = vscode.workspace.getConfiguration("logscope");
      const overrides = cfg.get<Record<string, string>>("jlink.deviceOverrides", {});
      const probeSerial = this.state.selectedDevice;
      const override = overrides[probeSerial];
      items.push(SidebarItem.info("J-Link Device", "chip", override || "Auto"));
    }

    const parserLabels: Record<string, string> = { zephyr: "Zephyr", nrf5: "nRF5 SDK", raw: "Raw" };
    items.push(SidebarItem.info("Parser", "file-code", parserLabels[this.state.parser] || "Zephyr"));

    if (this.state.licenseTier !== "Free") {
      items.push(SidebarItem.info("License", "verified", this.state.licenseTier));
    }

    if (this.connectStartTime) {
      const elapsed = Math.floor((Date.now() - this.connectStartTime) / 1000);
      const h = Math.floor(elapsed / 3600);
      const m = Math.floor((elapsed % 3600) / 60);
      const s = elapsed % 60;
      const duration = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
      this.cachedDuration = SidebarItem.info("Duration", "clock", duration);
      this.lastDurationString = duration;
      items.push(this.cachedDuration);
    }

    this.cachedEntries = SidebarItem.info("Entries", "list-ordered", this.state.entryCount.toLocaleString());
    items.push(this.cachedEntries);

    if (this.state.hciPacketCount > 0) {
      this.cachedHci = SidebarItem.info("HCI Packets", "radio-tower", this.state.hciPacketCount.toLocaleString());
      items.push(this.cachedHci);
    }

    if (this.state.errorCount > 0) {
      this.cachedErrors = SidebarItem.info("Errors", "warning", this.state.errorCount.toLocaleString());
      items.push(this.cachedErrors);
    }

    // Watch patterns sidebar UI is hidden pending redesign.
    // Backend still works: patterns configured in settings.json continue to
    // produce highlights. Management available via command palette commands:
    //   "LogScope: Add Watch Pattern"
    //   "LogScope: Remove Watch Pattern"

    items.push(SidebarItem.separator());
    const docsItem = SidebarItem.link("Documentation", "globe", "https://docs.novelbits.io/logscope");
    docsItem.description = "from Novel Bits";
    items.push(docsItem);
    items.push(SidebarItem.link("Report Issue", "github", "https://github.com/NovelBits/logscope/issues"));

    if (this._version) {
      const versionItem = SidebarItem.info("", "", `LogScope v${this._version}`);
      versionItem.description = `LogScope v${this._version}`;
      versionItem.label = "";
      items.push(versionItem);
    }

    return items;
  }

  private buildLastSessionItems(): SidebarItem[] {
    const items: SidebarItem[] = [];
    const transportLabel = this.state.transport === "rtt" ? "J-Link RTT" : "Serial UART";

    items.push(
      SidebarItem.info("Transport", "circuit-board", transportLabel),
      SidebarItem.info("Device", "device-desktop", this.state.selectedDeviceLabel || this.state.selectedDevice),
    );
    if (this.state.transport === "uart") {
      items.push(SidebarItem.info("Baud Rate", "dashboard", String(this.state.baudRate)));
    }

    if (this.state.transport === "rtt") {
      const cfg = vscode.workspace.getConfiguration("logscope");
      const overrides = cfg.get<Record<string, string>>("jlink.deviceOverrides", {});
      const probeSerial = this.state.selectedDevice;
      const override = overrides[probeSerial];
      items.push(SidebarItem.info("J-Link Device", "chip", override || "Auto"));
    }

    const parserLabels: Record<string, string> = { zephyr: "Zephyr", nrf5: "nRF5 SDK", raw: "Raw" };
    items.push(SidebarItem.info("Parser", "file-code", parserLabels[this.state.parser] || "Zephyr"));

    items.push(SidebarItem.separator(0));

    items.push(SidebarItem.action("Reconnect", "debug-start", "logscope.reconnect"));
    items.push(SidebarItem.action("Change Settings", "settings-gear", "logscope.changeSettings"));
    items.push(SidebarItem.action("Connect New Device", "plug", "logscope.connect"));

    items.push(SidebarItem.separator(1));
    items.push(SidebarItem.action("Get Started Guide", "book", "logscope.openWalkthrough"));
    const docsItem = SidebarItem.link("Documentation", "globe", "https://docs.novelbits.io/logscope");
    docsItem.description = "from Novel Bits";
    items.push(docsItem);
    items.push(SidebarItem.link("Report Issue", "github", "https://github.com/NovelBits/logscope/issues"));

    // License action (persistent, always at bottom)
    items.push(...this.buildLicenseItems());

    if (this._version) {
      const versionItem = SidebarItem.info("", "", `LogScope v${this._version}`);
      versionItem.description = `LogScope v${this._version}`;
      versionItem.label = "";
      items.push(versionItem);
    }

    return items;
  }

  private buildLicenseItems(): SidebarItem[] {
    // License UI hidden until Pro tier launches.
    // LicenseManager + commands stay registered for future use.
    return [];
  }
}

class SidebarItem extends vscode.TreeItem {
  constructor(
    label: string,
    icon: string,
    description: string,
    isSeparator = false,
    stableId?: string,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.id = stableId ?? `${label}::${icon}`;
    if (icon) {
      this.iconPath = new vscode.ThemeIcon(icon);
    }
    this.description = description;
    if (isSeparator) {
      this.label = "──────────";
      this.iconPath = undefined;
    }
  }

  /** Read-only info item (no command) */
  static info(label: string, icon: string, description: string): SidebarItem {
    const item = new SidebarItem(label, icon, description, false, `info::${label}`);
    item.tooltip = `${label}: ${description}`;
    return item;
  }

  /** Clickable action item */
  static action(label: string, icon: string, command: string): SidebarItem {
    const item = new SidebarItem(label, icon, "", false, `action::${command}`);
    item.command = { command, title: label };
    return item;
  }

  static link(label: string, icon: string, url: string): SidebarItem {
    const item = new SidebarItem(label, icon, "", false, `link::${url}`);
    item.command = {
      command: "vscode.open",
      title: label,
      arguments: [vscode.Uri.parse(url)],
    };
    return item;
  }

  static separator(index = 0): SidebarItem {
    return new SidebarItem("", "", "", true, `sep::${index}`);
  }
}
