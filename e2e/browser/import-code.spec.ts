import { expect, test } from "playwright/test";
import { startWorkspace } from "./workspace";

test("PF-T801 imports code in a sandbox and renders editable elements on the canvas", async ({
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

  await page.getByRole("textbox", { name: "HTML code" }).fill(
    "<main><h1>Imported campaign</h1><p>Editable copy</p><button>Learn more</button></main>",
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
  await expect(page.getByText("Rendered 3 elements on the canvas.")).toBeVisible();
  const layerSearch = page.getByRole("searchbox", { name: "Search layers" });
  await layerSearch.fill("h1 Imported campaign");
  await expect(page.locator(".layer-row").filter({
    has: page.locator(".layer-name", { hasText: "h1 Imported campaign" }),
  })).toBeVisible();
  await expect(page.locator(".save-state-label")).toHaveText("Unsaved changes");
  await testInfo.attach("PF-T801-imported-canvas-elements", {
    body: await page.screenshot({ path: testInfo.outputPath("pf-t801-imported-canvas.png") }),
    contentType: "image/png",
  });
});
