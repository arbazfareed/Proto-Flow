import { expect, test } from "playwright/test";
import { startWorkspace } from "./workspace";

test("adds a custom responsive breakpoint and makes it selectable", async ({ page }) => {
  await startWorkspace(page, "Responsive web");
  await page.getByRole("button", { name: "Add breakpoint" }).click();

  const manager = page.getByRole("dialog", { name: "Manage breakpoints" });
  await expect(manager).toBeVisible();
  await manager.getByRole("button", { name: "Custom" }).click();
  const customBreakpoint = manager.getByRole("group", { name: "Custom" });
  await customBreakpoint.getByLabel("Name").fill("Compact");
  await manager.getByRole("button", { name: "Save breakpoints" }).click();

  const breakpoint = page.getByLabel("Active breakpoint");
  await expect(breakpoint.locator("option", { hasText: "Compact" })).toHaveCount(1);
  await breakpoint.selectOption({
    label: await breakpoint.locator("option", { hasText: "Compact" }).textContent() ?? "",
  });
  await expect(breakpoint.locator("option:checked")).toContainText("Compact");
});
