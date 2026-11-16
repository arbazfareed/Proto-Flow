import { expect, test } from "playwright/test";
import { startWorkspace } from "./workspace";

test("a new container is a plain white box with a light border, in the editor and in Preview", async ({ page }) => {
  await startWorkspace(page, "Blank project");
  await page.getByRole("button", { name: "Add Container" }).first().click();
  const box = (await page.locator(".canvas-stage-surface").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2 - 150, box.y + box.height / 2 - 100);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 150, box.y + box.height / 2 + 100, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator(".layer-row .layer-name", { hasText: /^Container$/ })).toBeVisible();

  const previewPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview" }).click();
  const preview = await previewPromise;
  const container = preview.locator(".preview-screen section.is-container");
  await expect(container).toBeVisible();

  // No placeholder title, fake text lines or "CONTAINER" label: just a box.
  await expect(container).toHaveText("");
  const look = await container.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, border: style.borderTopColor, borderStyle: style.borderTopStyle };
  });
  expect(look.background).toBe("rgb(255, 255, 255)");
  expect(look.border).toBe("rgb(217, 217, 225)");
  expect(look.borderStyle).toBe("solid");
});
