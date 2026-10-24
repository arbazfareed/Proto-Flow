import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const port = 1420;
const baseUrl = `http://127.0.0.1:${port}`;
const baseline = JSON.parse(
  await readFile(new URL("./canvas-performance-baseline.json", import.meta.url), "utf8"),
);
const durationMs = Number(process.env.PF_BENCHMARK_DURATION_MS ?? baseline.durationMs);
const server = spawn(
  process.execPath,
  [
    fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url)),
    "--host",
    "127.0.0.1",
    "--strictPort",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let serverOutput = "";
server.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
server.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });
let browser;

try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.exitCode !== null || server.signalCode !== null) {
      throw new Error(`Vite exited early:\n${serverOutput}`);
    }
    try {
      const response = await fetch(`${baseUrl}/scripts/canvas-benchmark.html`);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      await delay(500);
    }
  }
  if (!ready) throw new Error(`Vite did not become ready:\n${serverOutput}`);

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  await page.goto(`${baseUrl}/scripts/canvas-benchmark.html`, { waitUntil: "load" });
  const results = await page.evaluate(async (duration) => {
    if (typeof window.runCanvasBenchmarks !== "function") {
      throw new Error("Canvas benchmark harness did not initialize.");
    }
    return window.runCanvasBenchmarks(duration);
  }, durationMs);

  for (const result of results) {
    console.log(
      `${result.name}: ${result.fps.toFixed(1)} FPS, ` +
      `${result.frameTimeMs.toFixed(2)} ms/frame, ${result.nodeCount} nodes, ` +
      `${result.activePanelCount} active panels, ${result.repeaterRowCount} repeater rows`,
    );
  }
  const failed = results.filter((result) =>
    baseline.gatedScenarios.includes(result.name) &&
    result.fps < baseline.minimumFps,
  );
  if (failed.length > 0) {
    throw new Error(
      `Canvas FPS regression below ${baseline.minimumFps}: ` +
      failed.map((result) => result.name).join(", "),
    );
  }
} finally {
  await browser?.close();
  server.kill();
}
