import { UartTransport, discoverSerialPorts } from "../../src/transport/uart-serial";
import { ChildProcess, spawn } from "child_process";
import { EventEmitter } from "events";

// Mock child_process.spawn
jest.mock("child_process", () => {
  const actual = jest.requireActual("child_process");
  return {
    ...actual,
    spawn: jest.fn(),
  };
});

const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;

function createMockProcess(): ChildProcess {
  const proc = new EventEmitter() as ChildProcess;
  proc.stdout = new EventEmitter() as any;
  proc.stderr = new EventEmitter() as any;
  proc.kill = jest.fn();
  Object.defineProperty(proc, "pid", { value: 12345, writable: true });
  return proc;
}

describe("UartTransport", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("creates with default baud rate", () => {
    const t = new UartTransport({ port: "/dev/ttyACM0" });
    expect(t.connected).toBe(false);
  });

  it("creates with custom baud rate", () => {
    const t = new UartTransport({ port: "/dev/ttyACM0", baudRate: 9600 });
    expect(t.connected).toBe(false);
  });

  it("connects when helper reports SERIAL_READY", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const t = new UartTransport({ port: "/dev/ttyACM0" });
    const connectPromise = t.connect();

    proc.stderr!.emit("data", Buffer.from("SERIAL_READY port=/dev/ttyACM0 baud=115200\n"));

    await connectPromise;
    expect(t.connected).toBe(true);
  });

  it("emits data event from stdout", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const t = new UartTransport({ port: "/dev/ttyACM0" });
    const connectPromise = t.connect();
    proc.stderr!.emit("data", Buffer.from("SERIAL_READY port=/dev/ttyACM0 baud=115200\n"));
    await connectPromise;

    const dataPromise = new Promise<Buffer>((resolve) => t.on("data", resolve));
    proc.stdout!.emit("data", Buffer.from("Hello from UART\n"));
    const received = await dataPromise;
    expect(received.toString()).toBe("Hello from UART\n");
  });

  it("rejects on ERROR from helper", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const t = new UartTransport({ port: "/dev/ttyACM0" });
    const connectPromise = t.connect();

    proc.stderr!.emit("data", Buffer.from("ERROR: No such port /dev/ttyACM0\n"));

    await expect(connectPromise).rejects.toThrow("No such port");
  });

  it("disconnects cleanly", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const t = new UartTransport({ port: "/dev/ttyACM0" });
    const connectPromise = t.connect();
    proc.stderr!.emit("data", Buffer.from("SERIAL_READY\n"));
    await connectPromise;

    t.disconnect();
    expect(t.connected).toBe(false);
    expect(proc.kill).toHaveBeenCalled();
  });

  it("handles disconnect when not connected", () => {
    const t = new UartTransport({ port: "/dev/ttyACM0" });
    expect(() => t.disconnect()).not.toThrow();
  });

  it("rejects if already connected", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const t = new UartTransport({ port: "/dev/ttyACM0" });
    const connectPromise = t.connect();
    proc.stderr!.emit("data", Buffer.from("SERIAL_READY\n"));
    await connectPromise;

    await expect(t.connect()).rejects.toThrow("Already connected");
  });

  it("emits disconnected when helper exits", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const t = new UartTransport({ port: "/dev/ttyACM0" });
    const connectPromise = t.connect();
    proc.stderr!.emit("data", Buffer.from("SERIAL_READY\n"));
    await connectPromise;

    const disconnectedPromise = new Promise<void>((resolve) => t.on("disconnected", resolve));
    proc.emit("exit", 0);
    await disconnectedPromise;
    expect(t.connected).toBe(false);
  });
});

describe("discoverSerialPorts", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns discovered ports from helper", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const promise = discoverSerialPorts();

    const response = JSON.stringify({
      ports: [
        { path: "/dev/cu.usbmodem001", manufacturer: "SEGGER", serialNumber: "1234" },
        { path: "/dev/cu.usbmodem002", manufacturer: "FTDI", serialNumber: "5678" },
      ],
    });
    proc.stdout!.emit("data", Buffer.from(response));
    proc.emit("exit", 0);

    const ports = await promise;
    expect(ports).toHaveLength(2);
    expect(ports[0].path).toBe("/dev/cu.usbmodem001");
    expect(ports[0].manufacturer).toBe("SEGGER");
  });

  it("returns empty array on error", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const promise = discoverSerialPorts();
    proc.emit("error", new Error("spawn failed"));

    const ports = await promise;
    expect(ports).toHaveLength(0);
  });
});
