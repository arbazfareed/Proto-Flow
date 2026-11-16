import { expect, test } from "playwright/test";
import packageJson from "../../package.json" with { type: "json" };
import { startWorkspace } from "./workspace";

test("the command palette shows the app version, not an internal phase label", async ({ page }) => {
  await startWorkspace(page, "Blank project");
  await page.keyboard.press("Control+k");
  const footer = page.locator(".palette-footer");
  await expect(footer).toBeVisible();
  // B63: it used to read "PROTO FLOW · PHASE 1".
  await expect(footer).toContainText(`ProtoFlow ${packageJson.version}`);
  await expect(page.getByText(/phase\s*1/i)).toHaveCount(0);
});
