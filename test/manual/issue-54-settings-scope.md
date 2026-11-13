# Manual test: issue #54 (settings no longer written to the workspace)

Branch `fix/54-settings-scope`. Do this test before you release v0.6.8. Part A needs no hardware. Part B needs
one J-Link board with a USB serial port (for example the nRF54L15-DK).

The pass rule for every step: `git status` in the test folder shows no change, and a reload keeps the value.

## Setup

1. Make a test folder that Git tracks, with an old-style settings file:

   ```bash
   mkdir -p /tmp/logscope-54 && cd /tmp/logscope-54 && git init -q
   mkdir -p .vscode && cat > .vscode/settings.json <<'EOF'
   {
     "logscope.transport": "uart",
     "logscope.lastDevice": "123456789"
   }
   EOF
   git add -A && git commit -qm "settings as 0.6.7 left them"
   ```

2. Open `~/Projects/tools/logscope` in VS Code. Push F5 ("Run Extension"). This builds and opens an
   Extension Development Host window.
3. In that window, open the folder `/tmp/logscope-54`.
4. Keep a terminal open in `/tmp/logscope-54` for `git status`.

## Part A: no hardware

### A1. Upgrade: old values are read

- [ ] The LogScope sidebar shows transport **UART**. LogScope read the old `logscope.transport` line.

### A2. Transport

- [ ] Run **LogScope: Change Connection Settings**, choose Transport, choose **RTT**. Cancel the device picker.
- [ ] `git status`: no change. `.vscode/settings.json` still says `"uart"`.
- [ ] Reload the window (**Developer: Reload Window**). The sidebar shows **RTT**.

### A3. Parser

- [ ] Run **LogScope: Select Parser**, choose **nRF5**.
- [ ] `git status`: no change.
- [ ] Open the user settings JSON (**Preferences: Open User Settings (JSON)**). It has `"logscope.parser": "nrf5"`.
- [ ] Reload. The parser is still nRF5.

### A4. UART settings

- [ ] Change Connection Settings: set the transport to UART (cancel the port picker), then change the baud rate,
      data bits, stop bits and parity.
- [ ] `git status`: no change. The user settings JSON has the four new values.

### A5. Watch pattern and line wrap

- [ ] Run **LogScope: Add Watch Pattern** and add one pattern. Run **LogScope: Remove Watch Pattern** and remove it.
- [ ] Run **LogScope: Open Log Viewer** and click **Wrap** twice.
- [ ] `git status`: no change.

### A6. Column widths

- [ ] In the log viewer, drag a column edge to make it wider.
- [ ] `git status`: no change.
- [ ] Close the panel, reload, open the log viewer. The column keeps its width.
- [ ] Right-click the column header, choose **Reset all columns**. The column goes back to its default width.

### A7. A workspace value stays in the workspace

- [ ] Add `"logscope.parser": "raw"` to `.vscode/settings.json` and commit it.
- [ ] Select Parser, choose **Zephyr**.
- [ ] `git status`: `.vscode/settings.json` changed from `raw` to `zephyr`. This is correct: the team set it there.
- [ ] Undo it: `git checkout .vscode/settings.json`.

### A8. Delete the old lines: nothing is lost

- [ ] Set the transport to **UART** in the UI (cancel the port picker).
- [ ] Delete the `logscope.transport` and `logscope.lastDevice` lines from `.vscode/settings.json`.
- [ ] The sidebar still shows **UART**. Reload: still **UART**.

### A9. A setting change replaces the remembered value

- [ ] Disconnected, in the user settings JSON, set `"logscope.transport": "rtt"`.
- [ ] The sidebar changes to **RTT** without a reload.

## Part B: hardware (J-Link board with a USB serial port)

### B1. RTT device

- [ ] Connect the board. Set the transport to RTT and select the board in the device picker. Connect.
- [ ] `git status`: no change.
- [ ] Disconnect and reload. The sidebar shows the board's serial number (SN).
- [ ] **LogScope: Reconnect** connects to the same board.

### B2. UART port

- [ ] Set the transport to UART and select the board's serial port. Connect.
- [ ] `git status`: no change.
- [ ] Disconnect and reload. The sidebar shows the same port.

### B3. A setting change during a live session

- [ ] Connect on UART. In the user settings JSON, set `"logscope.transport": "rtt"`.
- [ ] The live session continues. The sidebar does not change during the session.

### B4. Forget Device

- [ ] Add `"logscope.lastDevice": "123456789"` to `.vscode/settings.json` again.
- [ ] Connect on RTT to the board, disconnect, run **LogScope: Forget Device**.
- [ ] Reload. The sidebar shows no device. The old `123456789` does not come back.

## Cleanup

- [ ] Remove the `logscope.*` lines you added to the user settings JSON in A3, A4 and A9.
- [ ] `rm -rf /tmp/logscope-54`
