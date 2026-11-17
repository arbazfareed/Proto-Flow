import { expect, test } from "playwright/test";
import { startWorkspace } from "./workspace";

// B94: the Screens panel showed only the current screen until you found the small "All"
// button, so a project with several screens looked like it had one. It now lists every
// screen with its thumbnail by default, and remembers if you switch to "Current".
test("B94: the Screens panel lists every screen with a thumbnail by default", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await startWorkspace(page, "Blank project");
  for (let round = 0; round < 2; round += 1) {
    await page.getByRole("button", { name: "Add screen" }).click();
    const picker = page.getByRole("dialog", { name: "Choose a device" });
    await picker.getByRole("textbox", { name: "Search devices" }).fill("iPhone 15");
    await picker.getByRole("button", { name: /^iPhone 15 393/ }).click();
    await expect(picker).not.toBeVisible();
  }

  const list = page.getByRole("listbox", { name: "Screens" });
  const options = list.getByRole("option");
  await expect(options).toHaveCount(3);
  await expect(list.locator(".screen-thumbnail")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Show current screen only" })).toHaveAttribute("aria-pressed", "true");

  // Clicking a screen in the list opens it; Previous/Next still work.
  await options.nth(0).click();
  await expect(options.nth(0)).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Next screen" }).click();
  await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");

  // "Current" narrows the list, and the choice survives a reload.
  await page.getByRole("button", { name: "Show current screen only" }).click();
  await expect(options).toHaveCount(1);
  expect(await page.evaluate(() => window.localStorage.getItem("protoflow.screens.showAll"))).toBe("false");
  await page.getByRole("button", { name: "Show all screens" }).click();
  await expect(options).toHaveCount(3);
  expect(await page.evaluate(() => window.localStorage.getItem("protoflow.screens.showAll"))).toBe("true");
});
