import { TelemetryService } from "../src/telemetry";

// Mock @vscode/extension-telemetry
const mockSendTelemetryEvent = jest.fn();
const mockDispose = jest.fn();

jest.mock("@vscode/extension-telemetry", () => ({
  TelemetryReporter: jest.fn().mockImplementation(() => ({
    sendTelemetryEvent: mockSendTelemetryEvent,
    dispose: mockDispose,
  })),
}));

// Mock vscode
jest.mock("vscode", () => ({
  version: "1.110.0",
}), { virtual: true });

function createMockContext(globalStateData: Record<string, unknown> = {}): {
  globalState: { get: jest.Mock; update: jest.Mock };
  subscriptions: unknown[];
  extension: { packageJSON: { version: string } };
} {
  const store = { ...globalStateData };
  return {
    globalState: {
      get: jest.fn((key: string) => store[key]),
      update: jest.fn((key: string, value: unknown) => {
        store[key] = value;
        return Promise.resolve();
      }),
    },
    subscriptions: [],
    extension: { packageJSON: { version: "0.4.0" } },
  };
}

describe("TelemetryService", () => {
  let service: TelemetryService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TelemetryService();
  });

  describe("init()", () => {
    it("generates install ID on first call", () => {
      const ctx = createMockContext();
      service.init(ctx as never);

      expect(ctx.globalState.get).toHaveBeenCalledWith("logscope.installId");
      expect(ctx.globalState.update).toHaveBeenCalledWith(
        "logscope.installId",
        expect.any(String)
      );
    });

    it("stores install date on first call", () => {
      const ctx = createMockContext();
      service.init(ctx as never);

      expect(ctx.globalState.update).toHaveBeenCalledWith(
        "logscope.installDate",
        expect.any(Number)
      );
    });

    it("reuses existing install ID", () => {
      const ctx = createMockContext({
        "logscope.installId": "existing-id-123",
        "logscope.installDate": 1700000000000,
      });
      service.init(ctx as never);

      // Should NOT update installId (it already exists)
      const updateCalls = ctx.globalState.update.mock.calls;
      const installIdUpdates = updateCalls.filter(
        (call: [string, unknown]) => call[0] === "logscope.installId"
      );
      expect(installIdUpdates).toHaveLength(0);
    });

    it("does not overwrite existing install date", () => {
      const ctx = createMockContext({
        "logscope.installId": "existing-id-123",
        "logscope.installDate": 1700000000000,
      });
      service.init(ctx as never);

      const updateCalls = ctx.globalState.update.mock.calls;
      const dateUpdates = updateCalls.filter(
        (call: [string, unknown]) => call[0] === "logscope.installDate"
      );
      expect(dateUpdates).toHaveLength(0);
    });

    it("adds reporter to context subscriptions", () => {
      const ctx = createMockContext();
      service.init(ctx as never);

      expect(ctx.subscriptions).toHaveLength(1);
    });
  });

  describe("trackActivation()", () => {
    it("sends correct event shape", () => {
      const ctx = createMockContext();
      service.init(ctx as never);

      service.trackActivation("0.4.0");

      expect(mockSendTelemetryEvent).toHaveBeenCalledWith(
        "activation",
        expect.objectContaining({
          installId: expect.any(String),
          extensionVersion: "0.4.0",
          platform: process.platform,
          arch: process.arch,
          vscodeVersion: "1.110.0",
        }),
        undefined
      );
    });

    it("includes installId in properties", () => {
      const ctx = createMockContext({
        "logscope.installId": "test-install-id",
        "logscope.installDate": 1700000000000,
      });
      service.init(ctx as never);

      service.trackActivation("0.4.0");

      const call = mockSendTelemetryEvent.mock.calls[0];
      expect(call[1].installId).toBe("test-install-id");
    });
  });

  describe("trackSessionStart()", () => {
    it("sends transport and parser mode", () => {
      const ctx = createMockContext();
      service.init(ctx as never);

      service.trackSessionStart("rtt", "zephyr");

      expect(mockSendTelemetryEvent).toHaveBeenCalledWith(
        "session_start",
        expect.objectContaining({
          transport: "rtt",
          parserMode: "zephyr",
        }),
        undefined
      );
    });
  });

  describe("trackSessionEnd()", () => {
    it("calculates duration correctly", () => {
      const ctx = createMockContext();
      service.init(ctx as never);

      // Start a session
      const startTime = Date.now();
      service.trackSessionStart("rtt", "zephyr");
      mockSendTelemetryEvent.mockClear();

      // End the session after a small delay
      service.trackSessionEnd({
        transport: "rtt",
        parserMode: "zephyr",
        entryCount: 100,
        hciPacketCount: 5,
        errorCount: 2,
        evictedCount: 0,
      });

      expect(mockSendTelemetryEvent).toHaveBeenCalledWith(
        "session_end",
        expect.objectContaining({
          transport: "rtt",
          parserMode: "zephyr",
        }),
        expect.objectContaining({
          durationMs: expect.any(Number),
          entryCount: 100,
          hciPacketCount: 5,
          errorCount: 2,
          evictedCount: 0,
        })
      );

      // Duration should be >= 0 (test runs fast)
      const measurements = mockSendTelemetryEvent.mock.calls[0][2];
      expect(measurements.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("sends zero duration when no session was started", () => {
      const ctx = createMockContext();
      service.init(ctx as never);

      service.trackSessionEnd({
        transport: "uart",
        parserMode: "raw",
        entryCount: 50,
        hciPacketCount: 0,
        errorCount: 1,
        evictedCount: 10,
      });

      const measurements = mockSendTelemetryEvent.mock.calls[0][2];
      expect(measurements.durationMs).toBe(0);
    });
  });

  describe("trackConnectFailed()", () => {
    it("sends error code and transport", () => {
      const ctx = createMockContext();
      service.init(ctx as never);

      service.trackConnectFailed("NO_PROBE", "rtt");

      expect(mockSendTelemetryEvent).toHaveBeenCalledWith(
        "connect_failed",
        expect.objectContaining({
          errorCode: "NO_PROBE",
          transport: "rtt",
        }),
        undefined
      );
    });
  });

  describe("trackConnectFlowAbandoned()", () => {
    it("sends step name", () => {
      const ctx = createMockContext();
      service.init(ctx as never);

      service.trackConnectFlowAbandoned("device");

      expect(mockSendTelemetryEvent).toHaveBeenCalledWith(
        "connect_flow_abandoned",
        expect.objectContaining({ step: "device" }),
        undefined
      );
    });
  });

  describe("trackExport()", () => {
    it("sends format and entry count", () => {
      const ctx = createMockContext();
      service.init(ctx as never);

      service.trackExport("jsonl", 500);

      expect(mockSendTelemetryEvent).toHaveBeenCalledWith(
        "export",
        expect.objectContaining({ format: "jsonl" }),
        { entryCount: 500 }
      );
    });
  });

  describe("trackParserChange()", () => {
    it("sends from and to parser modes", () => {
      const ctx = createMockContext();
      service.init(ctx as never);

      service.trackParserChange("zephyr", "nrf5");

      expect(mockSendTelemetryEvent).toHaveBeenCalledWith(
        "parser_change",
        expect.objectContaining({ from: "zephyr", to: "nrf5" }),
        undefined
      );
    });
  });

  describe("trackCommand()", () => {
    it("sends command ID", () => {
      const ctx = createMockContext();
      service.init(ctx as never);

      service.trackCommand("logscope.open");

      expect(mockSendTelemetryEvent).toHaveBeenCalledWith(
        "command",
        expect.objectContaining({ commandId: "logscope.open" }),
        undefined
      );
    });
  });

  describe("fail-safety", () => {
    it("trackActivation does not throw when reporter throws", () => {
      const ctx = createMockContext();
      service.init(ctx as never);
      mockSendTelemetryEvent.mockImplementation(() => {
        throw new Error("Network failure");
      });

      expect(() => service.trackActivation("0.4.0")).not.toThrow();
    });

    it("trackSessionStart does not throw when reporter throws", () => {
      const ctx = createMockContext();
      service.init(ctx as never);
      mockSendTelemetryEvent.mockImplementation(() => {
        throw new Error("Network failure");
      });

      expect(() => service.trackSessionStart("rtt", "zephyr")).not.toThrow();
    });

    it("trackSessionEnd does not throw when reporter throws", () => {
      const ctx = createMockContext();
      service.init(ctx as never);
      mockSendTelemetryEvent.mockImplementation(() => {
        throw new Error("Network failure");
      });

      expect(() =>
        service.trackSessionEnd({
          transport: "rtt",
          parserMode: "zephyr",
          entryCount: 0,
          hciPacketCount: 0,
          errorCount: 0,
          evictedCount: 0,
        })
      ).not.toThrow();
    });

    it("trackConnectFailed does not throw when reporter throws", () => {
      const ctx = createMockContext();
      service.init(ctx as never);
      mockSendTelemetryEvent.mockImplementation(() => {
        throw new Error("Network failure");
      });

      expect(() => service.trackConnectFailed("TIMEOUT", "rtt")).not.toThrow();
    });

    it("trackExport does not throw when reporter throws", () => {
      const ctx = createMockContext();
      service.init(ctx as never);
      mockSendTelemetryEvent.mockImplementation(() => {
        throw new Error("Network failure");
      });

      expect(() => service.trackExport("text", 100)).not.toThrow();
    });

    it("trackParserChange does not throw when reporter throws", () => {
      const ctx = createMockContext();
      service.init(ctx as never);
      mockSendTelemetryEvent.mockImplementation(() => {
        throw new Error("Network failure");
      });

      expect(() => service.trackParserChange("zephyr", "raw")).not.toThrow();
    });

    it("trackCommand does not throw when reporter throws", () => {
      const ctx = createMockContext();
      service.init(ctx as never);
      mockSendTelemetryEvent.mockImplementation(() => {
        throw new Error("Network failure");
      });

      expect(() => service.trackCommand("logscope.open")).not.toThrow();
    });

    it("trackConnectFlowAbandoned does not throw when reporter throws", () => {
      const ctx = createMockContext();
      service.init(ctx as never);
      mockSendTelemetryEvent.mockImplementation(() => {
        throw new Error("Network failure");
      });

      expect(() => service.trackConnectFlowAbandoned("transport")).not.toThrow();
    });

    it("all track methods work before init (no reporter)", () => {
      // service is not initialized, reporter is undefined
      expect(() => service.trackActivation("0.4.0")).not.toThrow();
      expect(() => service.trackSessionStart("rtt", "zephyr")).not.toThrow();
      expect(() =>
        service.trackSessionEnd({
          transport: "rtt",
          parserMode: "zephyr",
          entryCount: 0,
          hciPacketCount: 0,
          errorCount: 0,
          evictedCount: 0,
        })
      ).not.toThrow();
      expect(() => service.trackConnectFailed("TIMEOUT", "rtt")).not.toThrow();
      expect(() => service.trackConnectFlowAbandoned("transport")).not.toThrow();
      expect(() => service.trackExport("text", 0)).not.toThrow();
      expect(() => service.trackParserChange("zephyr", "raw")).not.toThrow();
      expect(() => service.trackCommand("logscope.open")).not.toThrow();
    });
  });

  describe("no PII in events", () => {
    it("never includes file paths in any event", () => {
      const ctx = createMockContext();
      service.init(ctx as never);

      service.trackActivation("0.4.0");
      service.trackSessionStart("rtt", "zephyr");
      service.trackSessionEnd({
        transport: "rtt",
        parserMode: "zephyr",
        entryCount: 100,
        hciPacketCount: 5,
        errorCount: 2,
        evictedCount: 0,
      });
      service.trackConnectFailed("NO_PROBE", "rtt");
      service.trackConnectFlowAbandoned("device");
      service.trackExport("jsonl", 500);
      service.trackParserChange("zephyr", "nrf5");
      service.trackCommand("logscope.open");

      for (const call of mockSendTelemetryEvent.mock.calls) {
        const properties = call[1] as Record<string, string>;
        for (const [key, value] of Object.entries(properties)) {
          expect(value).not.toMatch(/\/Users\//);
          expect(value).not.toMatch(/\/home\//);
          expect(value).not.toMatch(/C:\\/);
          expect(value).not.toMatch(/\/dev\/tty/);
        }
        // Check measurements too
        if (call[2]) {
          const measurements = call[2] as Record<string, number>;
          for (const value of Object.values(measurements)) {
            expect(typeof value).toBe("number");
          }
        }
      }
    });

    it("never includes serial numbers in properties", () => {
      const ctx = createMockContext();
      service.init(ctx as never);

      // These are the only string properties we send; verify no serial number patterns
      service.trackConnectFailed("NO_PROBE", "rtt");

      const call = mockSendTelemetryEvent.mock.calls[0];
      const properties = call[1] as Record<string, string>;
      // errorCode should be a classified code, not a raw message with serial info
      expect(properties.errorCode).toBe("NO_PROBE");
      expect(properties.transport).toBe("rtt");
    });
  });

  describe("dispose()", () => {
    it("clears the reporter reference", () => {
      const ctx = createMockContext();
      service.init(ctx as never);

      service.dispose();

      // After dispose, sending should be a no-op (no throw)
      expect(() => service.trackActivation("0.4.0")).not.toThrow();
      // And sendTelemetryEvent should NOT be called after dispose
      mockSendTelemetryEvent.mockClear();
      service.trackActivation("0.4.0");
      expect(mockSendTelemetryEvent).not.toHaveBeenCalled();
    });
  });
});
