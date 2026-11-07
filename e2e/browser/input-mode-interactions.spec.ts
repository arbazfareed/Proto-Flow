import { expect, test } from "playwright/test";
import { startWorkspace } from "./workspace";

test("interaction trigger choices follow the screen input mode while keeping keyboard events", async ({ page }) => {
  await startWorkspace(page, "Blank project");
  await page.getByRole("button", { name: "Add Button" }).click();
  const stage = page.locator("canvas").first();
  const bounds = await stage.boundingBox();
  if (!bounds) throw new Error("The canvas stage is not visible.");
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);

  await page.getByRole("tab", { name: "Interactions" }).click();
  await page.getByRole("button", { name: "Add rule" }).click();
  const trigger = page.getByLabel("Trigger event");
  const inputMode = page.getByLabel("Screen input mode");
  const expectEvents = async (available: string[], unavailable: string[] = []) => {
    const options = await trigger.locator("option").allTextContents();
    for (const event of available) expect(options).toContain(event);
    for (const event of unavailable) expect(options).not.toContain(event);
  };

  await expectEvents(["Click", "Double click", "Right click", "Mouse down"], ["Tap"]);
  await inputMode.selectOption("touch");
  await expectEvents([
    "Tap",
    "Double tap",
    "Long press",
    "Swipe left",
    "Pinch in",
    "Two-finger pan",
    "Click (not available in touch mode)",
    "Focus",
    "Blur",
    "Key down",
  ], ["Mouse down"]);

  await trigger.selectOption("onTap");
  await inputMode.selectOption("mouse");
  await expectEvents([
    "Click",
    "Right click",
    "Mouse down",
    "Tap (not available in mouse mode)",
    "Focus",
    "Blur",
    "Key down",
  ], ["Tap"]);
  await inputMode.selectOption("both");
  await expectEvents([
    "Click",
    "Tap",
    "Pinch in",
    "Focus",
    "Blur",
    "Key down",
  ]);
});
