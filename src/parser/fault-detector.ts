/**
 * Crash/fault detection for Zephyr RTOS log output.
 * Checks log messages against known fault patterns.
 */

export type FaultType = "hard-fault" | "assertion" | "stack-overflow" | "watchdog" | "fatal";

export interface FaultMatch {
  type: FaultType;
}

const PATTERNS: Array<{ regex: RegExp; type: FaultType }> = [
  // ARM Cortex-M faults
  { regex: /\bHARD FAULT\b/i, type: "hard-fault" },
  { regex: /\bBUS FAULT\b/i, type: "hard-fault" },
  { regex: /\bMEMORY FAULT\b/i, type: "hard-fault" },
  { regex: /\bUSAGE FAULT\b/i, type: "hard-fault" },
  { regex: /\bSECURE FAULT\b/i, type: "hard-fault" },

  // Zephyr fatal errors
  { regex: /ZEPHYR FATAL ERROR/i, type: "fatal" },
  { regex: /\bHalting system\b/i, type: "fatal" },
  { regex: /\bFatal exception\b/i, type: "fatal" },

  // Assertions
  { regex: /ASSERTION FAIL/i, type: "assertion" },
  { regex: /\b__ASSERT\b/, type: "assertion" },
  { regex: /\bk_panic\b/, type: "assertion" },

  // Stack overflow
  { regex: /\bstack overflow\b/i, type: "stack-overflow" },

  // Watchdog
  { regex: /\bWDT timeout\b/i, type: "watchdog" },
  { regex: /\bwatchdog.*(?:reset|expired|timeout|fired)\b/i, type: "watchdog" },
];

export function detectFault(message: string): FaultMatch | null {
  if (!message) return null;
  for (const { regex, type } of PATTERNS) {
    if (regex.test(message)) {
      return { type };
    }
  }
  return null;
}
