import { expect, test } from "playwright/test";
import { startWorkspace } from "./workspace";

async function addRectangle(page: import("playwright/test").Page, xOffset = 0): Promise<{x:number;y:number}> {
  const surface = page.locator(".canvas-stage-surface");
  const bounds = await surface.boundingBox();
  if (!bounds) throw new Error("Canvas surface is not visible.");
  const point = { x: bounds.x + bounds.width / 2 + xOffset, y: bounds.y + bounds.height / 2 - 100 };
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Add Rectangle" }).click();
  await page.mouse.click(point.x, point.y);
  await expect(page.getByText("1 selected")).toBeVisible();
  return point;
}

async function ensureInspectorOpen(page: import("playwright/test").Page): Promise<void> {
  const showInspector = page.getByRole("button", { name: "Show inspector panel" });
  if (await showInspector.count()) await showInspector.click();
  await page.getByRole("tab", { name: "Design", exact: true }).click();
}

test("right-click Delete removes a normal canvas element", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await startWorkspace(page, "Blank project");
  const point = await addRectangle(page);
  const visibility = page.getByRole("button", { name: /^Toggle visibility for/ });
  await expect(visibility).toHaveCount(1);
  await expect(page.getByText("1 selected")).toBeVisible();

  await page.mouse.click(point.x + 60, point.y + 40, { button: "right" });
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
  const first = await addRectangle(page, -250);
  const second = await addRectangle(page, 50);
  const visibility = page.getByRole("button", { name: /^Toggle visibility for/ });
  await expect(visibility).toHaveCount(2);

  // Select through the layer tree rather than relying on browser Select All focus.
  const rectangleLayers = page.getByRole("button", { name: "Screen child Rectangle", exact: true });
  await rectangleLayers.nth(0).click();
  await rectangleLayers.nth(1).click({ modifiers: ["Shift"] });
  await expect(page.getByText("2 selected")).toBeVisible();

  // Right-click the second (most recently created) selected widget so the canvas
  // context-menu handler retains the multi-selection instead of selecting a new target.
  await page.mouse.click(second.x + 60, second.y + 40, { button: "right" });
  const menu = page.getByRole("menu", { name: "Element actions" });
  await expect(menu.getByRole("menuitem", { name: "Delete selected element" })).toBeEnabled();
  await menu.getByRole("menuitem", { name: "Delete selected element" }).click();

  await expect(page.getByText("0 selected")).toBeVisible();
  await expect(visibility).toHaveCount(0);
  await expect(menu).toHaveCount(0);
});

test("right-click Delete preserves locked elements in a mixed selection", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await startWorkspace(page, "Blank project");
  await addRectangle(page, -250);
  const second = await addRectangle(page, 50);
  const visibility = page.getByRole("button", { name: /^Toggle visibility for/ });
  const lock = page.getByRole("button", { name: /^Toggle lock for/ });
  await expect(visibility).toHaveCount(2);

  const rectangleLayers = page.getByRole("button", { name: "Screen child Rectangle", exact: true });
  await rectangleLayers.nth(0).click();
  await rectangleLayers.nth(1).click({ modifiers: ["Shift"] });
  await expect(page.getByText("2 selected")).toBeVisible();

  // Layer rows follow the canvas stacking order; lock the first rectangle and
  // leave the second rectangle available for the Delete action.
  await lock.first().click();
  await expect(lock.first()).toHaveAttribute("aria-pressed", "true");
  await expect(lock.last()).toHaveAttribute("aria-pressed", "false");
  // Locking deliberately removes the locked item from the current selection.
  await expect(page.getByText("1 selected")).toBeVisible();

  await page.mouse.click(second.x + 60, second.y + 40, { button: "right" });
  const menu = page.getByRole("menu", { name: "Element actions" });
  await expect(menu.getByRole("menuitem", { name: "Delete selected element" })).toBeEnabled();
  await menu.getByRole("menuitem", { name: "Delete selected element" }).click();

  await expect(visibility).toHaveCount(1);
  await expect(lock).toHaveCount(1);
  await expect(lock).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("0 selected")).toBeVisible();
});

test("right-click Delete removes a widget from the active repeater template", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await startWorkspace(page, "Blank project");
  await ensureInspectorOpen(page);
  const surface = page.locator(".canvas-stage-surface");
  const bounds = await surface.boundingBox();
  if (!bounds) throw new Error("Canvas surface is not visible.");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Add Repeater" }).click();
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await expect(page.getByText("1 selected")).toBeVisible();
  // Selecting the repeater automatically opens its template editing scope;
  // keep the canvas selection so the inspector remains focused on the repeater.
  await expect(page.getByRole("region", { name: "Repeater data" })).toBeVisible();
  // The inspector automatically enters template-edit mode when the repeater is selected.
  const editTemplate = page.getByRole("button", { name: "Stop editing template" });
  await expect(editTemplate).toBeVisible();
  await expect(editTemplate).toHaveAttribute("aria-pressed", "true");
  const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 + 20 };
  await page.getByRole("button", { name: "Add Rectangle" }).click();
  await page.mouse.click(point.x, point.y);
  await expect(page.getByRole("button", { name: /^Toggle visibility for/ })).toHaveCount(2);

  await page.mouse.click(point.x + 60, point.y + 40, { button: "right" });
  const menu = page.getByRole("menu", { name: "Element actions" });
  await menu.getByRole("menuitem", { name: "Delete selected element" }).click();
  await expect(page.getByRole("button", { name: /^Toggle visibility for/ })).toHaveCount(1);
  await expect(page.getByText("0 selected")).toBeVisible();
});

test("right-click Delete removes a widget from the active dynamic-panel state", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await startWorkspace(page, "Blank project");
  await ensureInspectorOpen(page);
  const surface = page.locator(".canvas-stage-surface");
  const bounds = await surface.boundingBox();
  if (!bounds) throw new Error("Canvas surface is not visible.");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /Add Dynamic panel/i }).click();
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await expect(page.getByText("1 selected")).toBeVisible();
  // Selecting the panel automatically opens its active state in the inspector;
  // keep the canvas selection focused on the panel.
  await expect(page.getByRole("region", { name: "Dynamic panel states" })).toBeVisible();
  // The inspector automatically enters the active-state edit mode when the panel is selected.
  const editState = page.getByRole("button", { name: "Stop editing state" });
  await expect(editState).toBeVisible();
  await expect(editState).toHaveAttribute("aria-pressed", "true");
  const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 + 20 };
  await page.getByRole("button", { name: "Add Rectangle" }).click();
  await page.mouse.click(point.x, point.y);
  await expect(page.getByRole("button", { name: /^Toggle visibility for/ })).toHaveCount(2);

  await page.mouse.click(point.x + 60, point.y + 40, { button: "right" });
  const menu = page.getByRole("menu", { name: "Element actions" });
  await menu.getByRole("menuitem", { name: "Delete selected element" }).click();
  await expect(page.getByRole("button", { name: /^Toggle visibility for/ })).toHaveCount(1);
  await expect(page.getByText("0 selected")).toBeVisible();
});
