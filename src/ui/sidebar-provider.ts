import * as vscode from "vscode";

interface ConnectionState {
  connected: boolean;
  connecting: boolean;
  transport: string;
  address: string;
  entryCount: number;
}

export class LogScopeSidebarProvider implements vscode.TreeDataProvider<SidebarItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SidebarItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private state: ConnectionState = {
    connected: false,
    connecting: false,
    transport: "",
    address: "",
    entryCount: 0,
  };

  updateState(partial: Partial<ConnectionState>): void {
    Object.assign(this.state, partial);
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: SidebarItem): vscode.TreeItem {
    return element;
  }

  getChildren(): SidebarItem[] {
    const items: SidebarItem[] = [];

    // Status
    if (this.state.connecting) {
      items.push(new SidebarItem("Connecting...", "loading~spin", ""));
    } else if (this.state.connected) {
      items.push(new SidebarItem("Connected", "plug", this.state.address));
      items.push(new SidebarItem(
        `${this.state.entryCount.toLocaleString()} entries`,
        "list-ordered",
        ""
      ));
    } else {
      items.push(new SidebarItem("Disconnected", "debug-disconnect", ""));
    }

    // Separator
    items.push(new SidebarItem("", "", "", true));

    // Actions
    if (this.state.connected) {
      items.push(SidebarItem.action("Open Log Viewer", "open-preview", "logscope.open"));
      items.push(SidebarItem.action("Export", "desktop-download", "logscope.export"));
      items.push(SidebarItem.action("Disconnect", "debug-disconnect", "logscope.disconnect"));
    } else if (!this.state.connecting) {
      items.push(SidebarItem.action("Connect", "plug", "logscope.connect"));
      items.push(SidebarItem.action("Open Log Viewer", "open-preview", "logscope.open"));
    }

    // Branding
    items.push(new SidebarItem("", "", "", true)); // separator
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
}
