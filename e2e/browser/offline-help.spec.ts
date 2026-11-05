import { expect, test } from "playwright/test";
import { startWorkspace } from "./workspace";

test("F1 opens searchable offline help and stores article feedback locally", async ({ page }) => {
  await startWorkspace(page, "Blank project");
  await page.keyboard.press("F1");

  const help = page.getByRole("dialog", { name: "Help & documentation" });
  await expect(help).toBeVisible();
  await expect(help.getByText("Search and read offline")).toBeVisible();
  await page.getByRole("searchbox", { name: "Search help articles" }).fill("device frames");
  await help.getByText("Device frames overview", { exact: true }).click();
  await expect(help.getByRole("heading", { name: "Device frames overview" })).toBeVisible();
  await expect(help.getByText("available offline")).toBeVisible();
  await help.getByRole("button", { name: "Yes" }).click();
  await expect(help.getByRole("button", { name: "Yes" })).toHaveAttribute("aria-pressed", "true");
});
