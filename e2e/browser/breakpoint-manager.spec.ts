import { expect, test } from "playwright/test";
import { startWorkspace } from "./workspace";

test("adds, edits, selects, and removes a custom responsive breakpoint", async ({ page }) => {
  await startWorkspace(page, "Responsive web");
  await page.getByRole("button", { name: "Add breakpoint" }).click();

  const manager = page.getByRole("dialog", { name: "Manage breakpoints" });
  await expect(manager).toBeVisible();
  await manager.getByRole("button", { name: "Custom" }).click();
  const customBreakpoint = manager.getByRole("group", { name: "Custom" });
  await customBreakpoint.getByLabel("Canvas width").fill("1500");
  await customBreakpoint.getByLabel("Canvas height").fill("1000");
  await customBreakpoint.getByLabel("Name").fill("Extra wide");
  await manager.getByRole("button", { name: "Save breakpoints" }).click();

  const breakpoint = page.getByLabel("Active breakpoint");
  const extraWide = breakpoint.locator("option", { hasText: "Extra wide" });
  await expect(extraWide).toHaveCount(1);
  await expect(extraWide).toContainText("1500 × 1000");
  await breakpoint.selectOption(await extraWide.getAttribute("value") ?? "");
  await expect(breakpoint.locator("option:checked")).toContainText("Extra wide");

  await breakpoint.selectOption("mobile");
  await page.getByRole("button", { name: "Add breakpoint" }).click();
  const editedBreakpoint = page.getByRole("dialog", { name: "Manage breakpoints" })
    .getByRole("group", { name: "Extra wide" });
  await editedBreakpoint.getByRole("button", { name: "Remove Extra wide breakpoint" }).click();
  await page.getByRole("dialog", { name: "Manage breakpoints" })
    .getByRole("button", { name: "Save breakpoints" }).click();
  await expect(breakpoint.locator("option", { hasText: "Extra wide" })).toHaveCount(0);
  await expect(breakpoint.locator("option:checked")).toContainText("Mobile");
});
