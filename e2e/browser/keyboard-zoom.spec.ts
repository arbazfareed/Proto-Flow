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
  await expect(page.getByText("1 selected")).toBeVisible();
  await page.keyboard.press("Control+-");
  const beforeTyping = await read();
  const beforeText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  await page.keyboard.press("Shift+1");
  await page.waitForTimeout(300);
  const finalZoom = await read();
  const afterText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  expect(
    finalZoom,
    `DIAG zoomed=${zoomed} beforeTyping=${beforeTyping} BEFORE=[${beforeText.slice(0, 1800)}] AFTER=[${afterText.slice(0, 600)}]`,
  ).toBe(beforeTyping);
});
