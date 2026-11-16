import { expect, test } from "playwright/test";
import { startWorkspace } from "./workspace";

test("a new button has a readable white label on its purple fill in Preview", async ({ page }) => {
  await startWorkspace(page, "Blank project");
  await page.getByRole("button", { name: "Add Button" }).first().click();
  const box = (await page.locator(".canvas-stage-surface").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2 - 80, box.y + box.height / 2 - 24);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 24, { steps: 6 });
  await page.mouse.up();

  const previewPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview" }).click();
  const preview = await previewPromise;
  const button = preview.locator(".preview-screen button.is-button");
  await expect(button).toBeVisible();

  // B46: the label used to be dark on purple (2.5:1); it must reach WCAG AA (4.5:1).
  const colours = await button.evaluate((element) => {
    const style = getComputedStyle(element);
    return { text: style.color, background: style.backgroundColor };
  });
  expect(colours.text).toBe("rgb(255, 255, 255)");
  expect(colours.background).toBe("rgb(105, 74, 195)");
});
