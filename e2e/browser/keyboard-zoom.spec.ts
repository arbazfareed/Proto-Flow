import { expect, test } from "playwright/test";
import { startWorkspace } from "./workspace";

// B31: Ctrl+= and Ctrl+- did nothing. They now zoom in and out by one step, like the zoom buttons.
test("B31: Ctrl+= zooms in and Ctrl+- zooms out", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await startWorkspace(page, "Blank project");
  const value = page.locator(".canvas-zoom-value");
  const read = async () => Number.parseInt((await value.textContent()) ?? "0", 10);

  const start = await read();
  await page.keyboard.press("Control+=");
  await expect.poll(read).toBe(start + 10);
  await page.keyboard.press("Control+-");
  await page.keyboard.press("Control+-");
  await expect.poll(read).toBe(start - 10);
});

// B31: Shift+1 zooms to fit everything. On a selected text-editable widget it stays a typing key,
// so it never swallows the "!" the person is typing.
test("B31: Shift+1 fits everything, but not while a button is selected", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await startWorkspace(page, "Blank project");
  const value = page.locator(".canvas-zoom-value");
  const read = async () => Number.parseInt((await value.textContent()) ?? "0", 10);
  const box = await page.locator(".canvas-stage-surface").boundingBox();
  if (!box) throw new Error("No canvas.");
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const empty = { x: box.x + 20, y: box.y + box.height - 20 };

  await page.getByRole("button", { name: "Add Rectangle" }).click();
  await page.mouse.click(centre.x, centre.y);
  await expect(page.getByText("1 selected")).toBeVisible();
  await page.mouse.click(empty.x, empty.y);
  await expect(page.getByText("0 selected")).toBeVisible();

  // Nothing selected: Shift+1 fits the one rectangle, which changes the zoom.
  await page.keyboard.press("Control+=");
  await page.keyboard.press("Control+=");
  const zoomed = await read();
  await page.keyboard.press("Shift+1");
  await expect.poll(read).not.toBe(zoomed);

  // A button selected: Shift+1 starts typing into it, so the zoom stays as it was.
  await page.mouse.click(empty.x, empty.y);
  await page.getByRole("button", { name: "Add Button" }).click();
  await page.mouse.click(centre.x, centre.y);
  // After the first fit the Rectangle fills the middle of the canvas, so a click there can select
  // the Rectangle instead of the new Button (it did on the Windows runner). Pick the Button in
  // the Layers panel so the test always has the Button selected.
  await page.locator(".layer-row", { hasText: "Button" }).click();
  await expect(page.locator('.layer-row[aria-selected="true"]')).toHaveCount(1);
  await expect(page.locator('.layer-row[aria-selected="true"]')).toContainText("Button");
  await expect(page.getByText("1 selected")).toBeVisible();
  const beforeZoomOut = await read();
  await page.keyboard.press("Control+-");
  await expect.poll(read).toBe(beforeZoomOut - 10);
  const beforeTyping = await read();
  await page.keyboard.press("Shift+1");
  await page.waitForTimeout(300);
  expect(await read()).toBe(beforeTyping);
});
