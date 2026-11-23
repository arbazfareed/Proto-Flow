import { expect, test } from "playwright/test";
import { startWorkspace } from "./workspace";

// B61: New project gave a blank project with no template choice. It now opens a template gallery.
test("B61: New project opens a template gallery", async ({ page }) => {
  await startWorkspace(page, "Blank project");

  await page.getByRole("button", { name: "New project" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Pick a starting point" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Start from Blank project" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Start from Dashboard" })).toBeVisible();

  // Escape closes it without creating anything.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // Picking a template creates the project from it.
  await page.getByRole("button", { name: "New project" }).first().click();
  await page.getByRole("button", { name: "Start from Dashboard" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("New project created")).toBeVisible();
});
