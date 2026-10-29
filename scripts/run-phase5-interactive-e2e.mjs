import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const port = 1422;
const baseUrl = `http://127.0.0.1:${port}`;
const headless = process.env.PF_E2E_HEADLESS === "1";
const screenshotDirectory = new URL("../reports/phase5.1/screenshots/", import.meta.url);
const server = spawn(
  process.execPath,
  [fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url)), "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let serverOutput = "";
server.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
server.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });
let browser;
let previewPage;

try {
  await mkdir(screenshotDirectory, { recursive: true });
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.exitCode !== null || server.signalCode !== null) {
      throw new Error(`Vite exited early:\n${serverOutput}`);
    }
    try {
      const response = await fetch(baseUrl);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  if (!ready) throw new Error(`Vite did not become ready:\n${serverOutput}`);

  browser = await chromium.launch({ headless, slowMo: headless ? 0 : 90 });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") console.error(`[browser console] ${message.text()}`);
  });

  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.getByRole("button", { name: "Save project" }).waitFor({ state: "visible", timeout: 30_000 });

  const firstLaunchChoice = page.getByRole("button", { name: "Continue with both off" });
  if (await firstLaunchChoice.isVisible().catch(() => false)) {
    await firstLaunchChoice.click();
  }

  await page.getByRole("button", { name: "New project" }).first().click();
  await page.getByText("New project created").waitFor({ timeout: 10_000 });

  const addButton = page.getByRole("button", { name: "Add Button", exact: true });
  await addButton.click();
  const surface = page.locator(".canvas-stage-surface");
  await surface.waitFor({ state: "visible", timeout: 30_000 });
  const bounds = await surface.boundingBox();
  assert.ok(bounds && bounds.width > 100 && bounds.height > 100, "editor canvas is visible");
  const start = { x: bounds.x + bounds.width * 0.47, y: bounds.y + bounds.height * 0.43 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 150, start.y + 52, { steps: 6 });
  await page.mouse.up();

  const buttonLayer = page.getByRole("treeitem", { name: /^Button,/ }).first();
  await buttonLayer.waitFor({ state: "visible", timeout: 15_000 });
  await buttonLayer.click();
  await page.getByRole("tab", { name: "Notes" }).click();
  await page.getByRole("textbox", { name: "Description" }).fill("Visible UI smoke note for the Phase 5.1 editor workflow.");
  await page.getByLabel("Requirement ID").fill("PF5-1-UI");
  await page.getByLabel("Priority").selectOption("high");
  assert.ok(await page.locator(".canvas-stage-surface canvas").count() > 0, "Konva editor canvas rendered");

  const previewPromise = context.waitForEvent("page", { timeout: 15_000 });
  await page.getByRole("button", { name: "Open preview" }).click();
  previewPage = await previewPromise;
  previewPage.on("pageerror", (error) => pageErrors.push(`preview: ${error.message}`));
  await previewPage.locator(".preview-screen").waitFor({ state: "visible", timeout: 30_000 });
  await previewPage.locator(".preview-widget").first().waitFor({ state: "visible", timeout: 15_000 });

  await page.getByRole("button", { name: "Create Mobile screen" }).click();
  await page.getByRole("button", { name: "Flow", exact: true }).click();
  await page.getByRole("region", { name: "Screen flow diagram" }).waitFor({ state: "visible", timeout: 15_000 });
  assert.equal(await page.locator(".flow-node").count(), 2, "Flow view shows both project screens");
  const [flowDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.locator('button[title="Export flow diagram as SVG"]').click(),
  ]);
  assert.match(flowDownload.suggestedFilename(), /\.svg$/i, "Flow view exports an SVG");
  await page.screenshot({
    path: fileURLToPath(new URL("editor-flow-smoke.png", screenshotDirectory)),
    fullPage: false,
  });

  await page.getByRole("button", { name: "Design", exact: true }).click();
  await page.keyboard.press("Control+k");
  let palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.waitFor({ state: "visible" });
  await palette.getByRole("option", { name: "Version History" }).click();
  let history = page.getByRole("dialog", { name: "Version history" });
  await history.waitFor({ state: "visible", timeout: 10_000 });
  await history.getByLabel("Named checkpoint").fill("Before project rename");
  await history.getByRole("button", { name: "Create", exact: true }).click();
  await history.getByRole("button", { name: /Before project rename/ }).waitFor({ timeout: 10_000 });
  await history.getByRole("button", { name: "Close version history" }).click();

  await page.getByLabel("Project name").fill("Phase 5.1 UI v2");
  await page.keyboard.press("Control+k");
  palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.waitFor({ state: "visible" });
  await palette.getByRole("option", { name: "Version History" }).click();
  history = page.getByRole("dialog", { name: "Version history" });
  await history.waitFor({ state: "visible", timeout: 10_000 });
  await history.getByLabel("Named checkpoint").fill("After project rename");
  await history.getByRole("button", { name: "Create", exact: true }).click();
  await history.getByRole("button", { name: /After project rename/ }).waitFor({ timeout: 10_000 });
  await history.getByRole("button", { name: /Before project rename/ }).waitFor({ timeout: 10_000 });
  await history.getByRole("button", { name: "Close version history" }).click();

  await previewPage.close();
  previewPage = undefined;
  if (pageErrors.length > 0) {
    throw new Error(`Editor UI raised uncaught browser errors:\n- ${pageErrors.join("\n- ")}`);
  }

  console.log(`Phase 5.1 interactive editor smoke passed (${headless ? "headless CI" : "visible Chromium"}).`);
  console.log("Verified: privacy choice, new project, canvas drawing, layer selection, widget notes, preview popup, second screen, Flow/SVG export, and two version-history checkpoints.");
  console.log("Screenshot: reports/phase5.1/screenshots/editor-flow-smoke.png");
} finally {
  await previewPage?.close().catch(() => undefined);
  await browser?.close();
  server.kill();
}
