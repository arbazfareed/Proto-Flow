import { expect, test, type Page } from "playwright/test";
import { startWorkspace } from "./workspace";

async function place(page: Page, dx: number) {
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Add Rectangle", exact: true }).first().click();
  const box = await page.locator(".canvas-stage-surface").boundingBox();
  if (!box) throw new Error("No canvas.");
  await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 - 100);
  await expect(page.getByText("1 selected")).toBeVisible();
}

test("B85 + B86: responsive rules work on several widgets, and pins apply to every size by default", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await startWorkspace(page, "Blank project");
  await place(page, -250);
  await place(page, 50);

  // B85: select both; the Responsive tab is available and edits both.
  const layers = page.getByRole("button", { name: "Screen child Rectangle", exact: true });
  await layers.nth(0).click();
  await layers.nth(1).click({ modifiers: ["Shift"] });
  await expect(page.getByText("2 selected")).toBeVisible();
  const responsiveTab = page.getByRole("tab", { name: "Responsive" });
  await expect(responsiveTab).toBeEnabled();
  await responsiveTab.click();
  const panel = page.getByRole("region", { name: "Responsive widget rules" });
  await expect(panel.getByText("2 widgets ·", { exact: false })).toBeVisible();

  // B86: "All screen sizes" is the default and says so.
  await expect(panel.getByRole("radio", { name: "All screen sizes" })).toBeChecked();
  await panel.getByLabel("Horizontal").selectOption("stretch");
  await expect(panel.getByLabel("Horizontal")).toHaveValue("stretch");

  // At another size, each widget shows the same pins, still marked as all sizes.
  const breakpoint = page.getByLabel("Active breakpoint");
  const tablet = await breakpoint.locator("option", { hasText: "Tablet" }).first().getAttribute("value");
  await breakpoint.selectOption(tablet ?? "");
  await page.getByRole("button", { name: "Screen child Rectangle", exact: true }).first().click();
  await expect(page.getByText("1 selected")).toBeVisible();
  await responsiveTab.click();
  await expect(panel.getByLabel("Horizontal")).toHaveValue("stretch");
  await expect(panel.getByRole("radio", { name: "All screen sizes" })).toBeChecked();
  await expect(panel.getByText(/Tablet · \d+ × \d+/)).toBeVisible();

  // Choosing "Only Tablet" keeps the change to this size.
  await panel.getByRole("radio", { name: /^Only Tablet/ }).check();
  await panel.getByLabel("Horizontal").selectOption("center");
  const desktop = await breakpoint.locator("option", { hasText: "Desktop" }).first().getAttribute("value");
  await breakpoint.selectOption(desktop ?? "");
  await page.getByRole("button", { name: "Screen child Rectangle", exact: true }).first().click();
  await responsiveTab.click();
  await expect(panel.getByLabel("Horizontal")).toHaveValue("stretch");
});
