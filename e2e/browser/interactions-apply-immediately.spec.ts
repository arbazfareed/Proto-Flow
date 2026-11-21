import { expect, test, type Locator } from "playwright/test";
import { startWorkspace } from "./workspace";

/** Pixels of the selected label that do not fit inside the closed menu (0 = fully readable). */
async function clippedPixels(select: Locator): Promise<number> {
  return select.evaluate((element) => {
    const menu = element as HTMLSelectElement;
    const style = getComputedStyle(menu);
    const context = document.createElement("canvas").getContext("2d");
    if (!context) return 0;
    context.font = style.font;
    const label = menu.selectedOptions[0]?.text ?? "";
    const arrowAndPadding = 22 + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    return Math.max(0, Math.ceil(context.measureText(label).width + arrowAndPadding - menu.clientWidth));
  });
}

test("B59: interaction rules work in Preview without a Save click, and their menus are readable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await startWorkspace(page, "Blank project");
  await page.getByRole("button", { name: "Create Desktop screen" }).click();
  await page.getByRole("button", { name: "Previous screen" }).click();
  await page.getByRole("button", { name: "Add Button" }).click();
  const stage = page.locator("canvas").first();
  const bounds = await stage.boundingBox();
  if (!bounds) throw new Error("The canvas stage is not visible.");
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);

  await page.getByRole("tab", { name: "Interactions" }).click();
  const rules = page.getByRole("region", { name: "Interaction rules" });
  await rules.getByRole("button", { name: "Add rule" }).click();
  await expect(page.getByRole("button", { name: /Save interactions/ })).toHaveCount(0);
  await expect(rules.getByText(/Not active yet/)).toBeVisible();

  const actionType = rules.getByRole("combobox", { name: "Action type" });
  const actionTarget = rules.getByRole("combobox", { name: "Action target" });
  // The unfinished field is outlined and named in the note (B51).
  await expect(actionTarget).toHaveAttribute("aria-invalid", "true");
  await expect(rules.getByText(/choose a target in the field outlined in red/)).toBeVisible();
  expect(await clippedPixels(actionType)).toBe(0);
  expect(await clippedPixels(actionTarget)).toBe(0);

  const destination = await actionTarget.locator("option").filter({ hasNotText: /Choose|Screen 1/ }).first();
  const destinationId = await destination.getAttribute("value");
  await actionTarget.selectOption(destinationId ?? "");
  await expect(actionTarget).not.toHaveAttribute("aria-invalid", "true");
  expect(await clippedPixels(actionTarget)).toBe(0);
  await expect(rules.getByText(/Not active yet/)).toHaveCount(0);
  await expect(rules.getByText("Changes apply automatically. Undo (Ctrl+Z) reverts them.")).toBeVisible();

  // No Save click: Preview runs the rule straight away.
  const previewPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview" }).click();
  const preview = await previewPromise;
  const previewScreen = preview.getByLabel("Preview screen", { exact: true });
  const startId = await previewScreen.locator("option").nth(0).getAttribute("value");
  await previewScreen.selectOption(startId ?? "");
  expect(startId).not.toBe(destinationId);
  await preview.getByRole("button", { name: "Button" }).first().click();
  await expect(previewScreen).toHaveValue(destinationId ?? "");
  await preview.close();

  // The rule is part of the project: it is still there after selecting something else and back.
  await page.keyboard.press("Escape");
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.getByRole("tab", { name: "Interactions" }).click();
  await expect(page.getByRole("combobox", { name: "Action target" })).toHaveValue(destinationId ?? "");
});
