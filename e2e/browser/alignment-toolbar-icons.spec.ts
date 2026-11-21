import { expect, test } from "playwright/test";
import { startWorkspace } from "./workspace";

// B53: the alignment toolbar for several selected widgets showed single letters (L C R T M B W H).
// Each button now shows the standard alignment icon, keeping its tooltip and accessible name.
const EXPECTED_NAMES = [
  "Align left",
  "Align horizontal centers",
  "Align right",
  "Align top",
  "Align vertical centers",
  "Align bottom",
  "Distribute horizontally",
  "Distribute vertically",
  "Match width",
  "Match height",
];

test("B53: the alignment toolbar shows icons, not letters", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await startWorkspace(page, "Blank project");
  const box = await page.locator(".canvas-stage-surface").boundingBox();
  if (!box) throw new Error("No canvas.");
  for (const offset of [-160, 160]) {
    await page.getByRole("button", { name: "Add Rectangle" }).click();
    await page.mouse.click(box.x + box.width / 2 + offset, box.y + box.height / 2);
  }
  await page.keyboard.press("Control+a");
  await expect(page.getByText("2 selected")).toBeVisible();

  const toolbar = page.getByRole("toolbar", { name: "Selection alignment tools" });
  const buttons = toolbar.getByRole("button");
  await expect(buttons).toHaveCount(EXPECTED_NAMES.length);
  for (const [index, name] of EXPECTED_NAMES.entries()) {
    const button = buttons.nth(index);
    await expect(button).toHaveAttribute("aria-label", name);
    await expect(button).toHaveAttribute("title", name);
    await expect(button.locator("svg")).toHaveCount(1);
    expect(((await button.textContent()) ?? "").trim()).toBe("");
  }
});
