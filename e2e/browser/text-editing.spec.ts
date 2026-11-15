import { expect, test, type Page } from "playwright/test";
import { startWorkspace } from "./workspace";

const textEditor = (page: Page) => page.getByRole("textbox", { name: "Edit text text" });
const textLayer = (page: Page, name: string) =>
  page.locator(".layer-row .layer-name", { hasText: new RegExp(`^${name}$`) });

async function drawTextWidget(page: Page) {
  await page.getByRole("button", { name: "Add Text" }).first().click();
  const box = (await page.locator(".canvas-stage-surface").boundingBox())!;
  const x = box.x + box.width / 2 - 60;
  const y = box.y + box.height / 2 - 20;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 120, y + 40, { steps: 5 });
  await page.mouse.up();
}

test("a drawn text widget opens for editing and typing replaces the default text", async ({ page }) => {
  await startWorkspace(page, "Blank project");
  await drawTextWidget(page);

  // B1: the editor opens by itself with the default text selected, so typing replaces it.
  const editor = textEditor(page);
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue("Text");
  await page.keyboard.type("Hello");
  await expect(editor).toHaveValue("Hello");
  await page.keyboard.press("Enter");
  await expect(editor).toHaveCount(0);
  await expect(textLayer(page, "Hello")).toBeVisible();
});

test("typing on a selected text widget edits it instead of running tool shortcuts", async ({ page }) => {
  await startWorkspace(page, "Blank project");
  await drawTextWidget(page);
  await page.keyboard.type("Hello");
  await page.keyboard.press("Enter");
  await expect(textEditor(page)).toHaveCount(0);
  const layers = await page.locator(".layer-row").count();

  // B5: "r", "o", "t" etc. are shape shortcuts, but on a selected text widget they are text.
  await page.keyboard.type("tool");
  await expect(textEditor(page)).toHaveValue("tool");
  await page.keyboard.press("Enter");
  await expect(textLayer(page, "tool")).toBeVisible();
  await expect(page.locator(".layer-row")).toHaveCount(layers);

  // Enter on the selected widget opens the editor with everything selected.
  await page.keyboard.press("Enter");
  await expect(textEditor(page)).toBeFocused();
  await page.keyboard.type("Done");
  await page.keyboard.press("Enter");
  await expect(textLayer(page, "Done")).toBeVisible();
});

test("shape shortcuts still work when nothing is selected", async ({ page }) => {
  await startWorkspace(page, "Blank project");
  const box = (await page.locator(".canvas-stage-surface").boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const layers = await page.locator(".layer-row").count();
  await page.keyboard.press("r");
  await expect(page.locator(".layer-row")).toHaveCount(layers + 1);
});
