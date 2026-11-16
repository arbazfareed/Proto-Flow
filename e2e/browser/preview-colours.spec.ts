import { expect, test } from "playwright/test";
import { startWorkspace } from "./workspace";

test("Preview shows a new card in the same pale colour as the editor", async ({ page }) => {
  await startWorkspace(page, "Blank project");
  await page.getByRole("button", { name: "Add Card" }).first().click();
  const box = (await page.locator(".canvas-stage-surface").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2 - 150, box.y + box.height / 2 - 100);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 150, box.y + box.height / 2 + 100, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator(".layer-row .layer-name", { hasText: /^Card$/ })).toBeVisible();

  const previewPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview" }).click();
  const preview = await previewPromise;
  const container = preview.locator('.preview-screen [data-widget-type="card"], .preview-screen article').first();
  await expect(container).toBeVisible();

  // The canvas draws new cards at 10% fill; Preview used to paint them solid orange.
  const background = await container.evaluate((element) => getComputedStyle(element).backgroundColor);
  const alpha = Number(background.match(/rgba\([^)]*,\s*([\d.]+)\)/)?.[1] ?? 1);
  expect(alpha).toBeLessThan(0.2);
});
