#!/usr/bin/env node
// Verify parity between configuration keys declared in package.json and
// configuration keys actually read at runtime in src/**/*.ts.
//
// Two failure modes this catches:
//   1. Key read at runtime but NOT declared in package.json
//      -> Users can't discover the setting in the VS Code Settings UI.
//      -> Example: pre-v0.5.17 logscope.jlink.remoteHost.
//   2. Key declared in package.json but NEVER read at runtime
//      -> Users configure the setting, see it in the UI, and get no behavior.
//      -> Example: pre-v0.5.17 logscope.rtt.address, jlink.interface, etc.
//
// Exit 0 if parity. Exit 1 on any error or warning (configurable via --warn-only).
//
// Run locally:   node scripts/check-runtime-config-keys.mjs
// Run in CI:     same; non-zero exit fails the workflow.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const NAMESPACE = "logscope";

const args = new Set(process.argv.slice(2));
const WARN_ONLY = args.has("--warn-only");
const JSON_OUT = args.has("--json");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function declaredKeys() {
  const pkg = readJson(join(REPO_ROOT, "package.json"));
  const props = pkg?.contributes?.configuration?.properties ?? {};
  const keys = new Set();
  for (const fullKey of Object.keys(props)) {
    if (fullKey.startsWith(`${NAMESPACE}.`)) {
      keys.add(fullKey.slice(NAMESPACE.length + 1));
    }
  }
  return keys;
}

function* walkTs(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      yield* walkTs(path);
    } else if (st.isFile() && (name.endsWith(".ts") || name.endsWith(".tsx"))) {
      yield path;
    }
  }
}

// Return `true` if a CallExpression is `vscode.workspace.getConfiguration("logscope")`
// or any equivalent that ends with `.getConfiguration("logscope")`.
function isGetConfigurationCall(node) {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee)) return false;
  if (callee.name.text !== "getConfiguration") return false;
  const arg = node.arguments[0];
  if (!arg || !ts.isStringLiteral(arg)) return false;
  return arg.text === NAMESPACE;
}

// Find every `.get("key", ...)` call where the receiver is a getConfiguration("logscope")
// call (either inline or aliased through a local variable).
function readKeysFromFile(filePath) {
  const source = readFileSync(filePath, "utf8");
  const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const aliases = new Set();
  const keys = new Set();

  // First pass: find variable declarations like `const cfg = vscode...getConfiguration("logscope")`
  function collectAliases(node) {
    if (ts.isVariableDeclaration(node) && node.name && ts.isIdentifier(node.name) && node.initializer) {
      if (isGetConfigurationCall(node.initializer)) {
        aliases.add(node.name.text);
      }
    }
    ts.forEachChild(node, collectAliases);
  }
  collectAliases(sf);

  // Second pass: find `.get("key", ...)` calls where the receiver is either
  // a getConfiguration("logscope") call or one of the aliased variables.
  function collectGets(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const pae = node.expression;
      if (pae.name.text === "get") {
        const receiver = pae.expression;
        const isDirectGetConfig = isGetConfigurationCall(receiver);
        const isAliasedReceiver = ts.isIdentifier(receiver) && aliases.has(receiver.text);
        if (isDirectGetConfig || isAliasedReceiver) {
          const keyArg = node.arguments[0];
          if (keyArg && ts.isStringLiteral(keyArg)) {
            keys.add(keyArg.text);
          }
        }
      }
    }
    ts.forEachChild(node, collectGets);
  }
  collectGets(sf);

  return keys;
}

function main() {
  const declared = declaredKeys();
  const read = new Set();
  const srcDir = join(REPO_ROOT, "src");
  for (const file of walkTs(srcDir)) {
    for (const key of readKeysFromFile(file)) read.add(key);
  }

  // Settings that are written via `update()` to persist UI state and may never
  // be read directly in this repo's source (e.g., webview reads them indirectly,
  // or they're read on next activation). Exempt to avoid false positives.
  // Keep this list short and justified.
  const allowedUndeclaredOrUnread = new Set([
    // (none right now)
  ]);

  const undeclared = [...read].filter(k => !declared.has(k) && !allowedUndeclaredOrUnread.has(k));
  const unused = [...declared].filter(k => !read.has(k) && !allowedUndeclaredOrUnread.has(k));

  if (JSON_OUT) {
    process.stdout.write(JSON.stringify({ declared: [...declared], read: [...read], undeclared, unused }, null, 2) + "\n");
  } else {
    console.log(`Declared in package.json:  ${declared.size}`);
    console.log(`Read in src/:              ${read.size}`);
    console.log("");
    if (undeclared.length === 0 && unused.length === 0) {
      console.log("✓ Parity: every read setting is declared, every declared setting is read.");
    }
    if (undeclared.length > 0) {
      console.log("✗ Read at runtime but NOT declared in package.json (users cannot discover these):");
      for (const k of undeclared.sort()) console.log(`    logscope.${k}`);
      console.log("");
    }
    if (unused.length > 0) {
      console.log("✗ Declared in package.json but NEVER read in src/ (broken contracts with users):");
      for (const k of unused.sort()) console.log(`    logscope.${k}`);
      console.log("");
    }
  }

  const failed = undeclared.length > 0 || unused.length > 0;
  if (failed && !WARN_ONLY) process.exit(1);
}

main();
