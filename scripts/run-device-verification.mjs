import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium, firefox, webkit } from "playwright";
import JSZip from "jszip";
import { PNG } from "pngjs";

const baseUrl = "http://127.0.0.1:1421";
const fullRun = process.env.PF_DEVICE_FULL === "1";
const updateBaselines = process.env.PF_DEVICE_UPDATE_BASELINES === "1";
const screenshotDirectory = new URL("../reports/device-verification/screenshots/", import.meta.url);
const baselineDirectory = new URL("../reports/device-verification/baselines/", import.meta.url);
const updatePreviewBaselines = process.env.PF_DEVICE_UPDATE_PREVIEW_BASELINES === "1" ||
  process.argv.includes("--update-preview-baselines");
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

function deviceProjectSource(inputMode = "both", navigateOnClick = true) {
  const navigateOnClickActions = navigateOnClick
    ? `
        { type: "setVariable", target: "caption", value: "Updated shared value" },
        { type: "navigate", target: detailsScreen.id }`
    : "";
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
    const detailsScreen = {
      ...screen,
      id: crypto.randomUUID(),
      name: "Details",
      widgets: [{
        ...textWidget,
        id: crypto.randomUUID(),
        name: "Details label",
      }],
      interactionRules: [],
    };
    screen.widgets.push(textWidget, button);
    project.screens.push(detailsScreen);
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
      actions: [
        { type: "setVariable", target: "mouseSeen", value: true },
        ${navigateOnClickActions}
      ],
    }, {
      id: crypto.randomUUID(), widgetId: button.id, event: "onTap", conditions: [],
      actions: [{ type: "setVariable", target: "touchSeen", value: true }],
    });
    return project;
    })();
  `;
}

async function deliverProject(page, inputMode = "both", navigateOnClick = true) {
  await page.evaluate(async (source) => {
    const project = await new Function(source)();
    window.__pfPreviewProject = project;
    const channel = new BroadcastChannel("protoflow-preview");
    channel.postMessage({ type: "project", project });
    channel.close();
  }, deviceProjectSource(inputMode, navigateOnClick));
  await page.locator(".preview-frame-card").first().waitFor({ state: "visible", timeout: 20_000 });
}

async function updatePreviewInputMode(page, inputMode) {
  await page.evaluate((mode) => {
    const project = window.__pfPreviewProject;
    project.screens[0].inputMode = mode;
    const channel = new BroadcastChannel("protoflow-preview");
    channel.postMessage({ type: "project", project });
    channel.close();
  }, inputMode);
  await page.waitForFunction(
    (mode) => document.querySelector(".preview-screen")?.getAttribute("data-input-mode") === mode,
    inputMode,
  );
}

async function verifyInputModes(page) {
  const variablesToggle = page.getByRole("button", { name: "Toggle variables" });
  const variable = (name) => page.locator(".preview-variable-inspector label")
    .filter({ hasText: name }).locator("input");
  if (!(await page.locator(".preview-variable-inspector").count())) await variablesToggle.click();
  const startScreenId = await page.evaluate(() => window.__pfPreviewProject.screens[0].id);
  await page.getByRole("combobox", { name: "Preview screen" }).selectOption(startScreenId);

  await updatePreviewInputMode(page, "both");
  await page.getByRole("button", { name: "Interaction probe" }).first().click();
  assert.equal(await variable("mouseSeen").isChecked(), true);
  await page.getByRole("button", { name: "Back" }).click();
  await updatePreviewInputMode(page, "both");
  await page.getByRole("button", { name: "Interaction probe" }).first().tap();
  assert.equal(await variable("touchSeen").isChecked(), true);
  assert.equal(await variable("mouseSeen").isChecked(), true);

  await updatePreviewInputMode(page, "touch");
  const touchProbe = page.getByRole("button", { name: "Interaction probe" }).first();
  await variable("mouseSeen").setChecked(false);
  await touchProbe.click();
  assert.equal(await variable("mouseSeen").isChecked(), false);
  await touchProbe.tap();
  assert.equal(await variable("touchSeen").isChecked(), true);

  await updatePreviewInputMode(page, "mouse");
  const mouseProbe = page.getByRole("button", { name: "Interaction probe" }).first();
  await variable("touchSeen").setChecked(false);
  await mouseProbe.tap();
  assert.equal(await variable("touchSeen").isChecked(), false);
  await mouseProbe.click();
  assert.equal(await variable("mouseSeen").isChecked(), true);
}

async function setRangeValue(locator, value) {
  await locator.evaluate((input, nextValue) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, String(nextValue));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

async function verifyPreview(page, dpr) {
  const layout = page.getByLabel("Preview layout");
  await layout.selectOption("single");
  assert.equal(await page.locator(".preview-frame-card").count(), 1);
  await layout.selectOption("columns");
  assert.equal(await page.locator(".preview-frame-card").count(), 3);
  await layout.selectOption("grid");
  assert.equal(await page.locator(".preview-frame-card").count(), 4);
  await page.waitForFunction(() => {
    const cards = Array.from(document.querySelectorAll(".preview-frame-card"));
    return cards.length === 4 && cards.every((card) => {
      const viewport = card.querySelector(".preview-frame-viewport");
      const screen = card.querySelector(".preview-screen");
      const stage = card.querySelector(".preview-frame-stage");
      if (!viewport || !screen || !stage) return false;
      const viewportStyle = getComputedStyle(viewport);
      const availableWidth = viewport.clientWidth -
        parseFloat(viewportStyle.paddingLeft) - parseFloat(viewportStyle.paddingRight);
      const availableHeight = viewport.clientHeight -
        parseFloat(viewportStyle.paddingTop) - parseFloat(viewportStyle.paddingBottom);
      const expectedScale = Math.min(
        1,
        Math.max(0.01, (availableWidth - 28) / screen.offsetWidth),
        Math.max(0.01, (availableHeight - 28) / screen.offsetHeight),
      );
      return Math.abs(parseFloat(stage.style.width) - screen.offsetWidth * expectedScale) < 2 &&
        Math.abs(parseFloat(stage.style.height) - screen.offsetHeight * expectedScale) < 2;
    });
  }, undefined, { timeout: 10_000 });
  const fittedFrames = await page.locator(".preview-frame-card").evaluateAll((cards) =>
    cards.map((card) => {
      const viewport = card.querySelector(".preview-frame-viewport").getBoundingClientRect();
      const screen = card.querySelector(".preview-screen").getBoundingClientRect();
      return screen.width <= viewport.width && screen.height <= viewport.height;
    }),
  );
  assert.ok(fittedFrames.every(Boolean), "all selected device frames fit their preview cards");
  const devicePicker = page.locator(".preview-device-selection");
  await devicePicker.locator("summary").click();
  const selectedPreset = devicePicker.locator('input[type="checkbox"]:checked').first();
  const selectedPresetName = (await selectedPreset.evaluate((input) =>
    input.closest("label")?.textContent?.trim() ?? "",
  ));
  assert.ok(selectedPresetName, "custom device picker exposes an accessible preset label");
  await selectedPreset.uncheck();
  assert.equal(await page.locator(".preview-frame-card").count(), 3);
  await devicePicker.getByLabel(selectedPresetName).check();
  assert.equal(await page.locator(".preview-frame-card").count(), 4);
  await devicePicker.locator("summary").click();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const interLoaded = await page.evaluate(() =>
    Array.from(document.fonts).some((font) => font.family === "Inter Variable" && font.status === "loaded"),
  );
  assert.ok(interLoaded, "preview uses the bundled Inter font before visual comparison");
  await compareDeviceScreenshot(
    page,
    `multi-device-preview-${Math.round(dpr * 100)}dpi`,
    screenshotDirectory,
    updatePreviewBaselines,
  );

  await page.getByRole("button", { name: "Toggle variables" }).click();
  await page.locator(".preview-frame-card").first()
    .getByRole("button", { name: "Interaction probe" }).click();
  await page.waitForFunction(() =>
    document.querySelector('[aria-label="Preview screen"]')?.selectedOptions[0]?.textContent === "Details",
  );
  await page.locator(".preview-frame-heading").getByText("Details").first().waitFor();
  const visibleTexts = await page.locator(".preview-widget").allTextContents();
  assert.equal(visibleTexts.filter((text) => text.includes("Updated shared value")).length, 4);

  await page.evaluate(() => {
    const project = window.__pfPreviewProject;
    project.screens[1].name = "Details (updated)";
    const channel = new BroadcastChannel("protoflow-preview");
    channel.postMessage({ type: "project", project });
    channel.close();
  });
  await page.waitForFunction(() =>
    document.querySelector('[aria-label="Preview screen"]')?.selectedOptions[0]?.textContent === "Details (updated)",
  );
  const caption = page.locator(".preview-variable-inspector label")
    .filter({ hasText: "caption" }).locator("input");
  assert.equal(await caption.inputValue(), "Updated shared value");

  await page.getByRole("button", { name: "Rotate devices" }).click();
  assert.equal(await page.getByRole("button", { name: "Rotate devices" }).getAttribute("aria-pressed"), "true");
  assert.match(await page.locator(".preview-frame-heading span").first().textContent(), /900 × 1440/);
  const zoom = page.getByLabel("Preview zoom");
  await setRangeValue(zoom, 75);
  assert.equal(await zoom.inputValue(), "75");

  if (dpr === 1) {
    const frameRate = await page.evaluate(async () => {
      let frames = 0;
      const start = performance.now();
      await new Promise((resolve) => {
        const tick = () => {
          frames += 1;
          if (frames < 61) requestAnimationFrame(tick);
          else resolve();
        };
        requestAnimationFrame(tick);
      });
      return frames * 1000 / (performance.now() - start);
    });
    assert.ok(frameRate >= 50, `four-device preview sustained ${frameRate.toFixed(1)} animation frames per second`);
    console.log(`Four-device preview animation-frame rate: ${frameRate.toFixed(1)} FPS.`);
  }

  const screenshotDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Capture preview screenshot" }).click();
  const download = await screenshotDownload;
  assert.match(download.suggestedFilename(), /-grid-preview\.png$/);
  await page.getByText("Preview screenshot saved as a 2× PNG.").waitFor({ timeout: 15_000 });

  await page.setViewportSize({ width: 360, height: 320 });
  await page.waitForTimeout(50);
  const grid = page.locator(".preview-frame-grid");
  const scrollMetrics = await page.evaluate(() => {
    const gridElement = document.querySelector(".preview-frame-grid");
    const contentElement = document.querySelector(".preview-content");
    return {
      cards: document.querySelectorAll(".preview-frame-card").length,
      gridColumns: getComputedStyle(gridElement).gridTemplateColumns,
      gridRows: getComputedStyle(gridElement).gridTemplateRows,
      cardBounds: Array.from(document.querySelectorAll(".preview-frame-card"), (card) => {
        const bounds = card.getBoundingClientRect();
        return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
      }),
      grid: {
        clientWidth: gridElement.clientWidth,
        scrollWidth: gridElement.scrollWidth,
        clientHeight: gridElement.clientHeight,
        scrollHeight: gridElement.scrollHeight,
      },
      content: {
        clientWidth: contentElement.clientWidth,
        scrollWidth: contentElement.scrollWidth,
        clientHeight: contentElement.clientHeight,
        scrollHeight: contentElement.scrollHeight,
      },
    };
  });
  const { grid: gridMetrics, content: contentMetrics } = scrollMetrics;
  const panAxis = gridMetrics.scrollWidth > gridMetrics.clientWidth ||
      contentMetrics.scrollWidth > contentMetrics.clientWidth
    ? "scrollLeft"
    : "scrollTop";
  const panTarget = (panAxis === "scrollLeft"
    ? gridMetrics.scrollWidth > gridMetrics.clientWidth
    : gridMetrics.scrollHeight > gridMetrics.clientHeight)
    ? grid
    : page.locator(".preview-content");
  assert.ok(
    [gridMetrics, contentMetrics].some(({ scrollWidth, clientWidth, scrollHeight, clientHeight }) =>
      scrollWidth > clientWidth || scrollHeight > clientHeight,
    ),
    `four-device grid is scrollable at compact size (${JSON.stringify(scrollMetrics)})`,
  );
  await panTarget.evaluate((element, axis) => {
    element[axis] = axis === "scrollLeft" ? element.scrollWidth : element.scrollHeight;
  }, panAxis);
  assert.ok(
    await panTarget.evaluate((element, axis) => element[axis] > 0, panAxis),
    "multi-device grid supports scrolling/panning",
  );
  await page.setViewportSize({ width: 1440, height: 960 });
  await grid.evaluate((element) => { element.scrollTop = 0; });
}

async function verifyDeviceFrames(page, dpr, screenshotDirectory) {
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
    const screenshotName = `${presetId}-${Math.round(dpr * 100)}dpi`;
    await compareDeviceScreenshot(page, screenshotName, screenshotDirectory);
    if (presetId === "iphone-15-pro") {
      await compareDeviceScreenshot(
        page,
        `device-frame-${Math.round(dpr * 100)}dpi`,
        screenshotDirectory,
      );
      await page.getByRole("button", { name: "Rotate" }).click();
      await page.getByRole("status").filter({ hasText: "852 × 393" }).waitFor();
      await compareDeviceScreenshot(
        page,
        `iphone-15-pro-landscape-${Math.round(dpr * 100)}dpi`,
        screenshotDirectory,
      );
      await page.getByRole("button", { name: "Rotate" }).click();
      await page.getByRole("status").filter({ hasText: "393 × 852" }).waitFor();
    }
  }
  await picker.selectOption("iphone-15-pro");
  const frameCanvas = page.locator("#frame-stage canvas").first();
  const frameToggle = page.getByRole("button", { name: "Show device frame" });
  const initialFrame = await frameCanvas.evaluate((canvas) => canvas.toDataURL("image/png"));
  await frameToggle.click();
  await page.waitForFunction(
    (before) => document.querySelector("#frame-stage canvas")?.toDataURL("image/png") !== before,
    initialFrame,
  );
  assert.equal(await frameToggle.getAttribute("aria-pressed"), "false");
  const frameHidden = await frameCanvas.evaluate((canvas) => canvas.toDataURL("image/png"));
  await frameToggle.click();
  await page.waitForFunction(
    (before) => document.querySelector("#frame-stage canvas")?.toDataURL("image/png") !== before,
    frameHidden,
  );
  assert.equal(await frameToggle.getAttribute("aria-pressed"), "true");

  const safeAreaToggle = page.getByRole("button", { name: "Show safe area" });
  const initialSafeArea = await frameCanvas.evaluate((canvas) => canvas.toDataURL("image/png"));
  await safeAreaToggle.click();
  await page.waitForFunction(
    (before) => document.querySelector("#frame-stage canvas")?.toDataURL("image/png") !== before,
    initialSafeArea,
  );
  assert.equal(await safeAreaToggle.getAttribute("aria-pressed"), "false");
  const safeAreaHidden = await frameCanvas.evaluate((canvas) => canvas.toDataURL("image/png"));
  await safeAreaToggle.click();
  await page.waitForFunction(
    (before) => document.querySelector("#frame-stage canvas")?.toDataURL("image/png") !== before,
    safeAreaHidden,
  );
  assert.equal(await safeAreaToggle.getAttribute("aria-pressed"), "true");
  return presetIds.length;
}

async function compareDeviceScreenshot(page, name, screenshotUrl, update = updateBaselines) {
  const screenshot = await page.screenshot({
    path: fileURLToPath(new URL(`${name}.png`, screenshotUrl)),
    animations: "disabled",
  });
  const baselineUrl = new URL(`${name}.png`, baselineDirectory);
  let baselineBytes;
  try {
    baselineBytes = await readFile(baselineUrl);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    if (process.env.CI && !updateBaselines) {
      throw new Error(`Missing device screenshot baseline ${baselineUrl.pathname}; generate and review it locally.`);
    }
    await writeFile(baselineUrl, screenshot);
    return { initialized: true, changedPixelRatio: 0 };
  }
  if (update) {
    await writeFile(baselineUrl, screenshot);
    return { initialized: true, changedPixelRatio: 0 };
  }
  const actualImage = PNG.sync.read(screenshot);
  const baselineImage = PNG.sync.read(baselineBytes);
  assert.equal(actualImage.width, baselineImage.width, `${name} screenshot width`);
  assert.equal(actualImage.height, baselineImage.height, `${name} screenshot height`);
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
  assert.ok(
    changedPixelRatio <= 0.01,
    `${name} screenshot changed ${(changedPixelRatio * 100).toFixed(2)}% of pixels. ` +
      `Review reports/device-verification/screenshots/${name}.png against ` +
      `reports/device-verification/baselines/${name}.png. If the visual change is intentional, ` +
      "run npm run verify:devices:update-preview-baselines, review the baseline diffs, then " +
      "rerun npm run verify:devices.",
  );
  return { initialized: false, changedPixelRatio };
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
      [320, 844, 390, 200],
      [768, 1024, 768, 139],
      [1024, 800, 1440, 260],
      [1440, 900, 1440, 260],
      [3840, 2160, 1440, 260],
    ]) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(50);
      const stageWidth = await page.locator("#stage").evaluate((node) => getComputedStyle(node).width);
      assert.equal(Number.parseFloat(stageWidth), expectedStageWidth, `${engine.name()} export stage at ${width}px`);
      const widget = page.locator(`[data-widget-id]`).first();
      const widgetWidth = await widget.evaluate((node) => Number.parseFloat(getComputedStyle(node).width));
      assert.ok(Math.abs(widgetWidth - expectedWidgetWidth) <= 1, `${engine.name()} widget width at ${width}px: ${widgetWidth}`);
      if (width === 320) {
        const stageWrap = page.locator(".stage-wrap");
        const scrollWidth = await stageWrap.evaluate((element) => element.scrollWidth);
        assert.ok(scrollWidth > width, `${engine.name()} 320px export canvas can be panned`);
        await stageWrap.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
        assert.ok(await stageWrap.evaluate((element) => element.scrollLeft > 0), `${engine.name()} 320px canvas is reachable`);
        await stageWrap.evaluate((element) => { element.scrollLeft = 0; });
      }
    }
    for (const [variantName, width] of [
      ["index-desktop.html", 1440],
      ["index-tablet.html", 768],
      ["index-mobile.html", 320],
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
  await mkdir(screenshotDirectory, { recursive: true });
  await mkdir(baselineDirectory, { recursive: true });
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
    await verifyPreview(page, dpr);
    if (dpr === 1) await verifyInputModes(page);
    const label = `${Math.round(dpr * 100)}`;
    await page.screenshot({
      path: fileURLToPath(new URL(`multi-device-preview-${label}dpi.png`, screenshotDirectory)),
      fullPage: false,
    });
    const frameCount = await verifyDeviceFrames(
      page,
      dpr,
      screenshotDirectory,
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
    console.log(`${engine.name()} responsive HTML passed at 320, 390, 768, 1024, 1440, 1920, and 3840px; variants passed.`);
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (exportServer) await new Promise((resolve) => exportServer.close(resolve));
  server.kill();
}
