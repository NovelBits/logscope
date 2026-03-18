import * as vscode from "vscode";

export class StatusBar {
  private connectionItem: vscode.StatusBarItem;
  private countItem: vscode.StatusBarItem;

  constructor() {
    this.connectionItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    this.connectionItem.command = "devscope.connect";
    this.connectionItem.tooltip = "Devscope: Click to connect";

    this.countItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      99
    );
    this.countItem.tooltip = "Devscope: Log entry count";

    // Show items immediately
    this.update(false, 0, 0);
    this.connectionItem.show();
    this.countItem.show();
  }

  update(connected: boolean, entryCount: number, evictedCount: number): void {
    if (connected) {
      this.connectionItem.text = "$(plug) Devscope: Connected";
      this.connectionItem.command = "devscope.disconnect";
      this.connectionItem.tooltip = "Devscope: Click to disconnect";
    } else {
      this.connectionItem.text = "$(debug-disconnect) Devscope: Disconnected";
      this.connectionItem.command = "devscope.connect";
      this.connectionItem.tooltip = "Devscope: Click to connect";
    }

    let countText = `$(list-ordered) ${entryCount.toLocaleString()}`;
    if (evictedCount > 0) {
      countText += ` (${evictedCount.toLocaleString()} evicted)`;
    }
    this.countItem.text = countText;
  }

  dispose(): void {
    this.connectionItem.dispose();
    this.countItem.dispose();
  }
}
