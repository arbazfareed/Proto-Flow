import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, rmSync } from "node:fs";

const root = path.dirname(fileURLToPath(import.meta.url));
const cargoTauriDriverPath = process.env.TAURI_DRIVER_PATH
  ?? path.join(os.homedir(), ".cargo", "bin", "tauri-driver.exe");
const tauriDriverPath = process.platform === "win32" && existsSync(cargoTauriDriverPath)
  ? execFileSync(
      process.env.ComSpec ?? "cmd.exe",
      ["/d", "/c", `for %I in ("${cargoTauriDriverPath}") do @echo %~sI`],
      { encoding: "utf8", windowsVerbatimArguments: true },
    ).trim()
  : undefined;
const appBinaryCandidates = [
  path.resolve(root, "src-tauri/target/debug/proto-flow.exe"),
  path.resolve(root, "../ProtoFlow-build/target/debug/proto-flow.exe"),
];
const appBinaryPath = process.env.TAURI_E2E_APP_PATH
  ? path.resolve(process.env.TAURI_E2E_APP_PATH)
  : appBinaryCandidates.find(existsSync) ?? appBinaryCandidates[0];
const isolatedDataRoot = path.join(os.tmpdir(), `protoflow-wdio-${process.pid}`);
process.env.APPDATA = path.join(isolatedDataRoot, "Roaming");
process.env.LOCALAPPDATA = path.join(isolatedDataRoot, "Local");
process.env.WEBVIEW2_USER_DATA_FOLDER = path.join(isolatedDataRoot, "WebView2");

export const config = {
  runner: "local",
  specs: ["./e2e/desktop/**/*.spec.mjs"],
  maxInstances: 1,
  capabilities: [{
    browserName: "tauri",
    "tauri:options": { application: appBinaryPath },
  }],
  services: [[
    "@wdio/tauri-service",
    {
      appBinaryPath,
      tauriDriverPath,
      driverProvider: "external",
      autoInstallTauriDriver: true,
      autoDownloadEdgeDriver: true,
      tauriDriverPort: 4444,
      commandTimeout: 60_000,
      startTimeout: 90_000,
      captureFrontendLogs: true,
      logLevel: "info",
    },
  ]],
  framework: "mocha",
  mochaOpts: {
    ui: "bdd",
    timeout: 180_000,
  },
  reporters: ["spec"],
  logLevel: "warn",
  waitforTimeout: 30_000,
  connectionRetryTimeout: 90_000,
  connectionRetryCount: 1,
  onComplete() {
    rmSync(isolatedDataRoot, { recursive: true, force: true });
  },
};
