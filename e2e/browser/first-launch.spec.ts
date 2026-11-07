import { expect, test } from "playwright/test";
import { finishFirstLaunch, goOffline } from "./workspace";

test("first launch finishes privacy and all five onboarding steps", async ({ page }) => {
  await goOffline(page);
  await page.goto("/");
  await finishFirstLaunch(page);

  await expect(page.getByText("One design. Every screen.")).toBeVisible();
  await expect(page.getByLabel("Active breakpoint")).toBeVisible();
  await expect(page.getByText("All changes saved")).toBeVisible();

  const savedOnboarding = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("protoflow.onboarding.v1") ?? "null"),
  );
  expect(savedOnboarding).toMatchObject({
    hasCompletedOnboarding: true,
    theme: "light",
    selectedTemplate: "responsive-web",
    deviceTourCompleted: true,
  });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await page.reload();
  await expect(page.getByRole("button", { name: "Quick actions" })).toBeVisible();
  await expect(page.getByRole("heading", {
    name: "From first sketch to clickable prototype.",
  })).toHaveCount(0);

  await page.getByRole("button", { name: "Open privacy and diagnostics settings" }).click();
  const settings = page.getByRole("dialog", { name: "Privacy & diagnostics" });
  await settings.getByRole("button", { name: "Show onboarding again" }).click();
  const onboarding = page.getByRole("dialog", { name: "From first sketch to clickable prototype." });
  await expect(onboarding).toBeVisible();
  const focusable = onboarding.locator(
    "button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])",
  );
  const first = focusable.first();
  await focusable.last().focus();
  await page.keyboard.press("Tab");
  await expect(first).toBeFocused();

  page.once("dialog", (dialog) => dialog.accept());
  await onboarding.getByRole("button", { name: /Skip onboarding/ }).click();
  await expect(onboarding).toHaveCount(0);
});
