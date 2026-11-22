import { expect, test } from "playwright/test";
import { startWorkspace } from "./workspace";

// B47: Hide from the canvas. A hidden widget cannot be clicked, so it leaves the selection, and the
// Layers panel shows it as hidden.
test("B47: Ctrl+Shift+H and the right-click Hide hide the selected widget", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await startWorkspace(page, "Blank project");
  const box = await page.locator(".canvas-stage-surface").boundingBox();
  if (!box) throw new Error("No canvas.");
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const visibility = page.getByRole("button", { name: /^Toggle visibility for/ });

  await page.getByRole("button", { name: "Add Rectangle" }).click();
  await page.mouse.click(centre.x, centre.y);
  await expect(page.getByText("1 selected")).toBeVisible();
  await expect(visibility).toHaveAttribute("aria-pressed", "false");

  await page.keyboard.press("Control+Shift+h");
  await expect(page.getByText("0 selected")).toBeVisible();
  await expect(visibility).toHaveAttribute("aria-pressed", "true");

  // Show it again from the Layers panel, then hide it from the right-click menu.
  await visibility.click();
  await expect(visibility).toHaveAttribute("aria-pressed", "false");
  await page.mouse.click(centre.x, centre.y);
  await expect(page.getByText("1 selected")).toBeVisible();
  await page.mouse.click(centre.x, centre.y, { button: "right" });
  await page.getByRole("menuitem", { name: "Hide", exact: true }).click();
  await expect(page.getByText("0 selected")).toBeVisible();
  await expect(visibility).toHaveAttribute("aria-pressed", "true");
});
