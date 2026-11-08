import { expect, test } from "playwright/test";
import { startWorkspace } from "./workspace";

test("PF-T803 imports nested HTML and SVG as editable Konva canvas elements", async ({
  page,
}, testInfo) => {
  await startWorkspace(page, "Blank project");
  await page.getByRole("button", { name: "Import Code" }).click();

  const dialog = page.getByRole("dialog", { name: "Import code" });
  const preview = page.getByTitle("Sandboxed code preview");
  await expect(dialog).toBeVisible();
  await expect(preview).toHaveAttribute("sandbox", "allow-scripts");
  await expect(preview).not.toHaveAttribute("sandbox", /allow-same-origin/);
  await expect(preview).toHaveAttribute("srcdoc", /connect-src 'none'/);
  const frame = page.frameLocator('iframe[title="Sandboxed code preview"]');
  await expect(frame.getByRole("heading", { name: "Welcome to ProtoFlow" })).toBeVisible();
  await testInfo.attach("PF-T801-import-modal-preview", {
    body: await page.screenshot({ path: testInfo.outputPath("pf-t801-import-modal.png") }),
    contentType: "image/png",
  });

  await frame.getByRole("button", { name: "Try it" }).click();
  await expect(frame.getByRole("button", { name: "It works!" })).toBeVisible();

  const htmlEditor = page.getByRole("textbox", { name: "HTML code" });
  const requiredIcons = page.getByLabel("Required icons");
  await htmlEditor.fill(
    '<video aria-label="Intro"></video><table><tr><td>Report</td></tr></table><input type="date" aria-label="Start date">',
  );
  await expect(requiredIcons).toContainText("Video");
  await expect(requiredIcons).toContainText("Table");
  await expect(requiredIcons).toContainText("Calendar");
  await expect(frame.getByText("Report")).toBeVisible();
  await testInfo.attach("PF-T802-required-icon-matches", {
    body: await page.screenshot({ path: testInfo.outputPath("pf-t802-required-icons.png") }),
    contentType: "image/png",
  });

  await htmlEditor.fill(
    '<main style="width: 420px; padding: 16px; background-color: #eef2ff"><h1>Imported campaign</h1><p>Editable copy</p><svg viewBox="10 20 100 50" style="width: 200px; height: 100px"><path d="M10 20 L110 20 L110 70 Z" fill="#ff0000" stroke="#111827" stroke-width="2"/></svg><button>Learn more</button></main>',
  );
  await expect(frame.getByRole("heading", { name: "Imported campaign" })).toBeVisible();
  await page.getByRole("tab", { name: "CSS" }).click();
  await page.getByRole("textbox", { name: "CSS code" }).fill(
    "body { background: #e8f4ff; } h1 { color: #123456; }",
  );
  await expect(preview).toHaveAttribute("srcdoc", /#e8f4ff/);

  await page.getByRole("tab", { name: "HTML" }).click();
  await page.getByRole("button", { name: "Render on Canvas" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText("Rendered 5 elements on the canvas.")).toBeVisible();
  const layerSearch = page.getByRole("searchbox", { name: "Search layers" });
  await layerSearch.fill("h1 Imported campaign");
  await expect(page.locator(".layer-row").filter({
    has: page.locator(".layer-name", { hasText: "h1 Imported campaign" }),
  })).toBeVisible();
  await layerSearch.fill("path");
  await expect(page.locator(".layer-row").filter({
    has: page.locator(".layer-name", { hasText: "path" }),
  })).toBeVisible();
  await expect(page.locator(".save-state-label")).toHaveText("Unsaved changes");
  await testInfo.attach("PF-T801-imported-canvas-elements", {
    body: await page.screenshot({ path: testInfo.outputPath("pf-t803-imported-canvas.png") }),
    contentType: "image/png",
  });
});
