import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { expect, test } from "playwright/test";
import { startWorkspace } from "./workspace";

test("exports offline responsive and per-device HTML bundles without cloud access", async ({
  page,
}) => {
  await startWorkspace(page, "Responsive web");
  await page.getByRole("button", { name: "Export HTML bundle" }).click();

  const dialog = page.getByRole("dialog", { name: "Export HTML bundle" });
  await expect(dialog.getByText(/0 credits · no upload · local export/)).toBeVisible();
  await dialog.getByLabel("Export format").selectOption("device-variants");

  const downloadPromise = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download device variants" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.zip$/i);

  const archivePath = await download.path();
  expect(archivePath).not.toBeNull();
  const archive = await JSZip.loadAsync(await readFile(archivePath!));
  const html = await archive.file("index.html")?.async("text");
  const runtime = await archive.file("runtime.js")?.async("text");
  expect(html).toContain("Responsive web");
  expect(await archive.file("index-desktop.html")?.async("text")).toContain("Responsive web");
  expect(await archive.file("index-tablet.html")?.async("text")).toContain("Responsive web");
  expect(await archive.file("index-mobile.html")?.async("text")).toContain("Responsive web");
  expect(runtime).not.toMatch(/\b(?:fetch|XMLHttpRequest)\b/);
});
