import { expect, test } from "playwright/test";
import { startWorkspace } from "./workspace";

// B62: in the browser, Ctrl+S used to download another .pflow file every time.
// It now saves in the browser and never downloads; "Download .pflow" is the file copy.
test("B62: Ctrl+S saves in the browser without a download; Download .pflow still downloads", async ({ page }) => {
  await startWorkspace(page, "Blank project");
  let downloads = 0;
  page.on("download", () => { downloads += 1; });

  const name = page.locator("#project-name");
  await name.fill("Saved in browser");
  await name.press("Enter");
  await expect(page.getByText("Unsaved changes")).toBeVisible();

  await page.keyboard.press("Control+s");
  await expect(page.getByText(/Saved in this browser/)).toBeVisible();
  await expect(page.locator(".save-state-label")).toHaveText("All changes saved");
  await page.keyboard.press("Control+s");
  await page.waitForTimeout(500);
  expect(downloads).toBe(0);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download .pflow project" }).click();
  expect((await downloadPromise).suggestedFilename()).toBe("Saved in browser.pflow");
});
