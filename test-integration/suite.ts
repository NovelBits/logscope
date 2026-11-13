/**
 * Runs inside the VS Code extension host (see run.mjs). Drives the real
 * LogScope commands with scripted pickers and checks where values land.
 * Phase 1 makes changes. Phase 2 is a new VS Code process on the same profile
 * and workspace. VS Code keeps extension state in memory during tests, so phase 2
 * starts with no saved state: the fresh-clone case (see run.mjs).
 */
import * as vscode from "vscode";
import { execFileSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const phase = process.env.LOGSCOPE_IT_PHASE;
const workspace = process.env.LOGSCOPE_IT_WORKSPACE!;
const settingsFile = join(workspace, ".vscode", "settings.json");
const EXTENSION_ID = "novelbits.novelbits-logscope";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const results: { name: string; ok: boolean; detail: string }[] = [];

function check(name: string, ok: boolean, detail = ""): void {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

function git(...args: string[]): string {
  return execFileSync("git", ["-C", workspace, "-c", "user.name=it", "-c", "user.email=it@example.invalid", ...args], {
    encoding: "utf8",
  });
}

function gitClean(name: string): void {
  const status = git("status", "--porcelain").trim();
  check(name, status === "", status || "clean");
}

// ── Scripted pickers ────────────────────────────────────────────
// Each entry answers the next picker LogScope shows: a label substring to
// accept, or null to cancel (close) it.
const answers: (string | null)[] = [];
let pickersShown = 0;
const trace: string[] = [];
let lastMenu: { label: string; description?: string }[] = [];

function pickFrom<T extends vscode.QuickPickItem>(items: readonly T[], answer: string): T | undefined {
  return items.find(i => i.kind !== vscode.QuickPickItemKind.Separator && (i.label.includes(answer) || !!i.description?.includes(answer)));
}

function fakeQuickPick(): unknown {
  const listeners = new Map<string, ((arg?: unknown) => void)[]>();
  const on = (name: string) => (fn: (arg?: unknown) => void) => {
    listeners.set(name, [...(listeners.get(name) ?? []), fn]);
    return { dispose() {} };
  };
  const fire = (name: string, arg?: unknown) => (listeners.get(name) ?? []).forEach(fn => fn(arg));
  const qp: Record<string, unknown> = {
    items: [], selectedItems: [], activeItems: [], buttons: [], value: "",
    onDidAccept: on("accept"), onDidHide: on("hide"), onDidTriggerButton: on("button"),
    onDidChangeSelection: on("selection"), onDidChangeActive: on("active"),
    onDidChangeValue: on("value"), onDidTriggerItemButton: on("itemButton"),
    hide: () => fire("hide"),
    dispose: () => {},
    show: () => {
      pickersShown++;
      const answer = answers.shift();
      void (async () => {
        await sleep(20);
        const items = () => qp.items as vscode.QuickPickItem[];
        trace.push(`${String(qp.title)} / ${String(qp.placeholder)} -> ${String(answer)}`);
        if (qp.title === "Connection Settings" && qp.placeholder === "Change connection setting") {
          lastMenu = items().map(i => ({ label: i.label, description: i.description }));
        }
        if (answer === null || answer === undefined) { fire("hide"); return; }
        const deadline = Date.now() + 45_000; // a device scan can take a while
        while (Date.now() < deadline) {
          const item = pickFrom(items(), answer);
          if (item) { qp.selectedItems = [item]; qp.activeItems = [item]; fire("accept"); return; }
          await sleep(50);
        }
        check(`picker offered "${answer}"`, false, `${String(qp.title)}: ${items().map(i => i.label).join(" | ")}`);
        fire("hide");
      })();
    },
  };
  return qp;
}

async function fakeShowQuickPick(items: readonly vscode.QuickPickItem[] | Thenable<readonly vscode.QuickPickItem[]>) {
  pickersShown++;
  const answer = answers.shift();
  const list = await items;
  return answer ? pickFrom(list, answer) : undefined;
}

const messages: string[] = [];

async function fakeShowInformationMessage(message: string, ...rest: unknown[]) {
  if (message === "Forget the saved device?") return "Forget Device";
  messages.push(`info: ${message}`);
  void rest;
  return undefined;
}

async function fakeShowProblem(message: string, ...rest: unknown[]) {
  messages.push(`problem: ${message}`);
  void rest;
  return undefined;
}

// The sidebar tree, captured when the extension registers it.
let sidebarTree: vscode.TreeDataProvider<vscode.TreeItem> | undefined;

/** Sidebar items as label -> description (e.g. "Connected" -> "Serial UART"). */
async function sidebar(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const item of ((await sidebarTree?.getChildren()) ?? []) as vscode.TreeItem[]) {
    const label = typeof item.label === "string" ? item.label : item.label?.label ?? "";
    out[label] = String(item.description ?? "");
  }
  return out;
}

/** Run a command, answer its pickers, and return once they are all answered. */
async function run(command: string, ...script: (string | null)[]): Promise<void> {
  answers.push(...script);
  const done = vscode.commands.executeCommand(command);
  // A cancelled step picker never resolves its promise (same in real use), so
  // wait for the script to be consumed instead of awaiting the command.
  const deadline = Date.now() + 15_000;
  while (answers.length > 0 && Date.now() < deadline) await sleep(50);
  await Promise.race([done, sleep(1500)]);
  if (answers.length > 0) {
    check(`${command} consumed its script`, false, `left: ${JSON.stringify(answers)}; last pickers: ${trace.slice(-4).join(" || ")}`);
  }
  answers.length = 0;
}

/** Open Connection Settings, read the menu, close it. */
async function menu(): Promise<Record<string, string>> {
  lastMenu = [];
  await run("logscope.changeSettings", null);
  const out: Record<string, string> = {};
  for (const item of lastMenu) out[item.label.replace(/^\$\([^)]+\)\s*/, "")] = item.description ?? "";
  return out;
}

async function eventually(name: string, test: () => Promise<[boolean, string]>, ms = 8000): Promise<void> {
  const deadline = Date.now() + ms;
  let last: [boolean, string] = [false, ""];
  while (Date.now() < deadline) {
    last = await test();
    if (last[0]) break;
    await sleep(250);
  }
  check(name, last[0], last[1]);
}

const cfg = () => vscode.workspace.getConfiguration("logscope");


async function phase1(): Promise<void> {
  const original = readFileSync(settingsFile, "utf8");

  const m0 = await menu();
  check("A1 old workspace transport is read (UART)", m0["Transport"] === "Serial UART", m0["Transport"]);

  await run("logscope.cycleParser", "nRF5");
  await eventually("A3 parser goes to user settings", async () => {
    const i = cfg().inspect("parser");
    return [i?.globalValue === "nrf5" && i?.workspaceValue === undefined, `global=${String(i?.globalValue)} workspace=${String(i?.workspaceValue)}`];
  });
  gitClean("A3 git status clean");

  await run("logscope.changeSettings", "Data Bits", "7");
  await eventually("A4 UART data bits go to user settings", async () => {
    const i = cfg().inspect("uart.dataBits");
    return [i?.globalValue === 7 && i?.workspaceValue === undefined, `global=${String(i?.globalValue)} workspace=${String(i?.workspaceValue)}`];
  });
  gitClean("A4 git status clean");

  await run("logscope.addWatchPattern", "Errors");
  await eventually("A5 watch pattern added in user settings", async () => {
    const i = cfg().inspect<{ name: string }[]>("watchPatterns");
    return [!!i?.globalValue?.some(p => p.name === "Errors") && i?.workspaceValue === undefined, JSON.stringify(i?.globalValue)];
  });
  await run("logscope.removeWatchPattern", "Errors");
  await eventually("A5 watch pattern removed", async () => {
    const i = cfg().inspect<{ name: string }[]>("watchPatterns");
    return [!(i?.globalValue ?? []).some(p => p.name === "Errors"), JSON.stringify(i?.globalValue)];
  });
  gitClean("A5 git status clean");

  // A7: a team value committed in the workspace stays in the workspace.
  const head = git("rev-parse", "HEAD").trim();
  writeFileSync(settingsFile, original.replace("{\n", '{\n  "logscope.parser": "raw",\n'));
  git("commit", "-qam", "team parser");
  await eventually("A7 committed workspace parser is seen", async () => {
    const v = cfg().inspect("parser")?.workspaceValue;
    return [v === "raw", String(v)];
  });
  await run("logscope.cycleParser", "Zephyr");
  await eventually("A7 change lands in the workspace, user value untouched", async () => {
    const i = cfg().inspect("parser");
    return [i?.workspaceValue === "zephyr" && i?.globalValue === "nrf5", `workspace=${String(i?.workspaceValue)} global=${String(i?.globalValue)}`];
  });
  git("reset", "-q", "--hard", head);
  await eventually("A7 workspace restored", async () => {
    const v = cfg().inspect("parser")?.workspaceValue;
    return [v === undefined, String(v)];
  });

  // A2: transport switch. The device picker that follows is cancelled.
  await run("logscope.changeSettings", "Transport", "J-Link RTT", null);
  await eventually("A2 sidebar shows RTT", async () => {
    const m = await menu();
    return [m["Transport"] === "J-Link RTT", m["Transport"]];
  });
  check("A2 .vscode/settings.json unchanged", readFileSync(settingsFile, "utf8") === original);
  gitClean("A2 git status clean");

  // B4 without hardware: Forget Device clears the remembered device.
  await vscode.commands.executeCommand("logscope.forgetDevice");
  await sleep(500);
  const m1 = await menu();
  check("B4 Forget Device clears the device", m1["Device"] === "None", m1["Device"]);

  for (const key of ["transport", "lastDevice", "uart.lastPort", "columnWidths"]) {
    const i = cfg().inspect(key);
    check(`no ${key} written to user settings`, i?.globalValue === undefined, String(JSON.stringify(i?.globalValue)));
  }
  check(".vscode/settings.json unchanged at end of phase 1", readFileSync(settingsFile, "utf8") === original);
  gitClean("phase 1 git status clean");

}

/**
 * Hardware phase (B1-B3): needs a J-Link board with RTT firmware, for example
 * samples/prebuilt/nrf54l15dk-generic-demo.hex. Real connects; nothing is flashed.
 */
async function phase3(): Promise<void> {
  const probe = process.env.LOGSCOPE_IT_PROBE!;
  const port = process.env.LOGSCOPE_IT_PORT!;
  const original = readFileSync(settingsFile, "utf8");
  check("sidebar tree captured", !!sidebarTree);
  const connected = async (label: string, device?: string): Promise<[boolean, string]> => {
    const s = await sidebar();
    const ok = s["Connected"] === label && (!device || (s["Device"] ?? "").includes(device));
    return [ok, `${JSON.stringify(s)} messages=${JSON.stringify(messages.slice(-3))}`];
  };
  const noMachineKeysInUserSettings = (step: string) => {
    for (const key of ["transport", "lastDevice", "uart.lastPort"]) {
      const i = cfg().inspect(key);
      check(`${step}: no ${key} in user or workspace settings`, i?.globalValue === undefined && i?.workspaceValue === undefined,
        `global=${JSON.stringify(i?.globalValue)} workspace=${JSON.stringify(i?.workspaceValue)}`);
    }
  };

  // B1: RTT device.
  await run("logscope.changeSettings", "Transport", "J-Link RTT", probe);
  await eventually("B1 probe selected", async () => {
    const m = await menu();
    return [(m["Device"] ?? "").includes(probe), String(m["Device"])];
  }, 60_000);
  void vscode.commands.executeCommand("logscope.reconnect");
  await eventually("B1 RTT session connected", () => connected("J-Link RTT"), 90_000);
  check("B1 .vscode/settings.json unchanged", readFileSync(settingsFile, "utf8") === original);
  gitClean("B1 git status clean");
  noMachineKeysInUserSettings("B1");
  await vscode.commands.executeCommand("logscope.disconnect");
  await eventually("B1 disconnected", async () => { const s = await sidebar(); return [s["Connected"] === undefined, JSON.stringify(s)]; }, 20_000);
  const m1 = await menu();
  check("B1 probe still remembered after disconnect", (m1["Device"] ?? "").includes(probe), String(m1["Device"]));

  // B2: UART port.
  await run("logscope.changeSettings", "Transport", "Serial UART", port);
  await eventually("B2 UART selected", async () => {
    const m = await menu();
    return [m["Transport"] === "Serial UART" && m["Device"] !== "None", `${m["Transport"]} / ${m["Device"]}`];
  }, 60_000);
  void vscode.commands.executeCommand("logscope.reconnect");
  await eventually("B2 UART session connected to the board's port", () => connected("Serial UART", port), 90_000);
  check("B2 .vscode/settings.json unchanged", readFileSync(settingsFile, "utf8") === original);
  gitClean("B2 git status clean");
  noMachineKeysInUserSettings("B2");

  // B3: a setting change during a live session does not touch the session.
  await cfg().update("transport", "rtt", vscode.ConfigurationTarget.Global);
  await sleep(3000);
  const [stillUart, detail] = await connected("Serial UART", port);
  check("B3 live UART session unchanged after a transport setting change", stillUart, detail);
  await cfg().update("transport", undefined, vscode.ConfigurationTarget.Global);
  await vscode.commands.executeCommand("logscope.disconnect");
  await eventually("B3 disconnected", async () => { const s = await sidebar(); return [s["Connected"] === undefined, JSON.stringify(s)]; }, 20_000);

  check(".vscode/settings.json unchanged at end of phase 3", readFileSync(settingsFile, "utf8") === original);
  gitClean("phase 3 git status clean");
}

async function phase2(): Promise<void> {
  // No saved state (see run.mjs): the committed lines act as the team default.
  const m0 = await menu();
  check("fresh clone: committed transport is the default (UART)", m0["Transport"] === "Serial UART", m0["Transport"]);
  check("fresh clone: no UART port remembered", m0["Device"] === "None", m0["Device"]);
  check("new process: user-settings parser kept (nRF5)", m0["Parser"] === "nRF5 SDK", m0["Parser"]);

  await run("logscope.changeSettings", "Transport", "Serial UART", null);
  await eventually("UART selected", async () => {
    const m = await menu();
    return [m["Transport"] === "Serial UART", m["Transport"]];
  });

  // A8: the user deletes the lines 0.6.7 left behind, and commits.
  writeFileSync(settingsFile, "{\n}\n");
  git("commit", "-qam", "remove old logscope lines");
  await eventually("A8 old lines gone from the configuration", async () => {
    const v = cfg().inspect("transport")?.workspaceValue;
    return [v === undefined, String(v)];
  });
  await sleep(1500);
  const m1 = await menu();
  check("A8 deleting the old lines keeps the remembered UART", m1["Transport"] === "Serial UART", m1["Transport"]);

  // A9: an explicit user setting equal to the default still replaces the remembered value.
  await cfg().update("transport", "rtt", vscode.ConfigurationTarget.Global);
  await eventually("A9 user setting rtt replaces remembered UART, sidebar refreshed", async () => {
    const m = await menu();
    return [m["Transport"] === "J-Link RTT", m["Transport"]];
  });
  await cfg().update("transport", undefined, vscode.ConfigurationTarget.Global);

  check(".vscode/settings.json has only the user's own edit", readFileSync(settingsFile, "utf8") === "{\n}\n");
  gitClean("phase 2 git status clean");
}

export async function run_(): Promise<void> {
  const w = vscode.window as unknown as Record<string, unknown>;
  w.createQuickPick = fakeQuickPick;
  w.showQuickPick = fakeShowQuickPick;
  w.showInformationMessage = fakeShowInformationMessage;
  w.showWarningMessage = fakeShowProblem;
  w.showErrorMessage = fakeShowProblem;
  const registerTree = (w.registerTreeDataProvider as typeof vscode.window.registerTreeDataProvider).bind(vscode.window);
  w.registerTreeDataProvider = (id: string, provider: vscode.TreeDataProvider<vscode.TreeItem>) => {
    if (id === "logscope.sidebar") sidebarTree = provider;
    return registerTree(id, provider);
  };

  const ext = vscode.extensions.getExtension(EXTENSION_ID);
  if (!ext) throw new Error("LogScope extension not found");
  await ext.activate();

  if (phase === "1") await phase1();
  else if (phase === "2") await phase2();
  else await phase3();

  check("scripted pickers reached the extension", pickersShown > 0, `${pickersShown} pickers`);
  const failed = results.filter(r => !r.ok);
  console.log(`\nPhase ${phase}: ${results.length - failed.length} passed, ${failed.length} failed`);
  if (failed.length > 0) throw new Error(`${failed.length} check(s) failed: ${failed.map(f => f.name).join("; ")}`);
}

export { run_ as run };
