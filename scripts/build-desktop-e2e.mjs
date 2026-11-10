import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tauriCli = path.join(root, "node_modules", "@tauri-apps", "cli", "tauri.js");
const result = spawnSync(process.execPath, [
  tauriCli,
  "build",
  "--debug",
  "--no-bundle",
  "--features",
  "wdio",
  "--config",
  path.join(root, "src-tauri", "tauri.e2e.conf.json"),
], {
  cwd: root,
  env: { ...process.env, VITE_WDIO: "true" },
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
