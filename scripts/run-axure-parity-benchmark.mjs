import { spawn } from "node:child_process";
import { gzipSync } from "node:zlib";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const port = 1420;
const baseUrl = `http://127.0.0.1:${port}`;
const previewPort = 1421;
const previewUrl = `http://127.0.0.1:${previewPort}`;
const baseline = JSON.parse(
  await readFile(new URL("../benchmarks/baseline.json", import.meta.url), "utf8"),
);
const modeDurationMs = Number(process.env.PF_BENCHMARK_MODE_MS ?? baseline.modeDurationMs);
const soakDurationMs = Number(process.env.PF_BENCHMARK_SOAK_MS ?? baseline.soakDurationMs);
const benchmarkTimeoutMs = Number(
  process.env.PF_BENCHMARK_TIMEOUT_MS ?? Math.max(60_000, soakDurationMs + 600_000),
);
const fpsRegressionFloor = baseline.referenceFps *
  (1 - baseline.regressionThresholdPercent / 100);
const distUrl = new URL("../dist/", import.meta.url);
const trendsUrl = new URL("../benchmarks/trends.json", import.meta.url);
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
const previewServer = spawn(
  process.execPath,
  [
    fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url)),
    "preview",
    "--host",
    "127.0.0.1",
    "--port",
    String(previewPort),
    "--strictPort",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let serverOutput = "";
server.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
server.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });
let previewOutput = "";
previewServer.stdout.on("data", (chunk) => { previewOutput += chunk.toString(); });
previewServer.stderr.on("data", (chunk) => { previewOutput += chunk.toString(); });
let browser;

function formatMs(value) {
  return `${value.toFixed(2)} ms`;
}

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const entryUrl = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    return entry.isDirectory() ? collectFiles(entryUrl) : [entryUrl];
  }));
  return files.flat();
}

async function measureBundle() {
  let files;
  try {
    files = await collectFiles(distUrl);
  } catch (error) {
    throw new Error("Production bundle is missing; run `npm run build -- --sourcemap` first.", {
      cause: error,
    });
  }
  const assets = await Promise.all(files.map(async (url) => {
    const contents = await readFile(url);
    const fileStat = await stat(url);
    return {
      name: url.pathname.split("/").at(-1),
      bytes: fileStat.size,
      javascriptGzipBytes: url.pathname.endsWith(".js") ? gzipSync(contents).byteLength : 0,
    };
  }));
  const shippedAssets = assets.filter((asset) => !asset.name.endsWith(".map"));
  return {
    totalBytes: shippedAssets.reduce((total, asset) => total + asset.bytes, 0),
    javascriptGzipBytes: assets.reduce((total, asset) => total + asset.javascriptGzipBytes, 0),
    assets: shippedAssets,
  };
}

async function measureAppStartup(page) {
  const loadApp = async () => {
    await page.goto(previewUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
    await page.waitForFunction(
      () => Boolean(document.querySelector("#root")?.firstElementChild),
      undefined,
      { timeout: 15_000 },
    );
  };
  const coldStart = performance.now();
  await loadApp();
  const coldMs = performance.now() - coldStart;
  const warmSamples = [];
  for (let index = 0; index < 3; index += 1) {
    const warmStart = performance.now();
    await loadApp();
    warmSamples.push(performance.now() - warmStart);
  }
  warmSamples.sort((left, right) => left - right);
  return { coldMs, warmMs: warmSamples[1] };
}

function createReport(results) {
  const lines = [
    "# PF-T705 performance benchmark",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Browser: Chromium ${browser.version()}`,
    `Scene interaction duration: ${modeDurationMs} ms per mode`,
    `Memory soak duration: ${soakDurationMs} ms`,
    `FPS regression floor: ${fpsRegressionFloor.toFixed(1)} FPS (${baseline.regressionThresholdPercent}% below the ${baseline.referenceFps} FPS baseline)`,
    "",
    "Results are measurements from this run, not guarantees for other hardware. Each scene is exercised in idle, pan, zoom, and drag modes. Feature timings use the application’s existing panel, repeater, expression, and flow-layout helpers.",
    "",
    "| Scene | Widgets rendered / modeled | Idle FPS | Pan FPS | Zoom FPS | Drag FPS | P95 frame | P95 pan / zoom operation | Feature timing |",
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
      `${formatMs(scene.frameTimeP95Ms)} | ` +
      `${formatMs(scene.modes.pan.operationP95Ms ?? 0)} / ${formatMs(scene.modes.zoom.operationP95Ms ?? 0)} | ` +
      `${featureTiming} |`,
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
    "- Medium and large scenes: at least 55 FPS; 1,000-widget stress scenes: at least 45 FPS.",
    "- Panel, repeater, expression, nested-panel, flow, and mixed scenes: at least 50 FPS.",
    "- Pan and zoom operation P95: under 16 ms.",
    "- Dynamic-panel state switch: under 50 ms.",
    "- Virtualized repeater: under 200 ms to prepare visible rows from a 500-row dataset.",
    "- Expression evaluation: under 1 ms per expression.",
    "- Flow layout: under 500 ms for 100 screens and 300 transitions.",
    "- Five-minute heap growth: less than 20 MiB.",
    `- Store timings: add 100 widgets ${formatMs(results.store.add100Ms)}, undo/redo 50 snapshots ${formatMs(results.store.undoRedo50Ms)}, select 500 IDs ${formatMs(results.store.selection500Ms)}.`,
    `- Startup: cold ${formatMs(results.startup.coldMs)}, warm median ${formatMs(results.startup.warmMs)}.`,
    `- Production bundle: ${(results.bundle.totalBytes / 1_048_576).toFixed(2)} MiB total, ${(results.bundle.javascriptGzipBytes / 1_048_576).toFixed(2)} MiB JavaScript gzip.`,
    "- Repeater virtualization and compiled-expression/dependency caching already exist in the application; panel rendering selects active states only. Flow diagram nodes and edges are culled to the visible viewport.",
    "- CI retains this report as a run artifact; update the checked-in baseline file when deliberately changing the performance budget.",
    "",
    "## Scene definitions",
    "",
    "- A/B/C: 20-widget medium, 500-widget large, and 1,000-widget stress canvas scenes.",
    "- D: 20 panels × 5 states × 10 widgets (1,020 total including panel containers).",
    "- E: one 500-row repeater × 5 widgets (2,500 modeled; viewport and overscan rows rendered).",
    "- F: 10 panel trees nested 3 levels deep with content.",
    "- G: 200 expression widgets using 20 variables.",
    "- H: 100 screens and 300 transitions.",
    "- I: 10 panels, five 500-row repeaters, 100 expression widgets, and 100 annotations.",
    "",
  );
  return `${lines.join("\n")}\n`;
}

try {
  const bundle = await measureBundle();
  let previewReady = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (previewServer.exitCode !== null || previewServer.signalCode !== null) {
      throw new Error(`Vite preview exited early:\n${previewOutput}`);
    }
    try {
      const response = await fetch(previewUrl);
      if (response.ok) {
        previewReady = true;
        break;
      }
    } catch {
      await delay(500);
    }
  }
  if (!previewReady) throw new Error(`Vite preview did not become ready:\n${previewOutput}`);
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
  const startup = await measureAppStartup(page);
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
  results.startup = startup;
  results.bundle = bundle;

  const failures = [];
  const warnings = [];
  for (const scene of results.scenes) {
    const fpsValues = Object.values(scene.modes).map((mode) => mode.fps);
    const details = [
      `FPS ${Math.min(...fpsValues).toFixed(1)}`,
      `P95 ${formatMs(scene.frameTimeP95Ms)}`,
      `P99 ${formatMs(scene.frameTimeP99Ms)}`,
    ].join(", ");
    console.log(`${scene.name}: ${details}`);
    const fpsFloor = Math.max(
      baseline.fpsThresholds[scene.name] ?? baseline.minimumFps,
      fpsRegressionFloor,
    );
    if (Math.min(...fpsValues) < fpsFloor) {
      failures.push(`${scene.name} FPS below ${fpsFloor.toFixed(1)}`);
    }
    for (const mode of ["pan", "zoom"]) {
      if (scene.modes[mode].operationP95Ms >= baseline.panZoomP95MaxMs) {
        failures.push(
          `${scene.name} ${mode} P95 operation exceeded ${baseline.panZoomP95MaxMs} ms`,
        );
      }
    }
    const featureLimit = (reference, absolute) =>
      Math.min(absolute, reference * (1 + baseline.featureRegressionThresholdPercent / 100));
    if (scene.panelSwitchMs !== undefined && scene.panelSwitchMs >= featureLimit(
      baseline.featureReferencesMs.panelSwitch,
      baseline.panelSwitchMaxMs,
    )) {
      failures.push(`${scene.name} panel switch regressed beyond its 20% baseline threshold`);
    }
    if (scene.repeaterRenderMs !== undefined && scene.repeaterRenderMs >= featureLimit(
      baseline.featureReferencesMs.repeaterRender,
      baseline.repeaterRenderMaxMs,
    )) {
      failures.push(`${scene.name} repeater render regressed beyond its 20% baseline threshold`);
    }
    if (scene.maxExpressionMs !== undefined && scene.maxExpressionMs >= featureLimit(
      baseline.featureReferencesMs.expression,
      baseline.expressionMaxMs,
    )) {
      failures.push(`${scene.name} expression evaluation regressed beyond its 20% baseline threshold`);
    }
    if (scene.flowLayoutMs !== undefined && scene.flowLayoutMs >= featureLimit(
      baseline.featureReferencesMs.flowLayout,
      baseline.flowLayoutMaxMs,
    )) {
      failures.push(`${scene.name} flow layout regressed beyond its 20% baseline threshold`);
    }
  }
  const memoryGrowthMiB = Math.max(0, results.soak.growthBytes / 1_048_576);
  console.log(`Soak heap growth: ${memoryGrowthMiB.toFixed(2)} MiB`);
  if (memoryGrowthMiB >= baseline.maximumHeapGrowthMiB) {
    failures.push(`Soak heap growth exceeded ${baseline.maximumHeapGrowthMiB} MiB`);
  }
  const storeLimits = [
    ["add 100 widgets", results.store.add100Ms, baseline.storeAdd100MaxMs],
    ["undo/redo 50 snapshots", results.store.undoRedo50Ms, baseline.storeUndoRedo50MaxMs],
    ["select 500 widgets", results.store.selection500Ms, baseline.storeSelection500MaxMs],
  ];
  for (const [label, value, limit] of storeLimits) {
    if (value >= limit) failures.push(`Store ${label} exceeded ${limit} ms`);
  }
  if (startup.coldMs >= baseline.startupColdMaxMs) {
    failures.push(`Cold app startup exceeded ${baseline.startupColdMaxMs} ms`);
  }
  if (startup.warmMs >= baseline.startupWarmMaxMs) {
    failures.push(`Warm app startup exceeded ${baseline.startupWarmMaxMs} ms`);
  }
  if (startup.coldMs >= baseline.startupColdReferenceMs * 1.2) {
    failures.push("Cold app startup regressed more than 20% from the reference");
  }
  if (startup.warmMs >= baseline.startupWarmReferenceMs * 1.2) {
    failures.push("Warm app startup regressed more than 20% from the reference");
  }
  if (bundle.totalBytes >= baseline.bundleTotalMaxBytes) {
    failures.push(`Production bundle exceeded ${baseline.bundleTotalMaxBytes} bytes`);
  }
  if (bundle.javascriptGzipBytes >= baseline.bundleJavascriptGzipMaxBytes) {
    failures.push(`Gzipped JavaScript exceeded ${baseline.bundleJavascriptGzipMaxBytes} bytes`);
  }
  const totalBundleGrowthPercent =
    (bundle.totalBytes / baseline.bundleBaselineTotalBytes - 1) * 100;
  const javascriptGrowthPercent =
    (bundle.javascriptGzipBytes / baseline.bundleBaselineJavascriptGzipBytes - 1) * 100;
  for (const [label, growthPercent] of [
    ["total bundle", totalBundleGrowthPercent],
    ["gzipped JavaScript", javascriptGrowthPercent],
  ]) {
    if (growthPercent > baseline.regressionThresholdPercent) {
      failures.push(`${label} grew ${growthPercent.toFixed(1)}% (limit ${baseline.regressionThresholdPercent}%)`);
    } else if (growthPercent > baseline.bundleWarningThresholdPercent) {
      warnings.push(`${label} grew ${growthPercent.toFixed(1)}%`);
    }
  }
  if (memoryGrowthMiB >= baseline.heapGrowthReferenceMiB * 1.5) {
    failures.push(
      `Heap growth regressed 50% above the ${baseline.heapGrowthReferenceMiB} MiB reference`,
    );
  }

  await mkdir(new URL("../reports", import.meta.url), { recursive: true });
  const generatedAt = new Date().toISOString();
  const run = {
    generatedAt,
    browser: `Chromium ${browser.version()}`,
    results,
    failures,
    warnings,
  };
  const trendHistory = JSON.parse(await readFile(trendsUrl, "utf8"));
  trendHistory.runs.push({
    generatedAt,
    sceneFps: Object.fromEntries(results.scenes.map((scene) => [scene.name, scene.fps])),
    bundleTotalBytes: bundle.totalBytes,
    javascriptGzipBytes: bundle.javascriptGzipBytes,
    heapGrowthMiB: memoryGrowthMiB,
    startupColdMs: startup.coldMs,
    startupWarmMs: startup.warmMs,
    failures,
    warnings,
  });
  trendHistory.runs = trendHistory.runs.slice(-100);
  await writeFile(trendsUrl, `${JSON.stringify(trendHistory, null, 2)}\n`);
  await writeFile(
    new URL("../reports/PERF-AXURE-PARITY.md", import.meta.url),
    `${createReport(results)}\n## CI gate result\n\n${failures.length ? `Failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}` : "All regression gates passed."}\n${warnings.length ? `\nWarnings:\n${warnings.map((warning) => `- ${warning}`).join("\n")}\n` : ""}`,
  );
  await writeFile(
    new URL("../reports/axure-parity-latest.json", import.meta.url),
    `${JSON.stringify(run, null, 2)}\n`,
  );
  for (const warning of warnings) console.warn(`Benchmark warning: ${warning}`);
  if (failures.length > 0) throw new Error(`Benchmark targets missed:\n- ${failures.join("\n- ")}`);
} finally {
  await browser?.close();
  server.kill();
  previewServer.kill();
}
