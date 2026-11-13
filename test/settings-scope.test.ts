import {
  chooseWriteScope,
  isMachineStateKey,
  MachineStateStore,
  type StateMemento,
  type SettingsReader,
} from "../src/settings-scope";

/** In-memory stand-in for vscode.Memento (workspaceState / globalState). */
class FakeMemento implements StateMemento {
  readonly data = new Map<string, unknown>();
  get<T>(key: string): T | undefined {
    return this.data.get(key) as T | undefined;
  }
  async update(key: string, value: unknown): Promise<void> {
    this.data.set(key, value);
  }
}

/**
 * In-memory stand-in for the `logscope` WorkspaceConfiguration. `values` are
 * user (global) settings; `workspace` values override them, as in VS Code.
 */
function fakeSettings(
  values: Record<string, unknown>,
  workspace: Record<string, unknown> = {},
): SettingsReader {
  return {
    get<T>(key: string, fallback?: T): T | undefined {
      if (key in workspace) return workspace[key] as T;
      if (key in values) return values[key] as T;
      return fallback;
    },
    inspect(key: string) {
      return { globalValue: values[key], workspaceValue: workspace[key] };
    },
  };
}

describe("isMachineStateKey", () => {
  it.each(["transport", "lastDevice", "uart.lastPort", "columnWidths"])(
    "treats %s as machine state",
    (key) => {
      expect(isMachineStateKey(key)).toBe(true);
    },
  );

  it.each([
    "parser",
    "watchPatterns",
    "jlink.deviceOverrides",
    "uart.baudRate",
    "uart.dataBits",
    "uart.stopBits",
    "uart.parity",
    "logWrap",
  ])("treats %s as a user setting", (key) => {
    expect(isMachineStateKey(key)).toBe(false);
  });
});

describe("chooseWriteScope", () => {
  it("writes to the workspace when the workspace already defines the key", () => {
    expect(chooseWriteScope({ workspaceValue: "nrf5" }, true)).toBe("workspace");
  });

  it("writes to global when only the user settings define the key", () => {
    expect(chooseWriteScope({ globalValue: "nrf5" }, true)).toBe("global");
  });

  it("writes to global when no scope defines the key, even with a folder open", () => {
    expect(chooseWriteScope({}, true)).toBe("global");
  });

  it("writes to global when inspect returns nothing", () => {
    expect(chooseWriteScope(undefined, true)).toBe("global");
  });

  it("writes to global when no workspace is open", () => {
    expect(chooseWriteScope({ workspaceValue: "nrf5" }, false)).toBe("global");
  });

  it("keeps a workspace value that is falsy but defined", () => {
    expect(chooseWriteScope({ workspaceValue: false }, true)).toBe("workspace");
  });
});

describe("MachineStateStore", () => {
  it("returns the stored state when it exists", () => {
    const memento = new FakeMemento();
    memento.data.set("logscope.state.lastDevice", "1050123456");
    const store = new MachineStateStore(() => memento, fakeSettings({ lastDevice: "999" }));
    expect(store.get("lastDevice", "")).toBe("1050123456");
  });

  it("falls back to the old setting when no state exists (upgrade from 0.6.7)", () => {
    const store = new MachineStateStore(() => new FakeMemento(), fakeSettings({ lastDevice: "999" }));
    expect(store.get("lastDevice", "")).toBe("999");
  });

  it("falls back to the default when neither state nor setting exists", () => {
    const store = new MachineStateStore(() => new FakeMemento(), fakeSettings({}));
    expect(store.get("transport", "rtt")).toBe("rtt");
  });

  // SettingsReader has no write method, so the store cannot touch settings.json.
  it("writes to state", async () => {
    const memento = new FakeMemento();
    const store = new MachineStateStore(() => memento, fakeSettings({}));
    await store.set("uart.lastPort", "/dev/tty.usbmodem1");
    expect(memento.data.get("logscope.state.uart.lastPort")).toBe("/dev/tty.usbmodem1");
    expect(store.get("uart.lastPort", "")).toBe("/dev/tty.usbmodem1");
  });

  it("keeps a cleared value instead of falling back to the old setting", async () => {
    const memento = new FakeMemento();
    const store = new MachineStateStore(() => memento, fakeSettings({ lastDevice: "999" }));
    await store.set("lastDevice", "");
    expect(store.get("lastDevice", "")).toBe("");
  });

  it("uses a committed transport as the default for a fresh checkout", () => {
    const store = new MachineStateStore(() => new FakeMemento(), fakeSettings({ transport: "uart" }));
    expect(store.get("transport", "rtt")).toBe("uart");
  });

  it("adopts a setting that the user changed, so the setting still works as an override", async () => {
    const memento = new FakeMemento();
    const values: Record<string, unknown> = {};
    const store = new MachineStateStore(() => memento, fakeSettings(values));
    await store.set("transport", "rtt");
    values.transport = "uart";
    await store.adoptSetting("transport");
    expect(store.get("transport", "rtt")).toBe("uart");
  });

  // Review finding: deleting the lines 0.6.7 left in .vscode/settings.json (the
  // cleanup the CHANGELOG suggests) must not forget the device just connected.
  it("keeps the remembered state when the user removes the old setting", async () => {
    const memento = new FakeMemento();
    const values: Record<string, unknown> = { lastDevice: "999" };
    const store = new MachineStateStore(() => memento, fakeSettings(values));
    store.noteSettings();
    await store.set("lastDevice", "1050123456");
    delete values.lastDevice;
    await store.adoptSetting("lastDevice");
    expect(store.get("lastDevice", "")).toBe("1050123456");
  });

  it("keeps the remembered state when a change does not alter the effective value", async () => {
    const memento = new FakeMemento();
    const user: Record<string, unknown> = {};
    const store = new MachineStateStore(() => memento, fakeSettings(user, { transport: "uart" }));
    store.noteSettings();
    await store.set("transport", "rtt");
    user.transport = "rtt"; // overridden by the workspace value, so nothing changed here
    await store.adoptSetting("transport");
    expect(store.get("transport", "rtt")).toBe("rtt");
  });

  it("adopts an explicit setting that equals the default", async () => {
    const memento = new FakeMemento();
    const values: Record<string, unknown> = {};
    const settings = fakeSettings(values);
    const withDefault: SettingsReader = {
      get: <T>(key: string, fallback?: T) => settings.get<T>(key, (fallback ?? (key === "transport" ? "rtt" : undefined)) as T),
      inspect: (key) => settings.inspect(key),
    };
    const store = new MachineStateStore(() => memento, withDefault);
    store.noteSettings();
    await store.set("transport", "uart");
    values.transport = "rtt"; // same as the package default, but now set on purpose
    await store.adoptSetting("transport");
    expect(store.get("transport", "rtt")).toBe("rtt");
  });

  it("adopts a later change after a change it skipped", async () => {
    const memento = new FakeMemento();
    const values: Record<string, unknown> = { transport: "uart" };
    const store = new MachineStateStore(() => memento, fakeSettings(values));
    store.noteSettings();
    await store.set("transport", "rtt");
    await store.adoptSetting("transport"); // event with no real change: skipped
    values.transport = "rtt";
    await store.adoptSetting("transport");
    values.transport = "uart";
    await store.adoptSetting("transport");
    expect(store.get("transport", "rtt")).toBe("uart");
  });

  it("reads the memento at call time, so the store follows the current workspace", async () => {
    let current = new FakeMemento();
    const store = new MachineStateStore(() => current, fakeSettings({}));
    await store.set("transport", "uart");
    current = new FakeMemento();
    expect(store.get("transport", "rtt")).toBe("rtt");
  });
});
