import { RttTransport } from "../../src/transport/rtt";
import * as net from "net";

describe("RttTransport", () => {
  let server: net.Server;
  let port: number;

  beforeEach((done) => {
    server = net.createServer();
    server.listen(0, () => {
      port = (server.address() as net.AddressInfo).port;
      done();
    });
  });

  afterEach((done) => {
    server.close(done);
  });

  test("connects to telnet server", async () => {
    server.on("connection", () => {});
    const transport = new RttTransport("localhost", port);
    await transport.connect();
    expect(transport.connected).toBe(true);
    transport.disconnect();
  });

  test("emits data events on received bytes", async () => {
    server.on("connection", (socket) => {
      socket.write("[00:00:01.000,000] <inf> test: hello\n");
    });

    const transport = new RttTransport("localhost", port);
    const received = new Promise<Buffer>((resolve) => {
      transport.on("data", (chunk: Buffer) => resolve(chunk));
    });

    await transport.connect();
    const data = await received;
    expect(data.toString()).toContain("hello");
    transport.disconnect();
  });

  test("emits disconnected on server close", async () => {
    server.on("connection", (socket) => {
      setTimeout(() => socket.end(), 50);
    });

    const transport = new RttTransport("localhost", port);
    const disconnected = new Promise<void>((resolve) => {
      transport.on("disconnected", () => resolve());
    });

    await transport.connect();
    await disconnected;
    expect(transport.connected).toBe(false);
  });

  test("emits error on connection failure", async () => {
    // Use a port from a server we immediately close, so ECONNREFUSED is fast
    const tmpServer = net.createServer();
    const closedPort = await new Promise<number>((resolve) => {
      tmpServer.listen(0, () => {
        const p = (tmpServer.address() as net.AddressInfo).port;
        tmpServer.close(() => resolve(p));
      });
    });
    const transport = new RttTransport("localhost", closedPort);
    transport.on("error", () => {}); // prevent unhandled EventEmitter error
    await expect(transport.connect()).rejects.toThrow();
  });

  test("disconnect is safe to call when not connected", () => {
    const transport = new RttTransport("localhost", port);
    expect(() => transport.disconnect()).not.toThrow();
  });
});
