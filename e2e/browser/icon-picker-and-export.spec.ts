import { expect, test } from "playwright/test";
import JSZip from "jszip";
import { readFile } from "node:fs/promises";
import { startWorkspace } from "./workspace";

test("B76 + B77: search the full icon set, and exported HTML draws the real icon", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await startWorkspace(page, "Blank project");
  await page.getByRole("button", { name: "Add Icon", exact: true }).first().click();
  const box = await page.locator(".canvas-stage-surface").boundingBox();
  if (!box) throw new Error("No canvas.");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByText("1 selected")).toBeVisible();

  // B76: "Send" is not one of the built-in icons; search finds it in the full set.
  const properties = page.getByRole("region", { name: "Widget properties" });
  await properties.getByRole("button", { name: /^Icon: / }).click();
  const picker = page.getByRole("dialog", { name: "Choose icon" });
  await picker.getByRole("searchbox", { name: "Search icons" }).fill("send");
  await expect(picker.getByText(/Showing \d+ of all Lucide icons/)).toBeVisible();
  await picker.getByRole("option", { name: "Send", exact: true }).click();
  await expect(properties.getByRole("button", { name: "Icon: Send" })).toBeVisible();
  await page.waitForTimeout(500);

  const previewPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview" }).click();
  const preview = await previewPromise;
  await expect(preview.locator(".preview-canvas-icon svg.lucide-send")).toBeVisible();
  await preview.close();

  // B77: the exported page contains the real SVG, not a "•".
  await page.getByRole("button", { name: "Export HTML bundle" }).click();
  const dialog = page.getByRole("dialog", { name: "Export HTML bundle" });
  const downloadPromise = page.waitForEvent("download");
  await dialog.getByRole("button", { name: /Download HTML bundle/ }).click();
  const download = await downloadPromise;
  const archive = await JSZip.loadAsync(await readFile((await download.path())!));
  const html = await archive.file("index.html")!.async("text");
  expect(await archive.file("runtime.js")!.async("text")).toContain("function drawIcon");
  expect(html).toContain('<script id="icon-data" type="application/json">');
  expect(html).toContain("lucide-send");

  // Open the exported page as a visitor would (its files served from one origin): the icon is
  // drawn as an SVG.
  const exported = await page.context().newPage();
  await exported.route("https://export.test/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\//, "") || "index.html";
    const file = archive.file(path);
    if (!file) return route.fulfill({ status: 404, body: "" });
    const type = path.endsWith(".html") ? "text/html" : path.endsWith(".css") ? "text/css" : "text/javascript";
    await route.fulfill({ status: 200, contentType: type, body: await file.async("text") });
  });
  await exported.goto("https://export.test/index.html");
  await expect(exported.locator('[role="img"] svg.lucide-send')).toBeVisible();
  await exported.close();
});
