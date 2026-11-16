import { expect, test } from "playwright/test";
import { startWorkspace } from "./workspace";

for (const width of [1280, 1440, 1920]) {
  test(`B58: Share and Collaborate are visible at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await startWorkspace(page, "Blank project");
    const share = page.getByRole("button", { name: "Share", exact: true });
    await expect(share).toBeVisible();
    await expect(share).toHaveText(/Share/);
    await expect(page.getByRole("button", { name: "Collaborate", exact: true })).toBeVisible();
    await share.click();
    await expect(page.getByRole("heading", { name: "Publish to cloud" })).toBeVisible();
  });
}

test("B58: Share, Collaborate and the exports are in Quick actions", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await startWorkspace(page, "Blank project");
  await page.getByRole("button", { name: "Quick actions" }).click();
  const filter = page.getByRole("combobox", { name: "Filter commands" });
  for (const name of ["Share Link", "Collaborate", "Export HTML Bundle", "Export React Code"]) {
    await filter.fill(name);
    await expect(page.getByRole("option", { name })).toBeVisible();
  }
});
