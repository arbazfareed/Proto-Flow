import { expect, test } from "playwright/test";
import { startWorkspace } from "./workspace";

// B69: the Preview window had the same page title as the editor, so they looked identical in the tab or taskbar list.
test("B69: the Preview window title says Preview and the editor title does not", async ({ page }) => {
  await startWorkspace(page, "Blank project");
  await expect(page).toHaveTitle("ProtoFlow");

  const previewPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview" }).click();
  const preview = await previewPromise;
  await expect(preview).toHaveTitle(/ProtoFlow Preview$/);
  await expect(page).toHaveTitle("ProtoFlow");
  await preview.close();
});
