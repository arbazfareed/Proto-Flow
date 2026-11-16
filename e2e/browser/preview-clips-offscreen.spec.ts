import { expect, test } from "playwright/test";
import { startWorkspace } from "./workspace";

test("B87: a widget placed beside the phone screen stays off-screen in Preview, as on the canvas", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await startWorkspace(page, "Blank project");
  // An empty phone screen.
  await page.getByRole("button", { name: "Add screen" }).click();
  const picker = page.getByRole("dialog", { name: "Choose a device" });
  await picker.getByRole("textbox", { name: "Search devices" }).fill("iPhone 15");
  await picker.getByRole("button", { name: /^iPhone 15 393/ }).click();
  await page.getByRole("button", { name: "Add Rectangle" }).click();
  const stage = page.locator("canvas").first();
  const bounds = await stage.boundingBox();
  if (!bounds) throw new Error("The canvas stage is not visible.");
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await expect(page.getByText("1 selected")).toBeVisible();
  const xPosition = page.getByLabel("X", { exact: true });
  // Well to the right of the ~393 px phone screen.
  await xPosition.fill("520");
  await xPosition.press("Enter");
  await expect(xPosition).toHaveValue("520");

  const previewPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview" }).click();
  const preview = await previewPromise;
  const previewScreen = preview.getByLabel("Preview screen", { exact: true });
  await previewScreen.selectOption({ index: 1 });
  await expect(preview.locator('.preview-widget[data-widget-type="rectangle"]')).toHaveCount(1);
  const placed = await preview.evaluate(() => {
    const screenElement = document.querySelector<HTMLElement>(".preview-screen");
    const rectangles = [...document.querySelectorAll<HTMLElement>('.preview-widget[data-widget-type="rectangle"]')];
    return {
      screenWidth: screenElement?.offsetWidth ?? 0,
      lefts: rectangles.map((element) => Number.parseFloat(element.style.left)),
    };
  });
  expect(placed.screenWidth).toBeGreaterThan(0);
  // It is drawn where it was placed, outside the screen (so clipped), not pulled into view.
  expect(placed.lefts).toContain(520);
  expect(520).toBeGreaterThanOrEqual(placed.screenWidth);
  await preview.close();
});
