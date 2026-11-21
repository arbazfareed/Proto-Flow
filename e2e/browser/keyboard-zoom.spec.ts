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
