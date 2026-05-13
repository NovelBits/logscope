import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/test"],
  testMatch: ["**/*.test.ts"],
  moduleFileExtensions: ["ts", "js", "json"],
  moduleNameMapper: {
    "^@novelbits/ble-spec$": "<rootDir>/packages/ble-spec/src/index.ts",
    "^@novelbits/ble-spec/(.*)$": "<rootDir>/packages/ble-spec/src/$1",
  },
};

export default config;
