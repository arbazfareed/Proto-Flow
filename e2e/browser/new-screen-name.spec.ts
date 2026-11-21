import { expect, test } from "playwright/test";
import { startWorkspace } from "./workspace";

// B60: a new screen was named after its device ("Desktop 1440 x 900"). It is now "Screen 2", "Screen 3", ...
test("B60: new screens are named Screen 2 and Screen 3", async ({ page }) => {
  await startWorkspace(page, "Blank project");

  await page.getByRole("button", { name: "Create Desktop screen" }).click();
  await expect(page.getByText("Screen 2", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "Create Mobile screen" }).click();
  await expect(page.getByText("Screen 3", { exact: true }).first()).toBeVisible();
});
