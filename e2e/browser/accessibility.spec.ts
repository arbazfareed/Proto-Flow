import { expect, test } from "playwright/test";
import { expectAccessible } from "./accessibility";
import { startWorkspace } from "./workspace";

test("workspace, help, device picker, notes, flow, and history meet WCAG 2.1 AA", async ({
  page,
}) => {
  await startWorkspace(page, "Responsive web");
  await expectAccessible(page, "workspace");
  const initialTheme = await page.locator("html").getAttribute("data-theme") ?? "light";
  await page.locator("html").evaluate((root) => root.setAttribute("data-theme", "dark"));
  await expectAccessible(page, "dark-theme workspace");
  await page.locator("html").evaluate((root, theme) => root.setAttribute("data-theme", theme), initialTheme);

  await page.getByRole("button", { name: "Add screen" }).click();
  const devicePicker = page.getByRole("dialog", { name: "Choose a device" });
  await expect(devicePicker).toBeVisible();
  await expectAccessible(page, "device picker");
  await page.keyboard.press("Escape");
  await expect(devicePicker).not.toBeVisible();

  await page.getByRole("button", { name: "Open widget notes manager" }).click();
  const notes = page.getByRole("dialog", { name: "Widget notes" });
  await expectAccessible(page, "widget notes");
  await notes.getByRole("button", { name: "Close widget notes" }).click();

  await page.getByRole("button", { name: "Flow", exact: true }).click();
  await expectAccessible(page, "screen flow");
  await page.getByRole("button", { name: "Design", exact: true }).click();

  await page.getByRole("button", { name: "Quick actions" }).click();
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expectAccessible(page, "command palette");
  await page.keyboard.press("Escape");
  await expect(palette).not.toBeVisible();

  await page.getByRole("button", { name: "Help & docs" }).click();
  const help = page.getByRole("dialog", { name: "Help & documentation" });
  await expectAccessible(page, "help panel");
  await help.getByRole("button", { name: "Close help" }).click();

  await page.getByRole("button", { name: "Quick actions" }).click();
  await page.getByRole("combobox", { name: "Filter commands" }).fill("Version History");
  await page.getByRole("option", { name: "Version History" }).press("Enter");
  const history = page.getByRole("dialog", { name: "Version history" });
  await expectAccessible(page, "version history");

  await page.emulateMedia({ reducedMotion: "reduce" });
  const reducedMotion = await page.locator("body").evaluate((body) => {
    const probe = document.createElement("div");
    probe.className = "icon-button";
    body.append(probe);
    const style = getComputedStyle(probe);
    const result = {
      animationDuration: style.animationDuration,
      transitionDuration: style.transitionDuration,
    };
    probe.remove();
    return result;
  });
  expect(reducedMotion.animationDuration.split(",").every((duration) => parseFloat(duration) <= 0.01))
    .toBe(true);
  expect(reducedMotion.transitionDuration.split(",").every((duration) => parseFloat(duration) <= 0.01))
    .toBe(true);

  await page.setViewportSize({ width: 320, height: 800 });
  const pageWidth = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(pageWidth.scrollWidth).toBeLessThanOrEqual(pageWidth.clientWidth);
});

test("dynamic panel state editor meets WCAG 2.1 AA", async ({ page }) => {
  await startWorkspace(page, "Form flow");
  const panelRow = page.locator(".layer-row").filter({ hasText: "Step 1: Details" }).first();
  await panelRow.locator(".layer-select").click();
  await expect(page.getByRole("region", { name: "Dynamic panel states" })).toBeVisible();
  await expectAccessible(page, "dynamic panel state inspector");
});

test("repeater data editor meets WCAG 2.1 AA", async ({ page }) => {
  await startWorkspace(page, "Data table");
  await page.getByRole("searchbox", { name: "Search layers" }).fill("Team members");
  const repeaterRow = page.locator(".layer-row").filter({
    has: page.locator(".layer-name", { hasText: /^Team members$/ }),
  });
  await repeaterRow.locator(".layer-select").click();
  await expect(page.getByRole("region", { name: "Repeater data" })).toBeVisible();
  await expectAccessible(page, "repeater data inspector");
});
