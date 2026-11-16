import { expect, test } from "playwright/test";
import { startWorkspace } from "./workspace";

test("B84: deleting a linked screen asks where its links should go, and never leaves them broken", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await startWorkspace(page, "Blank project");
  await page.getByRole("button", { name: "Create Desktop screen" }).click();
  await page.getByRole("button", { name: "Previous screen" }).click();
  const screenItem = page.locator("[data-screen-index]").first();
  const screenCount = () => page.evaluate(() => document.querySelectorAll("[data-screen-index]").length);
  void screenCount;

  // Screen 1: a button that links to the second screen.
  await page.getByRole("button", { name: "Add Button" }).click();
  const stage = page.locator("canvas").first();
  const bounds = await stage.boundingBox();
  if (!bounds) throw new Error("The canvas stage is not visible.");
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.getByRole("tab", { name: "Interactions" }).click();
  const rules = page.getByRole("region", { name: "Interaction rules" });
  await rules.getByRole("button", { name: "Add rule" }).click();
  const target = rules.getByRole("combobox", { name: "Action target" });
  const second = target.locator("option").filter({ hasNotText: /Choose|Screen 1/ }).first();
  const secondName = (await second.textContent())?.trim() ?? "";
  await target.selectOption((await second.getAttribute("value")) ?? "");
  await page.waitForTimeout(400);

  // Delete the second screen: the app asks first, and Cancel keeps it.
  await page.getByRole("button", { name: "Next screen" }).click();
  await expect(screenItem).toContainText(secondName);
  await screenItem.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete screen" }).click();
  const dialog = page.getByRole("alertdialog", { name: `Delete “${secondName}”?` });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("1 link goes to this screen");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(screenItem).toContainText(secondName);

  // Delete it, sending the link to Screen 1.
  await screenItem.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete screen" }).click();
  await dialog.getByRole("combobox", { name: "Send those links to" }).selectOption({ label: "Screen 1" });
  await dialog.getByRole("button", { name: "Delete screen" }).click();
  await expect(screenItem).toContainText("Screen 1");
  await expect(page.getByRole("button", { name: "Next screen" })).toBeDisabled();

  await page.getByRole("button", { name: "Screen child Button" }).click();
  await page.getByRole("tab", { name: "Interactions" }).click();
  await expect(rules.getByRole("combobox", { name: "Action target" }).locator("option:checked")).toHaveText("Screen 1");
  await expect(rules.getByText(/must target an existing screen|Choose a target/)).toHaveCount(0);
});
