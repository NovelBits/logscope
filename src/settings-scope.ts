/**
 * Where LogScope persists what it remembers (issue #54).
 *
 * Two kinds of value:
 *
 * - Machine state (last device, last port, transport, column widths) describes
 *   one machine and one session. It goes to extension state (workspaceState, or
 *   globalState when no folder is open), never to settings.json, so LogScope
 *   does not change version-controlled `.vscode/settings.json`.
 * - User choices (parser, watch patterns, UART framing, ...) stay settings. They
 *   are written back at the scope that already defines them, so a team that
 *   commits `logscope.parser` keeps it in the workspace. A key defined nowhere
 *   is written to the user (global) settings.
 *
 * This module has no runtime dependency on `vscode` so it can be unit-tested.
 */

export const MACHINE_STATE_KEYS = ["transport", "lastDevice", "uart.lastPort", "columnWidths"] as const;
export type MachineStateKey = (typeof MACHINE_STATE_KEYS)[number];

export function isMachineStateKey(key: string): key is MachineStateKey {
  return (MACHINE_STATE_KEYS as readonly string[]).includes(key);
}

/** The subset of `WorkspaceConfiguration.inspect()` that the scope choice reads. */
export interface InspectResult {
  globalValue?: unknown;
  workspaceValue?: unknown;
  workspaceFolderValue?: unknown;
}

export type WriteScope = "global" | "workspace";

/**
 * Pick the settings scope for a user-choice write: the workspace if it already
 * defines the key (so the new value takes effect and a committed team value is
 * respected), else global.
 */
export function chooseWriteScope(inspect: InspectResult | undefined, hasWorkspace: boolean): WriteScope {
  if (hasWorkspace && inspect?.workspaceValue !== undefined) return "workspace";
  return "global";
}

/** The subset of `vscode.Memento` the store uses. */
export interface StateMemento {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
}

/** The subset of the `logscope` `WorkspaceConfiguration` the store reads. */
export interface SettingsReader {
  /** Effective value; without a fallback, the package.json default. */
  get<T>(key: string, fallback?: T): T | undefined;
  inspect(key: string): InspectResult | undefined;
}

function isDefinedAnywhere(i: InspectResult | undefined): boolean {
  return i !== undefined &&
    (i.globalValue !== undefined || i.workspaceValue !== undefined || i.workspaceFolderValue !== undefined);
}

function signatureOf(settings: SettingsReader, key: string): { value: unknown; defined: boolean; signature: string } {
  const value = settings.get<unknown>(key);
  const defined = isDefinedAnywhere(settings.inspect(key));
  return { value, defined, signature: JSON.stringify([value ?? null, defined]) };
}

const STATE_PREFIX = "logscope.state.";

/**
 * Reads and writes machine state. A value in state wins. Without one, the old
 * setting is read: this carries a 0.6.7 remembered device across the upgrade,
 * and lets a committed `logscope.transport` act as the default for a fresh
 * checkout. Writes go to state only.
 */
export class MachineStateStore {
  /** Per key at the last noteSettings()/adoptSetting(): effective value and whether any scope sets it, as JSON. */
  private readonly seen = new Map<MachineStateKey, string>();

  constructor(
    private readonly memento: () => StateMemento,
    private readonly settings: SettingsReader | (() => SettingsReader),
  ) {}

  get<T>(key: MachineStateKey, fallback: T): T {
    const stored = this.memento().get<T>(STATE_PREFIX + key);
    if (stored !== undefined) return stored;
    return this.readSettings().get<T>(key, fallback) as T;
  }

  async set(key: MachineStateKey, value: unknown): Promise<void> {
    await this.memento().update(STATE_PREFIX + key, value);
  }

  /** Record the current effective settings, so adoptSetting() can tell a real change. Call once at activation. */
  noteSettings(): void {
    const settings = this.readSettings();
    for (const key of MACHINE_STATE_KEYS) this.seen.set(key, signatureOf(settings, key).signature);
  }

  /**
   * Call when the setting changes. LogScope no longer writes these settings,
   * so a change came from the user (or a pulled commit) and wins over the
   * remembered value. Two cases are skipped: a removed setting (deleting the
   * lines 0.6.7 left behind must not forget the device), and an event that
   * did not change the effective value (a user setting that a workspace
   * value overrides). Going from unset to set counts as a change even when
   * the value equals the default. Returns true when the state changed.
   */
  async adoptSetting(key: MachineStateKey): Promise<boolean> {
    const { value, defined, signature } = signatureOf(this.readSettings(), key);
    const changed = this.seen.get(key) !== signature;
    this.seen.set(key, signature);
    if (!changed || !defined) return false;
    await this.set(key, value);
    return true;
  }

  private readSettings(): SettingsReader {
    return typeof this.settings === "function" ? this.settings() : this.settings;
  }
}
