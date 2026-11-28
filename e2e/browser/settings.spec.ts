import { expect, test } from "playwright/test";
import { startWorkspace } from "./workspace";

test.describe("Top-bar Settings", () => {
  test("shows a gear, opens settings, switches sections, and persists theme and privacy choices", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("protoflow.theme.v1", "system");
    });
    await startWorkspace(page, "Blank project");

    const settingsButton = page.getByRole("button", { name: "Open settings" });
    await expect(settingsButton).toBeVisible();
    await expect(settingsButton).toHaveAttribute("title", "Settings");
    await expect(settingsButton.locator("svg.lucide-settings")).toBeVisible();
    await settingsButton.click();

    const dialog = page.getByRole("dialog", { name: "Settings" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: /General/ })).toHaveAttribute("aria-current", "page");

    await dialog.getByRole("combobox", { name: "Workspace appearance" }).selectOption("dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect.poll(() => page.evaluate(() => localStorage.getItem("protoflow.theme.v1"))).toBe("dark");

    await dialog.getByRole("button", { name: /^Privacy$/ }).click();
    await dialog.getByRole("checkbox", { name: /Send anonymous feature usage/ }).check();
    await dialog.getByRole("button", { name: "Save choices" }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("protoflow.privacy.v1") ?? "{}").anonymousTelemetry)).toBe(true);

    await settingsButton.click();
    await dialog.getByRole("button", { name: /^About$/ }).click();
    await expect(dialog.getByText("Version")).toBeVisible();
    await dialog.getByRole("button", { name: "Close settings" }).click();
    await expect(dialog).toBeHidden();
  });

  test("keeps the gear visible and usable at a narrow desktop viewport", async ({ page }) => {
    await startWorkspace(page, "Blank project");
    await page.setViewportSize({ width: 820, height: 900 });
    const settingsButton = page.getByRole("button", { name: "Open settings" });
    await expect(settingsButton).toBeVisible();
    await expect(settingsButton).toBeInViewport();
    await settingsButton.click();
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  });
});
