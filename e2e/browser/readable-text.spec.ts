import { expect, test, type Page } from "playwright/test";
import { startWorkspace } from "./workspace";

async function draw(page: Page, tool: string, x: number, y: number, width: number, height: number) {
  const box = (await page.locator(".canvas-stage-surface").boundingBox())!;
  await page.getByRole("button", { name: `Add ${tool}` }).first().click();
  await page.mouse.move(box.x + x, box.y + y);
  await page.mouse.down();
  await page.mouse.move(box.x + x + width, box.y + y + height, { steps: 6 });
  await page.mouse.up();
}

async function typeText(page: Page, text: string) {
  const editor = page.getByRole("textbox", { name: "Edit text text" });
  await expect(editor).toBeFocused();
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
  await expect(editor).toHaveCount(0);
}

async function clearSelection(page: Page) {
  await page.keyboard.press("Escape");
}

test("new text is readable on the screen, on a dark shape and in a pale container", async ({ page }) => {
  await startWorkspace(page, "Blank project");
  await draw(page, "Rectangle", 120, 120, 260, 140);
  await clearSelection(page);
  await draw(page, "Text", 150, 160, 160, 40);
  await typeText(page, "On rectangle");
  await clearSelection(page);
  await draw(page, "Container", 450, 120, 300, 200);
  await clearSelection(page);
  await draw(page, "Text", 480, 200, 200, 40);
  await typeText(page, "In container");
  await clearSelection(page);
  await draw(page, "Text", 150, 420, 160, 40);
  await typeText(page, "On screen");

  const previewPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview" }).click();
  const preview = await previewPromise;
  const colourOf = (text: string) =>
    preview.locator(".preview-screen").getByText(text, { exact: true })
      .evaluate((element) => getComputedStyle(element.closest("[data-widget-type]") ?? element).color);

  // B95: the default used to be #e9e9ec, almost invisible on white and on pale containers.
  await expect.poll(() => colourOf("On screen")).toBe("rgb(36, 33, 43)");
  await expect.poll(() => colourOf("In container")).toBe("rgb(36, 33, 43)");
  await expect.poll(() => colourOf("On rectangle")).toBe("rgb(255, 255, 255)");
});
