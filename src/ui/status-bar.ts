import * as vscode from "vscode";

export class StatusBar {
  private readonly connectionItem: vscode.StatusBarItem;
  private readonly countItem: vscode.StatusBarItem;

  constructor() {
    this.connectionItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    this.connectionItem.command = "logscope.open";
    this.connectionItem.tooltip = "LogScope from Novel Bits — Click to open";

    this.countItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      99
    );
    this.countItem.tooltip = "LogScope: Log entry count";

    // Show items immediately
    this.update(false, 0, 0);
    this.connectionItem.show();
    this.countItem.show();
  }

  update(connected: boolean, entryCount: number, evictedCount: number): void {
    if (connected) {
      this.connectionItem.text = "$(plug) LogScope: Connected";
      this.connectionItem.command = "logscope.disconnect";
      this.connectionItem.tooltip = "LogScope from Novel Bits — Click to disconnect";
    } else {
      this.connectionItem.text = "$(debug-disconnect) LogScope: Disconnected";
      this.connectionItem.command = "logscope.open";
      this.connectionItem.tooltip = "LogScope from Novel Bits — Click to open";
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
