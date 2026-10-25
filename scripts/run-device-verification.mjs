import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium, firefox, webkit } from "playwright";
import JSZip from "jszip";

const baseUrl = "http://127.0.0.1:1421";
const fullRun = process.env.PF_DEVICE_FULL === "1";
const server = spawn(
  process.execPath,
  [fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url)), "--host", "127.0.0.1", "--port", "1421", "--strictPort"],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let serverOutput = "";
server.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
server.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });
let browser;
let exportServer;

function deviceProjectSource(inputMode = "both") {
  return `
    return (async () => {
    const { createEmptyProject } = await import("/src/project/schema.ts");
    const { createDefaultBreakpoints } = await import("/src/project/responsive.ts");
    const project = createEmptyProject("PF-T512 verification");
    const screen = project.screens[0];
    screen.inputMode = "${inputMode}";
    screen.breakpoints = createDefaultBreakpoints(1440, 900);
    screen.device = {
      presetId: "desktop-1440-900", width: 1440, height: 900, dpr: 1,
      orientation: "landscape", insets: { top: 0, right: 0, bottom: 0, left: 0 },
    };
    const textWidget = {
      id: crypto.randomUUID(), type: "text", name: "Shared label",
      x: 120, y: 80, width: 260, height: 48, rotation: 0, opacity: 1,
      visible: true, locked: false, zIndex: 1, style: {},
      props: { text: "{{caption}}", fontSize: 20 },
      overrides: { mobile: { x: 12, width: 200 } },
      cascadeMode: "fluid",
    };
    const button = {
      id: crypto.randomUUID(), type: "button", name: "Interaction probe",
      x: 120, y: 150, width: 220, height: 48, rotation: 0, opacity: 1,
      visible: true, locked: false, zIndex: 2, style: {},
      props: { label: "Interaction probe" },
    };
    screen.widgets.push(textWidget, button);
    project.variables.push({
      id: crypto.randomUUID(), name: "caption", type: "string",
      initial: "Shared state", scope: "project",
    }, {
      id: crypto.randomUUID(), name: "mouseSeen", type: "boolean",
      initial: false, scope: "project",
    }, {
      id: crypto.randomUUID(), name: "touchSeen", type: "boolean",
      initial: false, scope: "project",
    });
    screen.interactionRules.push({
      id: crypto.randomUUID(), widgetId: button.id, event: "onClick", conditions: [],
      actions: [{ type: "setVariable", target: "mouseSeen", value: true }],
    }, {
      id: crypto.randomUUID(), widgetId: button.id, event: "onTap", conditions: [],
      actions: [{ type: "setVariable", target: "touchSeen", value: true }],
    });
    return project;
    })();
  `;
}

async function deliverProject(page, inputMode = "both") {
  await page.evaluate(async (source) => {
    const project = await new Function(source)();
    const channel = new BroadcastChannel("protoflow-preview");
    channel.postMessage({ type: "project", project });
    channel.close();
  }, deviceProjectSource(inputMode));
  await page.locator(".preview-frame-card").first().waitFor({ state: "visible", timeout: 20_000 });
}

async function updatePreviewInputMode(page, inputMode) {
  await deliverProject(page, inputMode);
  await page.waitForFunction(
    (mode) => document.querySelector(".preview-screen")?.getAttribute("data-input-mode") === mode,
    inputMode,
  );
}

async function verifyInputModes(page) {
  const probe = page.getByRole("button", { name: "Interaction probe" }).first();
  const variablesToggle = page.getByRole("button", { name: "Toggle variables" });
  const variable = (name) => page.locator(".preview-variable-inspector label")
    .filter({ hasText: name }).locator("input");
  if (!(await page.locator(".preview-variable-inspector").count())) await variablesToggle.click();

  await updatePreviewInputMode(page, "both");
  await probe.click();
  assert.equal(await variable("mouseSeen").isChecked(), true);
  await variable("mouseSeen").setChecked(false);
  await probe.tap();
  assert.equal(await variable("touchSeen").isChecked(), true);
  assert.equal(await variable("mouseSeen").isChecked(), true);

  await updatePreviewInputMode(page, "touch");
  await variable("mouseSeen").setChecked(false);
  await probe.click();
  assert.equal(await variable("mouseSeen").isChecked(), false);
  await probe.tap();
  assert.equal(await variable("touchSeen").isChecked(), true);

  await updatePreviewInputMode(page, "mouse");
  await variable("touchSeen").setChecked(false);
  await probe.tap();
  assert.equal(await variable("touchSeen").isChecked(), false);
  await probe.click();
  assert.equal(await variable("mouseSeen").isChecked(), true);
}

async function verifyPreview(page) {
  const layout = page.getByLabel("Preview layout");
  await layout.selectOption("single");
  assert.equal(await page.locator(".preview-frame-card").count(), 1);
  await layout.selectOption("columns");
  assert.equal(await page.locator(".preview-frame-card").count(), 3);
  await layout.selectOption("grid");
  assert.equal(await page.locator(".preview-frame-card").count(), 4);

  await page.getByRole("button", { name: "Toggle variables" }).click();
  const variable = page.locator(".preview-variable-inspector input").first();
  await variable.fill("Updated shared value");
  await page.locator(".preview-widget").first().getByText("Updated shared value").waitFor();
  const visibleTexts = await page.locator(".preview-widget").allTextContents();
  assert.equal(visibleTexts.filter((text) => text.includes("Updated shared value")).length, 4);

  await page.getByRole("button", { name: "Rotate devices" }).click();
  assert.equal(await page.getByRole("button", { name: "Rotate devices" }).getAttribute("aria-pressed"), "true");
  assert.match(await page.locator(".preview-frame-heading span").first().textContent(), /900 × 1440/);

  await page.getByRole("button", { name: "Capture preview screenshot" }).click();
  await page.getByText("Preview screenshot saved as a 2× PNG.").waitFor({ timeout: 15_000 });
}

async function verifyDeviceFrames(page, dpr, screenshotPath) {
  await page.goto(`${baseUrl}/scripts/device-frame-fixture.html`, { waitUntil: "load" });
  const picker = page.getByLabel("Device preset");
  await page.locator("#frame-stage canvas").first().waitFor({ state: "attached", timeout: 5_000 }).catch(async () => {
    throw new Error(`Device frame fixture did not render: ${await page.locator("body").innerText()}\n${serverOutput}`);
  });
  const presetIds = fullRun
    ? await picker.locator("option").evaluateAll((options) => options.map((option) => option.value))
    : [
        "iphone-15-pro",
        "pixel-8",
        "ipad-air",
        "macbook-pro-14",
        "desktop-1440-900",
        "apple-watch-series-9",
      ];
  for (const presetId of presetIds) {
    await picker.selectOption(presetId);
    const presetName = await picker.locator("option:checked").textContent();
    await page.getByRole("status").filter({ hasText: presetName }).waitFor();
    const canvasData = await page.locator("#frame-stage canvas").first().evaluate((canvas) =>
      canvas.toDataURL("image/png"),
    );
    assert.ok(canvasData.length > 2_000, `Konva device frame rendered for ${presetId} at DPR ${dpr}`);
    if (presetId === "iphone-15-pro") {
      await page.screenshot({ path: screenshotPath, fullPage: false });
      await page.getByRole("button", { name: "Rotate" }).click();
      await page.getByRole("status").filter({ hasText: "852 × 393" }).waitFor();
      await page.getByRole("button", { name: "Rotate" }).click();
      await page.getByRole("status").filter({ hasText: "393 × 852" }).waitFor();
    }
  }
  return presetIds.length;
}

async function createExportFiles() {
  const page = await browser.newPage();
  await page.goto(`${baseUrl}/?preview`, { waitUntil: "domcontentloaded" });
  const archiveBytes = await page.evaluate(async (source) => {
    const project = await new Function(source)();
    const { generateDeviceImageArchive, generateLocalHtmlArchive } = await import("/src/preview/htmlExport.ts");
    const responsiveArchive = await generateLocalHtmlArchive(project, {
      includeInteractions: true,
      includeAssets: true,
      mode: "responsive",
    });
    const variantArchive = await generateLocalHtmlArchive(project, {
      includeInteractions: true,
      includeAssets: true,
      mode: "device-variants",
    });
    const imageArchive = await generateDeviceImageArchive(project, {
      includeInteractions: true,
      includeAssets: true,
    });
    return {
      responsive: Array.from(responsiveArchive),
      variants: Array.from(variantArchive),
      images: Array.from(imageArchive),
    };
  }, deviceProjectSource());
  await page.close();
  const archive = await JSZip.loadAsync(Uint8Array.from(archiveBytes.responsive));
  const variants = await JSZip.loadAsync(Uint8Array.from(archiveBytes.variants));
  const imageArchive = await JSZip.loadAsync(Uint8Array.from(archiveBytes.images));
  const files = {
    "index.html": await archive.file("index.html").async("text"),
    "style.css": await archive.file("style.css").async("text"),
    "runtime.js": await archive.file("runtime.js").async("text"),
    imageArchive,
  };
  for (const variantName of ["index-desktop.html", "index-tablet.html", "index-mobile.html"]) {
    const variant = variants.file(variantName);
    assert.ok(variant, `generated per-device HTML file ${variantName}`);
    files[variantName] = await variant.async("text");
  }
  return files;
}

async function startExportServer(files) {
  exportServer = createServer((request, response) => {
    const name = new URL(request.url, "http://localhost").pathname.slice(1);
    const content = files[name];
    if (!content) {
      response.writeHead(404).end();
      return;
    }
    const contentType = name.endsWith(".css")
      ? "text/css"
      : name.endsWith(".js")
        ? "text/javascript"
        : "text/html";
    response.writeHead(200, { "content-type": `${contentType}; charset=utf-8` });
    response.end(content);
  });
  await new Promise((resolve) => exportServer.listen(0, "127.0.0.1", resolve));
  const address = exportServer.address();
  return `http://127.0.0.1:${address.port}`;
}

async function verifyDeviceImages(imageArchive) {
  for (const category of ["desktop", "tablet", "mobile"]) {
    const dimensions = [];
    for (const pixelRatio of [1, 2, 3]) {
      const image = await imageArchive.file(`images/${category}-${pixelRatio}x.png`).async("uint8array");
      assert.equal(String.fromCharCode(...image.slice(1, 4)), "PNG");
      dimensions.push({
        width: new DataView(image.buffer, image.byteOffset, image.byteLength).getUint32(16),
        height: new DataView(image.buffer, image.byteOffset, image.byteLength).getUint32(20),
      });
    }
    for (let ratio = 2; ratio <= 3; ratio += 1) {
      assert.equal(dimensions[ratio - 1].width, dimensions[0].width * ratio);
      assert.equal(dimensions[ratio - 1].height, dimensions[0].height * ratio);
    }
  }
}

async function verifyResponsiveExport(engine, exportUrl) {
  const instance = await engine.launch({ headless: true });
  try {
    const page = await instance.newPage({ viewport: { width: 390, height: 844 } });
    page.on("pageerror", (error) => console.error(`[${engine.name()} export page] ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") console.error(`[${engine.name()} export console] ${message.text()}`);
    });
    await page.goto(`${exportUrl}/index.html`, { waitUntil: "load" });
    await page.locator("#stage").waitFor({ state: "attached", timeout: 5_000 }).catch(async () => {
      throw new Error(`${engine.name()} export did not render #stage: ${await page.locator("body").innerText()}`);
    });
    for (const [width, height, expectedStageWidth, expectedWidgetWidth] of [
      [390, 844, 390, 200],
      [768, 1024, 768, 139],
      [1280, 800, 1440, 260],
    ]) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(50);
      const stageWidth = await page.locator("#stage").evaluate((node) => getComputedStyle(node).width);
      assert.equal(Number.parseFloat(stageWidth), expectedStageWidth, `${engine.name()} export stage at ${width}px`);
      const widget = page.locator(`[data-widget-id]`).first();
      const widgetWidth = await widget.evaluate((node) => Number.parseFloat(getComputedStyle(node).width));
      assert.ok(Math.abs(widgetWidth - expectedWidgetWidth) <= 1, `${engine.name()} widget width at ${width}px: ${widgetWidth}`);
    }
    for (const [variantName, width] of [
      ["index-desktop.html", 1280],
      ["index-tablet.html", 768],
      ["index-mobile.html", 390],
    ]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${exportUrl}/${variantName}`, { waitUntil: "load" });
      await page.locator("#stage[data-screen-id]").waitFor({ state: "attached" });
      assert.equal(await page.locator(".toolbar").isVisible(), true, `${variantName} opens`);
    }
  } finally {
    await instance.close();
  }
}

try {
  console.log("Starting local Vite server.");
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.exitCode !== null || server.signalCode !== null) {
      throw new Error(`Vite exited early:\n${serverOutput}`);
    }
    try {
      if ((await fetch(`${baseUrl}/?preview`)).ok) {
        ready = true;
        break;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  if (!ready) throw new Error(`Vite did not become ready:\n${serverOutput}`);

  browser = await chromium.launch({ headless: true });
  const screenshots = new URL("../reports/device-verification/screenshots/", import.meta.url);
  await mkdir(screenshots, { recursive: true });
  const dpis = [1, 1.25, 1.5, 2];
  for (const dpr of dpis) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 960 },
      deviceScaleFactor: dpr,
      hasTouch: true,
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => console.error(`[device verification page] ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") console.error(`[device verification page] ${message.text()}`);
    });
    page.on("requestfailed", (request) => console.error(`[preview browser request] ${request.url()} ${request.failure()?.errorText ?? ""}`));
    await page.goto(`${baseUrl}/?preview`, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch((error) => {
      throw new Error(`${error.message}\n${serverOutput}`);
    });
    await deliverProject(page);
    await verifyPreview(page);
    if (dpr === 1) await verifyInputModes(page);
    const label = `${Math.round(dpr * 100)}`;
    await page.screenshot({
      path: fileURLToPath(new URL(`multi-device-preview-${label}dpi.png`, screenshots)),
      fullPage: false,
    });
    const frameCount = await verifyDeviceFrames(
      page,
      dpr,
      fileURLToPath(new URL(`device-frame-${label}dpi.png`, screenshots)),
    );
    console.log(`Chromium preview and ${frameCount} device frames passed at ${label}% emulated display scale.`);
    await context.close();
  }

  const files = await createExportFiles();
  await verifyDeviceImages(files.imageArchive);
  delete files.imageArchive;
  const exportUrl = await startExportServer(files);
  console.log("Per-device PNG exports have matching 1×, 2×, and 3× pixel dimensions.");
  const engines = fullRun ? [chromium, firefox, webkit] : [chromium];
  for (const engine of engines) {
    await verifyResponsiveExport(engine, exportUrl);
    console.log(`${engine.name()} responsive and per-device HTML exports passed at all three breakpoints.`);
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (exportServer) await new Promise((resolve) => exportServer.close(resolve));
  server.kill();
}
