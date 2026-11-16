import { expect, test } from "playwright/test";
import { startWorkspace } from "./workspace";

test("B82 + B83: a touch screen works with a mouse in Preview, and clicking text on a row runs the row's rule", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await startWorkspace(page, "Blank project");
  await page.getByRole("button", { name: "Create Desktop screen" }).click();
  await page.getByRole("button", { name: "Previous screen" }).click();
  // The screen only accepts touch, as phone screens did before this fix.
  await page.getByLabel("Screen input mode").selectOption("touch");

  // A "row": a rectangle with a navigate rule, and plain text drawn on top of it.
  await page.getByRole("button", { name: "Add Rectangle" }).click();
  const stage = page.locator("canvas").first();
  const bounds = await stage.boundingBox();
  if (!bounds) throw new Error("The canvas stage is not visible.");
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.getByRole("tab", { name: "Interactions" }).click();
  const rules = page.getByRole("region", { name: "Interaction rules" });
  await rules.getByRole("button", { name: "Add rule" }).click();
  // B82: the default trigger works on a touch screen.
  await expect(page.getByLabel("Trigger event")).toHaveValue("onClick");
  await expect(page.getByLabel("Trigger event").locator("option:checked")).toHaveText("Click");
  const target = rules.getByRole("combobox", { name: "Action target" });
  const destination = await target.locator("option").filter({ hasNotText: /Choose|Screen 1/ }).first().getAttribute("value");
  await target.selectOption(destination ?? "");
  await expect(rules.getByText(/Not active yet/)).toHaveCount(0);
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "Add Text" }).first().click();
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  await page.mouse.move(centerX - 30, centerY - 8);
  await page.mouse.down();
  await page.mouse.move(centerX + 30, centerY + 8, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.type("Alex");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  const previewPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview" }).click();
  const preview = await previewPromise;
  const previewScreen = preview.getByLabel("Preview screen", { exact: true });
  const start = await previewScreen.locator("option").nth(0).getAttribute("value");
  await previewScreen.selectOption(start ?? "");
  expect(start).not.toBe(destination);
  const text = preview.locator('.preview-widget[data-widget-type="text"]').first();
  const row = preview.locator('.preview-widget[data-widget-type="rectangle"]').first();
  const textBox = await text.boundingBox();
  const rowBox = await row.boundingBox();
  if (!textBox || !rowBox) throw new Error("Preview widgets are not visible.");
  // A point inside both, where the text sits on top of the row.
  const x = (Math.max(textBox.x, rowBox.x) + Math.min(textBox.x + textBox.width, rowBox.x + rowBox.width)) / 2;
  const y = (Math.max(textBox.y, rowBox.y) + Math.min(textBox.y + textBox.height, rowBox.y + rowBox.height)) / 2;
  expect(await preview.evaluate(([px, py]) =>
    document.elementFromPoint(px, py)?.closest(".preview-widget")?.getAttribute("data-widget-type"), [x, y]))
    .toBe("text");

  // B83 + B82: a mouse click on the text (no rule of its own) runs the row's rule.
  await preview.mouse.click(x, y);
  await expect(previewScreen).toHaveValue(destination ?? "");
  await preview.close();
});
