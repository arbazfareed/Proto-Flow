import { expect, test } from "playwright/test";
import { startWorkspace } from "./workspace";

test("Preview keeps centred and right-aligned text where the canvas puts it", async ({ page }) => {
  await startWorkspace(page, "Blank project");
  await page.getByRole("button", { name: "Add Text" }).first().click();
  const box = (await page.locator(".canvas-stage-surface").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2 - 150, box.y + box.height / 2 - 20);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 150, box.y + box.height / 2 + 20, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.type("Hi");
  await page.keyboard.press("Enter");

  const alignment = page.getByRole("combobox", { name: "Text alignment" }).first();
  await alignment.scrollIntoViewIfNeeded();
  await alignment.selectOption("center");

  const textPosition = async (preview: import("playwright/test").Page) => {
    const widget = preview.locator('.preview-screen [data-widget-type="text"]');
    await expect(widget).toBeVisible();
    return widget.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const text = range.getBoundingClientRect();
      const frame = element.getBoundingClientRect();
      return { left: text.left - frame.left, right: frame.right - text.right };
    });
  };

  const previewPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview" }).click();
  const preview = await previewPromise;
  // B88: the text used to stay at the left edge (left gap ≈ 0) even when centred.
  const centred = await textPosition(preview);
  expect(centred.left).toBeGreaterThan(100);
  expect(Math.abs(centred.left - centred.right)).toBeLessThan(4);
  await preview.close();

  await alignment.selectOption("right");
  const secondPreview = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview" }).click();
  const right = await textPosition(await secondPreview);
  expect(right.right).toBeLessThan(4);
  expect(right.left).toBeGreaterThan(200);
});
