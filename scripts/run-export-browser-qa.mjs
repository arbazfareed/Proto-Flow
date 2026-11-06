import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium, firefox, webkit } from "playwright";
import JSZip from "jszip";
import { PNG } from "pngjs";

const appUrl = "http://127.0.0.1:1422";
const fullRun = process.env.PF_EXPORT_FULL === "1" || process.argv.includes("--full");
const root = new URL("../", import.meta.url);
const reportDirectory = new URL("../reports/cross-browser-qa/", import.meta.url);
const screenshotDirectory = new URL("screenshots/", reportDirectory);
const baselineDirectory = new URL("baselines/", reportDirectory);
const updateBaselines = process.argv.includes("--update-baselines");
const vite = spawn(
  process.execPath,
  [fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url)), "--host", "127.0.0.1", "--port", "1422", "--strictPort"],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let viteOutput = "";
vite.stdout.on("data", (chunk) => { viteOutput += chunk.toString(); });
vite.stderr.on("data", (chunk) => { viteOutput += chunk.toString(); });
let exportServer;
const browsers = [];
const results = [];
let axeSource;
let files;

function fixtureSource() {
  return `return (async () => {
    const { createEmptyProject } = await import("/src/project/schema.ts");
    const { createDefaultBreakpoints } = await import("/src/project/responsive.ts");
    const { generateSingleFileJsx } = await import("/src/preview/codeExport.ts");
    const { generateLocalHtmlArchive } = await import("/src/preview/htmlExport.ts");
    const { generatePublishedPreviewHtml } = await import("/src/preview/publishBundle.ts");
    const project = createEmptyProject("Cross-browser export QA");
    const screen = project.screens[0];
    screen.device = {
      presetId: "desktop-1440-900", width: 1440, height: 900, dpr: 1,
      orientation: "landscape", insets: { top: 0, right: 0, bottom: 0, left: 0 },
    };
    screen.breakpoints = createDefaultBreakpoints(1440, 900);
    const richText = {
      id: crypto.randomUUID(), type: "text", name: "Summary",
      x: 120, y: 80, width: 260, height: 48, rotation: 0, opacity: 1,
      visible: true, locked: false, zIndex: 1, style: {},
      props: {
        richText: true,
        text: "{{caption}} [[score + 1]]",
        richTextRuns: [
          { text: "{{caption}} ", marks: { bold: true } },
          { text: "[[score + 1]]", marks: { italic: true } },
        ],
      },
      overrides: { mobile: { x: 12, width: 200 } },
      cascadeMode: "fluid",
    };
    const button = {
      id: crypto.randomUUID(), type: "button", name: "Advance workflow",
      x: 40, y: 150, width: 160, height: 48, rotation: 0, opacity: 1,
      visible: true, locked: false, zIndex: 2, style: {},
      props: { label: "Advance workflow" },
    };
    const repeater = {
      id: crypto.randomUUID(), type: "repeater", name: "People",
      x: 40, y: 240, width: 240, height: 40, rotation: 0, opacity: 1,
      visible: true, locked: false, zIndex: 3, style: {},
      props: {
        dataset: [{ name: "Ada" }],
        layout: "vertical",
        gap: 8,
        rowTemplate: { widgets: [{
          id: crypto.randomUUID(), type: "text", name: "Person name",
          x: 0, y: 0, width: 220, height: 32, rotation: 0, opacity: 1,
          visible: true, locked: false, zIndex: 1, style: {},
          props: { text: "{{item.name}}" },
        }] },
      },
    };
    const panelId = crypto.randomUUID();
    const closedStateId = crypto.randomUUID();
    const openStateId = crypto.randomUUID();
    const panel = {
      id: panelId, type: "dynamic-panel", name: "Status panel",
      x: 250, y: 150, width: 120, height: 48, rotation: 0, opacity: 1,
      visible: true, locked: false, zIndex: 4, style: {},
      props: {
        activeStateId: closedStateId,
        states: [
          { id: closedStateId, name: "Closed", widgets: [{
            id: crypto.randomUUID(), type: "text", name: "Panel closed",
            x: 250, y: 150, width: 110, height: 40, rotation: 0, opacity: 1,
            visible: true, locked: false, zIndex: 1, style: {}, groupId: panelId,
            props: { text: "Panel closed" },
          }] },
          { id: openStateId, name: "Open", widgets: [{
            id: crypto.randomUUID(), type: "text", name: "Panel open",
            x: 250, y: 150, width: 110, height: 40, rotation: 0, opacity: 1,
            visible: true, locked: false, zIndex: 1, style: {}, groupId: panelId,
            props: { text: "Panel open" },
          }] },
        ],
      },
    };
    screen.widgets.push(richText, button, repeater, panel);
    project.variables.push(
      { id: crypto.randomUUID(), name: "caption", type: "string", initial: "Shared state", scope: "project" },
      { id: crypto.randomUUID(), name: "score", type: "number", initial: 2, scope: "project" },
    );
    const advanceRule = {
      id: crypto.randomUUID(), widgetId: button.id, event: "onClick", conditions: [],
      actions: [
        { type: "setVariable", target: "score", value: "[[score + 3]]" },
        { type: "setPanelState", target: panel.id, value: openStateId, transition: "slide-left", duration: 120 },
        { type: "setRepeaterData", target: repeater.id, value: '[{"name":"Grace"}]' },
      ],
    };
    screen.interactionRules.push(
      advanceRule,
      { ...advanceRule, id: crypto.randomUUID(), event: "onTap" },
    );
    const responsive = await generateLocalHtmlArchive(project, {
      includeInteractions: true, includeAssets: true, mode: "responsive",
    });
    const variants = await generateLocalHtmlArchive(project, {
      includeInteractions: true, includeAssets: true, mode: "device-variants",
    });
    return {
      responsive: Array.from(responsive),
      variants: Array.from(variants),
      published: generatePublishedPreviewHtml(project),
      react: generateSingleFileJsx(project),
      ids: { panel: panel.id, openState: openStateId },
    };
  })();`;
}

async function waitForVite() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (vite.exitCode !== null || vite.signalCode !== null) {
      throw new Error(`Vite exited early:\n${viteOutput}`);
    }
    try {
      if ((await fetch(`${appUrl}/?preview`)).ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`Vite did not become ready:\n${viteOutput}`);
}

async function createExportFiles() {
  const browser = await chromium.launch({ headless: true });
  browsers.push(browser);
  const page = await browser.newPage();
  await page.goto(`${appUrl}/?preview`, { waitUntil: "domcontentloaded" });
  const generated = await page.evaluate(async (source) => await new Function(source)(), fixtureSource());
  await page.close();

  const responsive = await JSZip.loadAsync(Uint8Array.from(generated.responsive));
  const variants = await JSZip.loadAsync(Uint8Array.from(generated.variants));
  const output = {
    "responsive/index.html": await responsive.file("index.html").async("text"),
    "responsive/style.css": await responsive.file("style.css").async("text"),
    "responsive/runtime.js": await responsive.file("runtime.js").async("text"),
    "responsive/FONT-LICENSE.txt": await responsive.file("FONT-LICENSE.txt").async("text"),
    "published/index.html": generated.published,
    ids: generated.ids,
  };
  output["variants/style.css"] = output["responsive/style.css"];
  output["variants/runtime.js"] = output["responsive/runtime.js"];
  output["variants/FONT-LICENSE.txt"] = output["responsive/FONT-LICENSE.txt"];
  for (const filename of ["index-desktop.html", "index-tablet.html", "index-mobile.html"]) {
    output[`variants/${filename}`] = await variants.file(filename).async("text");
  }

  const reactBundle = await build({
    absWorkingDir: fileURLToPath(root),
    stdin: {
      contents: `${generated.react}\nimport { createRoot } from "react-dom/client";\ncreateRoot(document.getElementById("root")).render(<App />);`,
      resolveDir: fileURLToPath(root),
      sourcefile: "cross-browser-export.tsx",
      loader: "tsx",
    },
    bundle: true,
    format: "iife",
    jsx: "automatic",
    target: "es2022",
    write: false,
  });
  output["react/index.html"] = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>React export QA</title></head>
<body><div id="root"></div><script src="./bundle.js"></script></body></html>`;
  output["react/bundle.js"] = reactBundle.outputFiles[0].text;
  return output;
}

async function startExportServer() {
  exportServer = createServer((request, response) => {
    const pathname = new URL(request.url, "http://localhost").pathname.slice(1);
    const content = files[pathname];
    if (typeof content !== "string") {
      response.writeHead(404).end();
      return;
    }
    const contentType = pathname.endsWith(".css")
      ? "text/css"
      : pathname.endsWith(".js")
        ? "text/javascript"
        : "text/html";
    response.writeHead(200, {
      "content-type": `${contentType}; charset=utf-8`,
      "cache-control": "no-store",
    });
    response.end(content);
  });
  await new Promise((resolve) => exportServer.listen(0, "127.0.0.1", resolve));
  const address = exportServer.address();
  return `http://127.0.0.1:${address.port}`;
}

async function auditWithAxe(page, label) {
  await page.addScriptTag({ content: axeSource });
  const violations = await page.evaluate(async () => {
    const report = await window.axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
    });
    return report.violations.map(({ id, impact, description, nodes }) => ({
      id,
      impact,
      description,
      nodes: nodes.map((node) => ({ target: node.target, summary: node.failureSummary })),
    }));
  });
  assert.deepEqual(violations, [], `${label} axe-core WCAG 2.1 AA violations`);
}

async function assertLoadTime(page, label) {
  const loadTime = await page.evaluate(() => {
    const navigation = performance.getEntriesByType("navigation")[0];
    return navigation ? navigation.loadEventEnd - navigation.startTime : Number.POSITIVE_INFINITY;
  });
  assert.ok(loadTime > 0 && loadTime < 2_000, `${label} load was ${loadTime.toFixed(1)} ms (limit 2,000 ms)`);
  return Math.round(loadTime);
}

async function activateAdvanceButton(page, mobile) {
  const button = page.getByRole("button", { name: "Advance workflow" });
  if (mobile) await button.tap({ force: true });
  else await button.click();
}

async function compareScreenshot(page, label) {
  const screenshot = await page.screenshot({
    path: fileURLToPath(new URL(`${label}.png`, screenshotDirectory)),
    fullPage: true,
    animations: "disabled",
  });
  const baselineUrl = new URL(`${label}.png`, baselineDirectory);
  let baselineBytes;
  try {
    baselineBytes = await readFile(baselineUrl);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    if (process.env.CI && !updateBaselines) {
      throw new Error(`Missing screenshot baseline ${baselineUrl.pathname}; generate and review it locally.`);
    }
    await writeFile(baselineUrl, screenshot);
    return { initialized: true, changedPixelRatio: 0 };
  }
  if (updateBaselines) {
    await writeFile(baselineUrl, screenshot);
    return { initialized: true, changedPixelRatio: 0 };
  }
  const actualImage = PNG.sync.read(screenshot);
  const baselineImage = PNG.sync.read(baselineBytes);
  assert.equal(actualImage.width, baselineImage.width, `${label} screenshot width`);
  assert.equal(actualImage.height, baselineImage.height, `${label} screenshot height`);
  let changedPixels = 0;
  for (let offset = 0; offset < actualImage.data.length; offset += 4) {
    if (
      Math.abs(actualImage.data[offset] - baselineImage.data[offset]) > 12 ||
      Math.abs(actualImage.data[offset + 1] - baselineImage.data[offset + 1]) > 12 ||
      Math.abs(actualImage.data[offset + 2] - baselineImage.data[offset + 2]) > 12 ||
      Math.abs(actualImage.data[offset + 3] - baselineImage.data[offset + 3]) > 12
    ) changedPixels += 1;
  }
  const changedPixelRatio = changedPixels / (actualImage.width * actualImage.height);
  assert.ok(changedPixelRatio <= 0.01, `${label} screenshot changed ${(changedPixelRatio * 100).toFixed(2)}% of pixels`);
  return { initialized: false, changedPixelRatio: Number(changedPixelRatio.toFixed(5)) };
}

async function exerciseHtmlPage(page, url, label, responsive, ids, mobile) {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(url, { waitUntil: "load" });
  await page.locator("#stage[data-screen-id]").waitFor({ state: "attached" });
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.evaluate(() => document.fonts.check("16px Inter")), true, `${label} loads Inter`);
  const loadMilliseconds = await assertLoadTime(page, label);
  await page.getByText("Shared state", { exact: false }).first().waitFor({ timeout: 5_000 }).catch(async (error) => {
    throw new Error(`${label} did not render fixture text: ${error.message}; stage=${await page.locator("#stage").innerText()}; pageErrors=${pageErrors.join(" | ")}`);
  });
  assert.equal(await page.locator("#stage strong").first().textContent(), "Shared state ");
  assert.equal(await page.locator("#stage em").first().textContent(), "3");
  await page.getByText("Ada", { exact: true }).waitFor();
  await activateAdvanceButton(page, mobile);
  await page.locator(`[data-widget-id="${ids.panel}"]`).waitFor();
  await page.waitForFunction(
    ({ panelId, stateId }) => document.querySelector(`[data-widget-id="${panelId}"]`)?.getAttribute("data-panel-state") === stateId,
    ids,
  );
  await page.getByText("Panel open", { exact: false }).waitFor();
  await page.getByText("Grace", { exact: true }).waitFor();
  await page.locator("#stage em").first().getByText("6").waitFor();

  if (responsive) {
    const breakpoints = [
      [320, 390, 200],
      [390, 390, 200],
      [768, 768, 139],
      [1024, 1440, 260],
      [1920, 1440, 260],
      [3840, 1440, 260],
    ];
    for (const [width, stageWidth, widgetWidth] of breakpoints) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(20);
      const actual = await page.locator("#stage").evaluate((stage) => ({
        width: Number.parseFloat(getComputedStyle(stage).width),
        widget: Number.parseFloat(getComputedStyle(stage.querySelector("[data-widget-id]")).width),
      }));
      assert.equal(actual.width, stageWidth, `${label} stage at ${width}px`);
      assert.ok(Math.abs(actual.widget - widgetWidth) <= 1, `${label} widget at ${width}px was ${actual.widget}px`);
    }
  }

  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  const animationName = await page.locator(`[data-widget-id="${ids.panel}"]`).evaluate((panel) =>
    getComputedStyle(panel).animationName,
  );
  assert.equal(animationName, "none", `${label} disables panel motion when requested`);
  await auditWithAxe(page, label);
  await page.setViewportSize(responsive ? { width: 1440, height: 900 } : { width: 390, height: 844 });
  const visual = await compareScreenshot(page, label);
  assert.deepEqual(pageErrors, [], `${label} runtime errors`);
  return { loadMilliseconds, visual };
}

async function exerciseReactPage(page, url, label, mobile) {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(url, { waitUntil: "load" });
  await page.getByRole("button", { name: "Advance workflow" }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.evaluate(() => document.fonts.check("16px Inter")), true, `${label} loads Inter`);
  const loadMilliseconds = await assertLoadTime(page, label);
  await page.locator("strong").filter({ hasText: "Shared state" }).waitFor();
  await page.locator("em").filter({ hasText: "3" }).waitFor();
  await page.getByText("Ada", { exact: true }).waitFor();
  await activateAdvanceButton(page, mobile);
  await page.locator("em").filter({ hasText: "6" }).waitFor();
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await auditWithAxe(page, label);
  await page.setViewportSize({ width: 1440, height: 900 });
  const visual = await compareScreenshot(page, label);
  assert.deepEqual(pageErrors, [], `${label} runtime errors`);
  return { loadMilliseconds, visual };
}

async function runBrowserTarget(name, engine, exportBaseUrl, mobile = false, channel) {
  const browser = await engine.launch({ headless: true, ...(channel ? { channel } : {}) });
  browsers.push(browser);
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
  });
  try {
    const page = await context.newPage();
    const prefix = mobile ? `${name}-mobile` : name;
    const responsive = await exerciseHtmlPage(
      page,
      `${exportBaseUrl}/responsive/index.html`,
      `${prefix}-responsive`,
      !mobile,
      files.ids,
      mobile,
    );
    results.push({
      browser: prefix,
      surface: "responsive-html",
      status: "passed",
      loadMilliseconds: responsive.loadMilliseconds,
      visual: responsive.visual,
    });

    for (const [variant, filename] of [
      ["desktop", "index-desktop.html"],
      ["tablet", "index-tablet.html"],
      ["mobile", "index-mobile.html"],
    ]) {
      await page.goto(`${exportBaseUrl}/variants/${filename}`, { waitUntil: "load" });
      await page.locator("#stage[data-screen-id]").waitFor({ state: "attached" });
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.evaluate(() => document.fonts.check("16px Inter")), true, `${prefix}-${variant} loads Inter`);
      const variantLoad = await assertLoadTime(page, `${prefix}-${variant}`);
      await auditWithAxe(page, `${prefix}-${variant}`);
      await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
      await activateAdvanceButton(page, mobile);
      await page.getByText("Panel open", { exact: false }).waitFor();
      const animationName = await page.locator(`[data-widget-id="${files.ids.panel}"]`).evaluate((panel) =>
        getComputedStyle(panel).animationName,
      );
      assert.equal(animationName, "none", `${prefix}-${variant} disables panel motion when requested`);
      await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
      const visual = await compareScreenshot(page, `${prefix}-device-${variant}`);
      results.push({
        browser: prefix,
        surface: `device-${variant}-html`,
        status: "passed",
        loadMilliseconds: variantLoad,
        visual,
      });
    }

    await page.goto(`${exportBaseUrl}/published/index.html`, { waitUntil: "load" });
    await page.locator("#stage[data-screen-id]").waitFor({ state: "attached" });
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.evaluate(() => document.fonts.check("16px Inter")), true, `${prefix}-published loads Inter`);
    const publishedLoad = await assertLoadTime(page, `${prefix}-published`);
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await activateAdvanceButton(page, mobile);
    await page.getByText("Panel open", { exact: false }).waitFor();
    await page.getByText("Grace", { exact: true }).waitFor();
    const publishedAnimationName = await page.locator(`[data-widget-id="${files.ids.panel}"]`).evaluate((panel) =>
      getComputedStyle(panel).animationName,
    );
    assert.equal(publishedAnimationName, "none", `${prefix}-published disables panel motion when requested`);
    await auditWithAxe(page, `${prefix}-published`);
    const publishedVisual = await compareScreenshot(page, `${prefix}-published`);
    results.push({
      browser: prefix,
      surface: "published-preview",
      status: "passed",
      loadMilliseconds: publishedLoad,
      visual: publishedVisual,
    });

    const react = await exerciseReactPage(
      page,
      `${exportBaseUrl}/react/index.html`,
      `${prefix}-react`,
      mobile,
    );
    results.push({
      browser: prefix,
      surface: "react-export",
      status: "passed",
      loadMilliseconds: react.loadMilliseconds,
      visual: react.visual,
    });
  } catch (error) {
    results.push({
      browser: mobile ? `${name}-mobile` : name,
      surface: "export-matrix",
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    await context.close();
  }
}

function compatibilityMarkdown() {
  const grouped = new Map();
  for (const result of results) {
    const key = `${result.browser}|${result.surface}`;
    grouped.set(key, result);
  }
  const rows = [...grouped.values()].map((result) =>
    `| ${result.browser} | ${result.surface} | ${result.status} | ${result.loadMilliseconds ?? "—"} |`,
  );
  return [
    "# Cross-browser export QA compatibility matrix",
    "",
    `Generated ${new Date().toISOString()} by \`npm run qa:exports${fullRun ? ":full" : ""}\`.`,
    "",
    "Playwright runs browser engines on the local Windows/CI runner. Mobile Safari and Chrome Android use WebKit/Chromium device emulation; they are not physical-device certification. Chrome and Edge rows use their branded Playwright channels in the full matrix.",
    "",
    "| Browser target | Surface | Result | Load (ms) |",
    "|---|---|---:|---:|",
    ...rows,
    "",
    `Screenshots are compared with the checked-in per-browser baselines in \`reports/cross-browser-qa/baselines/\`; updated screenshots and the compatibility matrix are uploaded as CI artifacts. Performance gate: each measured HTML/React export page must load in under 2,000 ms.`,
    "",
  ].join("\n");
}

try {
  await mkdir(screenshotDirectory, { recursive: true });
  await mkdir(baselineDirectory, { recursive: true });
  axeSource = await readFile(new URL("../node_modules/axe-core/axe.min.js", import.meta.url), "utf8");
  await waitForVite();
  files = await createExportFiles();
  const exportedFontLicense = files["responsive/FONT-LICENSE.txt"];
  assert.match(exportedFontLicense, /SIL OPEN FONT LICENSE Version 1\.1/);
  const exportBaseUrl = await startExportServer();

  await runBrowserTarget("chromium", chromium, exportBaseUrl);
  if (fullRun) {
    await runBrowserTarget("firefox", firefox, exportBaseUrl);
    await runBrowserTarget("webkit", webkit, exportBaseUrl);
    await runBrowserTarget("chrome", chromium, exportBaseUrl, false, "chrome");
    await runBrowserTarget("edge", chromium, exportBaseUrl, false, "msedge");
    await runBrowserTarget("chromium", chromium, exportBaseUrl, true);
    await runBrowserTarget("webkit", webkit, exportBaseUrl, true);
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await mkdir(reportDirectory, { recursive: true });
  await writeFile(new URL("compatibility-matrix.json", reportDirectory), JSON.stringify({
    generatedAt: new Date().toISOString(),
    mode: fullRun ? "full" : "smoke",
    results,
  }, null, 2));
  await writeFile(new URL("compatibility-matrix.md", reportDirectory), compatibilityMarkdown());
  for (const browser of browsers) await browser.close();
  if (exportServer) await new Promise((resolve) => exportServer.close(resolve));
  vite.kill();
}

if (process.exitCode !== 1) {
  const failures = results.filter((result) => result.status !== "passed");
  if (failures.length > 0) {
    console.error(`${failures.length} cross-browser checks failed.`);
    process.exitCode = 1;
  }
}
