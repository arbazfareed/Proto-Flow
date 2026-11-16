import { expect, test, type Page } from "playwright/test";
import { startWorkspace } from "./workspace";

async function draw(page: Page, tool: string, x: number, y: number, width: number, height: number) {
  const box = (await page.locator(".canvas-stage-surface").boundingBox())!;
  await page.getByRole("button", { name: `Add ${tool}` }).first().click();
  await page.mouse.move(box.x + x, box.y + y);
  await page.mouse.down();
  await page.mouse.move(box.x + x + width, box.y + y + height, { steps: 6 });
  await page.mouse.up();
  return box;
}

async function typeIntoNewText(page: Page, text: string) {
  await expect(page.getByRole("textbox", { name: "Edit text text" })).toBeFocused();
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
}

const layerRow = (page: Page, name: string) =>
  page.locator(".layer-row").filter({ has: page.locator(".layer-name", { hasText: new RegExp(`^${name}$`) }) }).first();

test("text drawn on a rectangle stays its own layer and is what a click selects (B74)", async ({ page }) => {
  await startWorkspace(page, "Blank project");
  // The rectangle is still selected when the text is drawn, which used to nest the text in it.
  await draw(page, "Rectangle", 120, 120, 320, 200);
  const box = await draw(page, "Text", 160, 180, 200, 40);
  await typeIntoNewText(page, "On the shape");

  const rectangleDepth = await layerRow(page, "Rectangle").getAttribute("aria-level");
  await expect(layerRow(page, "On the shape")).toHaveAttribute("aria-level", rectangleDepth!);

  await page.keyboard.press("Escape");
  await page.mouse.click(box.x + 200, box.y + 200);
  await expect(layerRow(page, "On the shape")).toHaveAttribute("aria-selected", "true");
  await expect(layerRow(page, "Rectangle")).toHaveAttribute("aria-selected", "false");
});

test("a container still holds what is drawn inside it", async ({ page }) => {
  await startWorkspace(page, "Blank project");
  await draw(page, "Container", 120, 120, 320, 200);
  await draw(page, "Text", 160, 180, 200, 40);
  await typeIntoNewText(page, "Inside");

  const containerLevel = Number(await layerRow(page, "Container").getAttribute("aria-level"));
  await expect(layerRow(page, "Inside")).toHaveAttribute("aria-level", String(containerLevel + 1));
});
