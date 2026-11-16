import { expect, test, type Page } from "playwright/test";
import { startWorkspace } from "./workspace";

const viewport = (page: Page) => page.getByRole("combobox", { name: "Active breakpoint" });
const selectedViewport = (page: Page) => viewport(page).locator("option:checked");

test("a new mobile screen opens at the mobile viewport, not desktop", async ({ page }) => {
  await startWorkspace(page, "Blank project");
  await expect(selectedViewport(page)).toHaveText(/^Desktop/);

  await page.getByRole("button", { name: "Create Mobile screen" }).click();

  // B57: the phone frame used to be drawn 1,024 px wide until the user found the Viewport menu.
  await expect(selectedViewport(page)).toHaveText(/^Mobile · \d+ × \d+$/);
  const [, width] = (await selectedViewport(page).textContent())!.match(/· (\d+) ×/)!;
  expect(Number(width)).toBeLessThan(500);

  // Desktop is still one choice away, and switching back to the first screen shows Desktop again.
  await viewport(page).selectOption({ label: (await viewport(page).locator("option", { hasText: "Desktop" }).textContent())! });
  await expect(selectedViewport(page)).toHaveText(/^Desktop · 1024 ×/);
});

