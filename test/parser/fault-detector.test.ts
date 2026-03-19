import { detectFault } from "../../src/parser/fault-detector";

describe("detectFault", () => {
  // Hard faults
  test("detects HARD FAULT", () => {
    expect(detectFault("***** HARD FAULT *****")).toEqual({ type: "hard-fault" });
  });

  test("detects BUS FAULT", () => {
    expect(detectFault("***** BUS FAULT *****")).toEqual({ type: "hard-fault" });
  });

  test("detects MEMORY FAULT", () => {
    expect(detectFault("MEMORY FAULT detected")).toEqual({ type: "hard-fault" });
  });

  test("detects USAGE FAULT", () => {
    expect(detectFault("***** USAGE FAULT *****")).toEqual({ type: "hard-fault" });
  });

  test("detects SECURE FAULT", () => {
    expect(detectFault("***** SECURE FAULT *****")).toEqual({ type: "hard-fault" });
  });

  test("detects hard fault case-insensitively", () => {
    expect(detectFault("hard fault occurred")).toEqual({ type: "hard-fault" });
  });

  // Zephyr fatal errors
  test("detects ZEPHYR FATAL ERROR", () => {
    expect(detectFault(">>> ZEPHYR FATAL ERROR 1: Unhandled interrupt")).toEqual({ type: "fatal" });
  });

  test("detects Halting system", () => {
    expect(detectFault("Halting system")).toEqual({ type: "fatal" });
  });

  test("detects Fatal exception", () => {
    expect(detectFault("Fatal exception in thread 0x20001000")).toEqual({ type: "fatal" });
  });

  // Assertions
  test("detects ASSERTION FAIL", () => {
    expect(detectFault("ASSERTION FAIL [main.c:42]")).toEqual({ type: "assertion" });
  });

  test("detects __ASSERT", () => {
    expect(detectFault("__ASSERT triggered at kernel/sched.c:123")).toEqual({ type: "assertion" });
  });

  test("detects k_panic", () => {
    expect(detectFault("k_panic called from ISR")).toEqual({ type: "assertion" });
  });

  // Stack overflow
  test("detects stack overflow", () => {
    expect(detectFault("stack overflow detected for thread main")).toEqual({ type: "stack-overflow" });
  });

  test("detects STACK OVERFLOW case-insensitively", () => {
    expect(detectFault("STACK OVERFLOW in thread 0x20001000")).toEqual({ type: "stack-overflow" });
  });

  // Watchdog
  test("detects WDT timeout", () => {
    expect(detectFault("WDT timeout")).toEqual({ type: "watchdog" });
  });

  test("detects watchdog reset", () => {
    expect(detectFault("watchdog timer reset")).toEqual({ type: "watchdog" });
  });

  test("detects watchdog expired", () => {
    expect(detectFault("watchdog expired")).toEqual({ type: "watchdog" });
  });

  test("detects watchdog fired", () => {
    expect(detectFault("watchdog fired, rebooting")).toEqual({ type: "watchdog" });
  });

  // No false positives
  test("does not match normal log with 'fault' substring", () => {
    expect(detectFault("Page fault handler registered")).toBeNull();
  });

  test("does not match 'watchdog' without action keyword", () => {
    expect(detectFault("watchdog timer initialized")).toBeNull();
  });

  test("does not match normal info log", () => {
    expect(detectFault("Connection established successfully")).toBeNull();
  });

  test("does not match empty string", () => {
    expect(detectFault("")).toBeNull();
  });

  test("handles null/undefined gracefully", () => {
    expect(detectFault(null as unknown as string)).toBeNull();
    expect(detectFault(undefined as unknown as string)).toBeNull();
  });
});
