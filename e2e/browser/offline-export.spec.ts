import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { PNG } from "pngjs";
import { expect, test } from "playwright/test";
import { startWorkspace } from "./workspace";

test("exports offline responsive HTML, device variants, and 1x/2x/3x images for free", async ({
  page,
}) => {
  await startWorkspace(page, "Responsive web");
  await page.getByRole("button", { name: "Export HTML bundle" }).click();

  const dialog = page.getByRole("dialog", { name: "Export HTML bundle" });
  await expect(dialog.getByText(/0 credits · no upload · local export/)).toBeVisible();

  const downloadArchive = async (mode: string, buttonName: RegExp) => {
    await dialog.getByLabel("Export format").selectOption(mode);
    const downloadPromise = page.waitForEvent("download");
    await dialog.getByRole("button", { name: buttonName }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.zip$/i);
    const archivePath = await download.path();
    expect(archivePath).not.toBeNull();
    return JSZip.loadAsync(await readFile(archivePath!));
  };

  const responsive = await downloadArchive("responsive", /Download HTML bundle/);
  expect(await responsive.file("index.html")?.async("text")).toContain("Responsive web");
  expect(await responsive.file("runtime.js")?.async("text")).toBeTruthy();

  const archive = await downloadArchive("device-variants", /Download device variants/);
  const html = await archive.file("index.html")?.async("text");
  const runtime = await archive.file("runtime.js")?.async("text");
  expect(html).toContain("Responsive web");
  expect(await archive.file("index-desktop.html")?.async("text")).toContain("Responsive web");
  expect(await archive.file("index-tablet.html")?.async("text")).toContain("Responsive web");
  expect(await archive.file("index-mobile.html")?.async("text")).toContain("Responsive web");
  expect(runtime).not.toMatch(/\b(?:fetch|XMLHttpRequest)\b/);

  const images = await downloadArchive("device-images", /Download device images/);
  for (const category of ["desktop", "tablet", "mobile"]) {
    const dimensions: Array<{ width: number; height: number }> = [];
    for (const ratio of [1, 2, 3]) {
      const image = await images.file(`images/${category}-${ratio}x.png`)?.async("nodebuffer");
      expect(image).toBeDefined();
      const { width, height } = PNG.sync.read(image!);
      dimensions.push({ width, height });
    }
    for (const ratio of [2, 3]) {
      expect(dimensions[ratio - 1].width).toBe(dimensions[0].width * ratio);
      expect(dimensions[ratio - 1].height).toBe(dimensions[0].height * ratio);
    }
  }
});

test("shows responsive React export settings and the three-credit ZIP price without exporting", async ({
  page,
}) => {
  await startWorkspace(page, "Responsive web");
  await page.getByRole("button", { name: "Export code" }).click();

  const dialog = page.getByRole("dialog", { name: "Export React code" });
  await expect(dialog.getByText(/ZIP export costs 3 credits/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Download project ZIP (3 credits)" })).toBeVisible();
  const responsive = dialog.getByLabel("Responsive breakpoint layouts");
  await responsive.check();
  await expect(responsive).toBeChecked();
});
