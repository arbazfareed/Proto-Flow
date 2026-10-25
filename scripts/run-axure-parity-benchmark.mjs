import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const port = 1420;
const baseUrl = `http://127.0.0.1:${port}`;
const baseline = JSON.parse(
  await readFile(new URL("./axure-parity-performance-baseline.json", import.meta.url), "utf8"),
);
const modeDurationMs = Number(process.env.PF_BENCHMARK_MODE_MS ?? baseline.modeDurationMs);
const soakDurationMs = Number(process.env.PF_BENCHMARK_SOAK_MS ?? baseline.soakDurationMs);
const benchmarkTimeoutMs = Number(
  process.env.PF_BENCHMARK_TIMEOUT_MS ?? Math.max(60_000, soakDurationMs + 180_000),
);
const fpsRegressionFloor = baseline.referenceFps *
  (1 - baseline.regressionThresholdPercent / 100);
const previousReportUrl = new URL("../reports/axure-parity-latest.json", import.meta.url);
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

function formatMs(value) {
  return `${value.toFixed(2)} ms`;
}

function createReport(results) {
  const lines = [
    "# Axure-parity performance verification",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Browser: Chromium ${browser.version()}`,
    `Scene interaction duration: ${modeDurationMs} ms per mode`,
    `Memory soak duration: ${soakDurationMs} ms`,
    `FPS regression floor: ${fpsRegressionFloor.toFixed(1)} FPS (${baseline.regressionThresholdPercent}% below the ${baseline.referenceFps} FPS baseline)`,
    "",
    "Results are measurements from this run, not guarantees for other hardware. Each scene is exercised in idle, pan, zoom, and drag modes. Feature timings use the application’s existing panel, repeater, expression, and flow-layout helpers.",
    "",
    "| Scene | Widgets rendered / modeled | Idle FPS | Pan FPS | Zoom FPS | Drag FPS | P95 frame | P99 frame | Feature timing |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---|",
  ];
  for (const scene of results.scenes) {
    const featureTiming = [
      scene.panelSwitchMs === undefined ? null : `panel switch ${formatMs(scene.panelSwitchMs)}`,
      scene.repeaterRenderMs === undefined ? null : `repeater ${formatMs(scene.repeaterRenderMs)}`,
      scene.maxExpressionMs === undefined ? null : `max expression ${formatMs(scene.maxExpressionMs)}`,
      scene.flowLayoutMs === undefined ? null : `flow layout ${formatMs(scene.flowLayoutMs)}`,
    ].filter(Boolean).join("; ") || "—";
    lines.push(
      `| ${scene.name} | ${scene.widgetCount} / ${scene.totalFeatureWidgets} | ` +
      `${scene.modes.idle.fps.toFixed(1)} | ${scene.modes.pan.fps.toFixed(1)} | ` +
      `${scene.modes.zoom.fps.toFixed(1)} | ${scene.modes.drag.fps.toFixed(1)} | ` +
      `${formatMs(scene.frameTimeP95Ms)} | ${formatMs(scene.frameTimeP99Ms)} | ${featureTiming} |`,
    );
  }
  lines.push(
    "",
    "## Memory soak",
    "",
    `- Start: ${(results.soak.startBytes / 1_048_576).toFixed(2)} MiB`,
    `- Midpoint: ${(results.soak.midpointBytes / 1_048_576).toFixed(2)} MiB`,
    `- End: ${(results.soak.endBytes / 1_048_576).toFixed(2)} MiB`,
    `- Growth: ${(results.soak.growthBytes / 1_048_576).toFixed(2)} MiB`,
    "",
    "## Targets and implementation notes",
    "",
    "- Stress-scene FPS: at least 55 FPS in each interaction mode.",
    "- Dynamic-panel state switch: under 50 ms.",
    "- Virtualized repeater: under 200 ms to prepare visible rows from a 500-row dataset.",
    "- Expression evaluation: under 1 ms per expression.",
    "- Flow layout: under 500 ms for 100 screens and 300 transitions.",
    "- Five-minute heap growth: less than 30 MiB.",
    "- Repeater virtualization and compiled-expression/dependency caching already exist in the application; panel rendering selects active states only. Flow diagram nodes and edges are culled to the visible viewport.",
    "- CI retains this report as a run artifact; update the checked-in baseline file when deliberately changing the performance budget.",
    "",
    "## Scene definitions",
    "",
    "- A: 20 panels × 5 states × 10 widgets (1,020 total including panel containers).",
    "- B: one 500-row repeater × 5 widgets (2,500 modeled; viewport and overscan rows rendered).",
    "- C: 10 panel trees nested 3 levels deep with content.",
    "- D: 200 expression widgets using 20 variables.",
    "- E: 10 panels, five 500-row repeaters, 100 expression widgets, and 100 annotations.",
    "- F: 100 screens and 300 transitions.",
    "",
  );
  return `${lines.join("\n")}\n`;
}

try {
  console.log("Starting local Vite server.");
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.exitCode !== null || server.signalCode !== null) {
      throw new Error(`Vite exited early:\n${serverOutput}`);
    }
    try {
      const response = await fetch(`${baseUrl}/scripts/axure-parity-benchmark.html`);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      await delay(500);
    }
  }
  if (!ready) throw new Error(`Vite did not become ready:\n${serverOutput}`);

  console.log("Launching Chromium.");
  browser = await chromium.launch({
    headless: true,
    args: ["--enable-precise-memory-info", "--js-flags=--expose-gc"],
  });
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  page.on("console", (message) => console.log(`[browser] ${message.text()}`));
  await page.goto(`${baseUrl}/scripts/axure-parity-benchmark.html`, {
    waitUntil: "load",
    timeout: 30_000,
  });
  const benchmark = page.evaluate(async (options) => {
    if (typeof window.runAxureParityBenchmarks !== "function") {
      throw new Error("Axure-parity benchmark harness did not initialize.");
    }
    return window.runAxureParityBenchmarks(options);
  }, { modeDurationMs, soakDurationMs });
  let benchmarkTimeoutHandle;
  const benchmarkTimeout = new Promise((_, reject) => {
    benchmarkTimeoutHandle = setTimeout(
      () => reject(new Error(`Axure-parity benchmark exceeded its ${benchmarkTimeoutMs}ms timeout.`)),
      benchmarkTimeoutMs,
    );
  });
  let results;
  try {
    results = await Promise.race([benchmark, benchmarkTimeout]);
  } finally {
    clearTimeout(benchmarkTimeoutHandle);
  }

  const failures = [];
  for (const scene of results.scenes) {
    const fpsValues = Object.values(scene.modes).map((mode) => mode.fps);
    const details = [
      `FPS ${Math.min(...fpsValues).toFixed(1)}`,
      `P95 ${formatMs(scene.frameTimeP95Ms)}`,
      `P99 ${formatMs(scene.frameTimeP99Ms)}`,
    ].join(", ");
    console.log(`${scene.name}: ${details}`);
    const fpsFloor = Math.max(baseline.minimumFps, fpsRegressionFloor);
    if (Math.min(...fpsValues) < fpsFloor) {
      failures.push(`${scene.name} FPS below ${fpsFloor.toFixed(1)}`);
    }
    if (scene.panelSwitchMs !== undefined && scene.panelSwitchMs >= baseline.panelSwitchMaxMs) {
      failures.push(`${scene.name} panel switch exceeded ${baseline.panelSwitchMaxMs} ms`);
    }
    if (scene.repeaterRenderMs !== undefined && scene.repeaterRenderMs >= baseline.repeaterRenderMaxMs) {
      failures.push(`${scene.name} repeater render exceeded ${baseline.repeaterRenderMaxMs} ms`);
    }
    if (scene.maxExpressionMs !== undefined && scene.maxExpressionMs >= baseline.expressionMaxMs) {
      failures.push(`${scene.name} expression evaluation exceeded ${baseline.expressionMaxMs} ms`);
    }
    if (scene.flowLayoutMs !== undefined && scene.flowLayoutMs >= baseline.flowLayoutMaxMs) {
      failures.push(`${scene.name} flow layout exceeded ${baseline.flowLayoutMaxMs} ms`);
    }
  }
  const memoryGrowthMiB = results.soak.growthBytes / 1_048_576;
  console.log(`Soak heap growth: ${memoryGrowthMiB.toFixed(2)} MiB`);
  if (memoryGrowthMiB >= baseline.maximumHeapGrowthMiB) {
    failures.push(`Soak heap growth exceeded ${baseline.maximumHeapGrowthMiB} MiB`);
  }

  await mkdir(new URL("../reports", import.meta.url), { recursive: true });
  await writeFile(
    new URL("../reports/PERF-AXURE-PARITY.md", import.meta.url),
    createReport(results),
  );
  await writeFile(
    new URL("../reports/axure-parity-latest.json", import.meta.url),
    `${JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2)}\n`,
  );
  if (failures.length > 0) throw new Error(`Benchmark targets missed:\n- ${failures.join("\n- ")}`);
} finally {
  await browser?.close();
  server.kill();
}
