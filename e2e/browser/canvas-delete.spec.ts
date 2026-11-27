import { expect, test } from "playwright/test";
import { startWorkspace } from "./workspace";

async function addRectangle(page: import("playwright/test").Page, xOffset = 0): Promise<{x:number;y:number}> {
  const surface = page.locator(".canvas-stage-surface");
  const bounds = await surface.boundingBox();
  if (!bounds) throw new Error("Canvas surface is not visible.");
  const point = { x: bounds.x + bounds.width / 2 + xOffset, y: bounds.y + bounds.height / 2 };
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Add Rectangle" }).click();
  await page.mouse.click(point.x, point.y);
  await expect(page.getByText("1 selected")).toBeVisible();
  return point;
}

test("right-click Delete removes a normal canvas element", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await startWorkspace(page, "Blank project");
  const point = await addRectangle(page);
  const visibility = page.getByRole("button", { name: /^Toggle visibility for/ });
  await expect(visibility).toHaveCount(1);
  await expect(page.getByText("1 selected")).toBeVisible();

  await page.mouse.click(point.x, point.y, { button: "right" });
  const menu = page.getByRole("menu", { name: "Element actions" });
  await expect(menu.getByRole("menuitem", { name: "Delete selected element" })).toBeEnabled();
  await menu.getByRole("menuitem", { name: "Delete selected element" }).click();

  await expect(page.getByText("0 selected")).toBeVisible();
  await expect(visibility).toHaveCount(0);
  await expect(menu).toHaveCount(0);
});

test("right-click Delete removes all selected elements together", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await startWorkspace(page, "Blank project");
  const first = await addRectangle(page, -90);
  const second = await addRectangle(page, 90);
  const visibility = page.getByRole("button", { name: /^Toggle visibility for/ });
  await expect(visibility).toHaveCount(2);

  await page.keyboard.press("Control+a");
  await expect(page.getByText("2 selected")).toBeVisible();
  await page.mouse.click(first.x, first.y, { button: "right" });
  const menu = page.getByRole("menu", { name: "Element actions" });
  await menu.getByRole("menuitem", { name: "Delete selected element" }).click();

  await expect(page.getByText("0 selected")).toBeVisible();
  await expect(visibility).toHaveCount(0);
  await expect(menu).toHaveCount(0);
  void second;
});

test("right-click Delete preserves locked elements in a mixed selection", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await startWorkspace(page, "Blank project");
  const first = await addRectangle(page, -90);
  const second = await addRectangle(page, 90);
  const visibility = page.getByRole("button", { name: /^Toggle visibility for/ });
  const lock = page.getByRole("button", { name: /^Toggle lock for/ });
  await expect(visibility).toHaveCount(2);
  await page.keyboard.press("Control+a");
  await expect(page.getByText("2 selected")).toBeVisible();

  await lock.first().click();
  await expect(lock.first()).toHaveAttribute("aria-pressed", "true");
  await expect(visibility).toHaveCount(2);

  // The remaining unlocked item is still selected; deleting it must not remove the locked one.
  await page.mouse.click(second.x, second.y, { button: "right" });
  const menu = page.getByRole("menu", { name: "Element actions" });
  await expect(menu.getByRole("menuitem", { name: "Delete selected element" })).toBeEnabled();
  await menu.getByRole("menuitem", { name: "Delete selected element" }).click();

  await expect(visibility).toHaveCount(1);
  await expect(lock).toHaveCount(1);
  await expect(lock).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("0 selected")).toBeVisible();
  void first;
});

test("right-click Delete removes a widget from the active repeater template", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await startWorkspace(page, "Blank project");
  const surface = page.locator(".canvas-stage-surface");
  const bounds = await surface.boundingBox();
  if (!bounds) throw new Error("Canvas surface is not visible.");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Add Repeater" }).click();
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await expect(page.getByText("1 selected")).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit row template" })).toBeVisible();
  await page.getByRole("button", { name: "Edit row template" }).click();
  const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 + 20 };
  await page.getByRole("button", { name: "Add Rectangle" }).click();
  await page.mouse.click(point.x, point.y);
  await expect(page.getByRole("button", { name: /^Toggle visibility for/ })).toHaveCount(2);

  await page.mouse.click(point.x, point.y, { button: "right" });
  const menu = page.getByRole("menu", { name: "Element actions" });
  await menu.getByRole("menuitem", { name: "Delete selected element" }).click();
  await expect(page.getByRole("button", { name: /^Toggle visibility for/ })).toHaveCount(1);
  await expect(page.getByText("0 selected")).toBeVisible();
});

test("right-click Delete removes a widget from the active dynamic-panel state", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await startWorkspace(page, "Blank project");
  const surface = page.locator(".canvas-stage-surface");
  const bounds = await surface.boundingBox();
  if (!bounds) throw new Error("Canvas surface is not visible.");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /Add Dynamic panel/i }).click();
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await expect(page.getByText("1 selected")).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit active state" })).toBeVisible();
  await page.getByRole("button", { name: "Edit active state" }).click();
  const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 + 20 };
  await page.getByRole("button", { name: "Add Rectangle" }).click();
  await page.mouse.click(point.x, point.y);
  await expect(page.getByRole("button", { name: /^Toggle visibility for/ })).toHaveCount(2);

  await page.mouse.click(point.x, point.y, { button: "right" });
  const menu = page.getByRole("menu", { name: "Element actions" });
  await menu.getByRole("menuitem", { name: "Delete selected element" }).click();
  await expect(page.getByRole("button", { name: /^Toggle visibility for/ })).toHaveCount(1);
  await expect(page.getByText("0 selected")).toBeVisible();
});
