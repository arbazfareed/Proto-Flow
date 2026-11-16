import { expect, test } from "playwright/test";
import { startWorkspace } from "./workspace";

// B79: three times, the first rectangle on a new screen ignored its typed size and colour and
// stayed a small purple box. It no longer reproduces (the new-screen breakpoint was fixed in
// B57); this test keeps it that way, on three fresh phone screens in a row.
test("B79: the first rectangle on a new screen keeps its typed size and colour", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await startWorkspace(page, "Blank project");
  for (let round = 0; round < 3; round += 1) {
    await page.getByRole("button", { name: "Add screen" }).click();
    const picker = page.getByRole("dialog", { name: "Choose a device" });
    await picker.getByRole("textbox", { name: "Search devices" }).fill("iPhone 15");
    await picker.getByRole("button", { name: /^iPhone 15 393/ }).click();
    await page.getByRole("button", { name: "Add Rectangle" }).click();
    const box = await page.locator(".canvas-stage-surface").boundingBox();
    if (!box) throw new Error("No canvas.");
    await page.mouse.click(box.x + box.width / 2 - 120, box.y + box.height / 2);
    await expect(page.getByText("1 selected")).toBeVisible();
    const width = page.getByLabel("Width", { exact: true });
    await width.fill("240");
    await width.press("Tab");
    const fill = page.getByLabel("Fill hex, RGBA, or HSL");
    await fill.fill("#ff0000");
    await fill.press("Enter");
    await page.waitForTimeout(600);

    // Deselect, select it again from Layers: the values stuck.
    await page.mouse.click(box.x + 30, box.y + box.height - 30);
    await page.getByRole("button", { name: "Screen child Rectangle", exact: true }).first().click();
    await expect(width).toHaveValue("240");
    await expect(fill).toHaveValue("#ff0000");
  }

  // ...and Preview draws the last one that way.
  const previewPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview" }).click();
  const preview = await previewPromise;
  const screens = preview.getByLabel("Preview screen", { exact: true });
  await expect(screens.locator("option")).toHaveCount(4);
  const lastScreen = await screens.locator("option").nth(3).getAttribute("value");
  await screens.selectOption(lastScreen ?? "");
  const rectangle = preview.locator('.preview-widget[data-widget-type="rectangle"]').first();
  await expect(rectangle).toHaveCSS("background-color", "rgb(255, 0, 0)");
  expect(Number.parseFloat(await rectangle.evaluate((element) => (element as HTMLElement).style.width))).toBe(240);
  await preview.close();
});
