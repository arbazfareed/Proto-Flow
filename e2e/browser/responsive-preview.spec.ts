import { expect, test } from "playwright/test";
import { startWorkspace } from "./workspace";

test("responsive workspace switches breakpoints and previews multiple devices", async ({ page }) => {
  await startWorkspace(page, "Responsive web");

  const breakpoint = page.getByLabel("Active breakpoint");
  const mobile = breakpoint.locator("option", { hasText: "Mobile" });
  await expect(mobile).toHaveCount(1);
  await breakpoint.selectOption(await mobile.getAttribute("value") ?? "");
  await expect(breakpoint.locator("option:checked")).toContainText("Mobile");

  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview" }).click();
  const preview = await popupPromise;
  await expect(preview.getByLabel("Preview layout")).toBeVisible();
  await preview.getByLabel("Device preset").selectOption("iphone-15");
  await expect(preview.getByLabel("Device preset")).toHaveValue("iphone-15");
  await preview.getByLabel("Preview layout").selectOption({ label: "Desktop · tablet · mobile" });
  await expect(preview.getByLabel("Preview layout")).toHaveValue("columns");
  await expect(preview.locator("article.preview-frame-card")).toHaveCount(3);
  await expect(preview.getByText("3 devices", { exact: true })).toBeVisible();
  await preview.close();
});
