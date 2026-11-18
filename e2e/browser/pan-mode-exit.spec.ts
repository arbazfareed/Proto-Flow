import { expect, test } from "playwright/test";
import { startWorkspace } from "./workspace";

// B3: after clicking the hand tool, nothing got you out except clicking the hand again.
// Escape and V now leave it, typing h does not turn it on, and a Select button sits beside the hand.
test("B3: Escape, V and the Select button leave the hand tool; typing h never turns it on", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await startWorkspace(page, "Blank project");
  const surface = page.locator(".canvas-stage-surface");
  const hand = page.getByRole("button", { name: /canvas pan mode|Pan canvas/ });
  const select = page.getByRole("button", { name: "Select tool" });

  await expect(select).toHaveAttribute("aria-pressed", "true");
  await hand.click();
  await expect(surface).toHaveClass(/is-pan-mode/);
  await expect(page.getByText(/Hand tool · press Esc/)).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(surface).not.toHaveClass(/is-pan-mode/);
  await expect(select).toHaveAttribute("aria-pressed", "true");

  await page.keyboard.press("h");
  await expect(surface).not.toHaveClass(/is-pan-mode/);
  await hand.click();
  await expect(surface).toHaveClass(/is-pan-mode/);
  await page.keyboard.press("v");
  await expect(surface).not.toHaveClass(/is-pan-mode/);

  await hand.click();
  await expect(surface).toHaveClass(/is-pan-mode/);
  await select.click();
  await expect(surface).not.toHaveClass(/is-pan-mode/);
});
