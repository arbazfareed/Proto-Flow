import { expect, test } from "playwright/test";
import { finishFirstLaunch, goOffline } from "./workspace";

test("first launch finishes privacy and all five onboarding steps", async ({ page }) => {
  await goOffline(page);
  await page.goto("/");
  await finishFirstLaunch(page);

  await expect(page.getByText("One design. Every screen.")).toBeVisible();
  await expect(page.getByLabel("Active breakpoint")).toBeVisible();
  await expect(page.getByText("All changes saved")).toBeVisible();
});
