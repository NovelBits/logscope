import * as esbuild from "esbuild";
import { copyFileSync, mkdirSync } from "fs";

const isWatch = process.argv.includes("--watch");

// ── Extension bundle (Node / CommonJS) ──────────────────────────
const extensionConfig = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "out/extension.js",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  sourcemap: true,
  minify: false,
};

// ── WebView bundle (browser / IIFE) ────────────────────────────
const webviewConfig = {
  entryPoints: ["src/ui/webview/main.ts"],
  bundle: true,
  outfile: "out/webview/main.js",
  format: "iife",
  platform: "browser",
  sourcemap: true,
  minify: false,
};

// ── Copy static assets ──────────────────────────────────────────
function copyAssets() {
  mkdirSync("out/webview", { recursive: true });
  copyFileSync("src/ui/webview/styles.css", "out/webview/styles.css");
  copyFileSync("src/ui/webview/index.html", "out/webview/index.html");
  // Helper scripts (run as subprocesses, not bundled into JS)
  copyFileSync("src/transport/rtt-helper.py", "out/rtt-helper.py");
  copyFileSync("src/transport/uart-helper.py", "out/uart-helper.py");
}

if (isWatch) {
  const extCtx = await esbuild.context(extensionConfig);
  const webCtx = await esbuild.context(webviewConfig);
  copyAssets();
  await Promise.all([extCtx.watch(), webCtx.watch()]);
  console.log("Watching...");
} else {
  await Promise.all([
    esbuild.build(extensionConfig),
    esbuild.build(webviewConfig),
  ]);
  copyAssets();
}
