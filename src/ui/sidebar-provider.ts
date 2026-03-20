import * as vscode from "vscode";

export interface SidebarState {
  connected: boolean;
  connecting: boolean;
  transport: "rtt" | "uart";
  selectedDevice: string;        // serial number or port path
  selectedDeviceLabel: string;   // human-readable
  baudRate: number;
  autoConnect: boolean;
  connectedTransport: string;    // "J-Link RTT" or "Serial UART"
  connectedAddress: string;
  entryCount: number;
  hciPacketCount: number;
  errorCount: number;
  hasLastSession: boolean;       // true if we have saved transport+device
}

export class LogScopeSidebarProvider implements vscode.TreeDataProvider<SidebarItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SidebarItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private state: SidebarState = {
    connected: false,
    connecting: false,
    transport: "rtt",
    selectedDevice: "",
    selectedDeviceLabel: "",
    baudRate: 115200,
    autoConnect: false,
    connectedTransport: "",
    connectedAddress: "",
    entryCount: 0,
    hciPacketCount: 0,
    errorCount: 0,
    hasLastSession: false,
  };

  private connectStartTime: number | null = null;

  /** Initialize state from VS Code settings and set context keys */
  initFromSettings(): void {
    const cfg = vscode.workspace.getConfiguration("logscope");
    this.state.transport = cfg.get<string>("transport", "rtt") === "uart" ? "uart" : "rtt";
    this.state.baudRate = cfg.get<number>("uart.baudRate", 115200);
    this.state.autoConnect = cfg.get<boolean>("autoConnect", false);

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
    const wasConnected = this.state.connected;
    Object.assign(this.state, partial);

    // Track connection start time
    if (!wasConnected && this.state.connected) {
      this.connectStartTime = Date.now();
    } else if (wasConnected && !this.state.connected) {
      this.connectStartTime = null;
    }

    // Update hasLastSession when device is set
    if (this.state.selectedDevice) {
      this.state.hasLastSession = true;
    }

    this.updateContextKeys();
    this._onDidChangeTreeData.fire(undefined);
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

    items.push(SidebarItem.info(
      `Connected via ${transportLabel}`,
      "plug",
      "",
    ));

    if (this.state.connectedAddress) {
      items.push(SidebarItem.info("Device", "device-desktop", this.state.connectedAddress));
    }

    if (this.connectStartTime) {
      const elapsed = Math.floor((Date.now() - this.connectStartTime) / 1000);
      const h = Math.floor(elapsed / 3600);
      const m = Math.floor((elapsed % 3600) / 60);
      const s = elapsed % 60;
      const duration = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
      items.push(SidebarItem.info("Duration", "clock", duration));
    }

    items.push(SidebarItem.info(
      "Entries",
      "list-ordered",
      this.state.entryCount.toLocaleString(),
    ));

    if (this.state.hciPacketCount > 0) {
      items.push(SidebarItem.info("HCI Packets", "radio-tower", this.state.hciPacketCount.toLocaleString()));
    }

    if (this.state.errorCount > 0) {
      items.push(SidebarItem.info("Errors", "warning", this.state.errorCount.toLocaleString()));
    }

    return items;
  }

  private buildLastSessionItems(): SidebarItem[] {
    const items: SidebarItem[] = [];
    const transportLabel = this.state.transport === "rtt" ? "J-Link RTT" : "Serial UART";

    items.push(SidebarItem.info("Transport", "circuit-board", transportLabel));
    items.push(SidebarItem.info(
      "Device",
      "device-desktop",
      this.state.selectedDeviceLabel || this.state.selectedDevice,
    ));
    if (this.state.transport === "uart") {
      items.push(SidebarItem.info("Baud Rate", "dashboard", String(this.state.baudRate)));
    }

    items.push(SidebarItem.separator());

    items.push(SidebarItem.action("Reconnect", "debug-start", "logscope.reconnect"));
    items.push(SidebarItem.action("Change Settings", "settings-gear", "logscope.changeSettings"));
    items.push(SidebarItem.action("Connect New Device", "plug", "logscope.connect"));

    items.push(SidebarItem.separator());
    items.push(SidebarItem.action("Get Started Guide", "book", "logscope.openWalkthrough"));
    items.push(SidebarItem.link("Help & Feedback", "globe", "https://novelbits.io/logscope"));

    return items;
  }
}

class SidebarItem extends vscode.TreeItem {
  constructor(
    label: string,
    icon: string,
    description: string,
    isSeparator = false
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
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
    return new SidebarItem(label, icon, description);
  }

  /** Clickable action item */
  static action(label: string, icon: string, command: string): SidebarItem {
    const item = new SidebarItem(label, icon, "");
    item.command = { command, title: label };
    return item;
  }

  static link(label: string, icon: string, url: string): SidebarItem {
    const item = new SidebarItem(label, icon, "");
    item.command = {
      command: "vscode.open",
      title: label,
      arguments: [vscode.Uri.parse(url)],
    };
    return item;
  }

  static separator(): SidebarItem {
    return new SidebarItem("", "", "", true);
  }
}
