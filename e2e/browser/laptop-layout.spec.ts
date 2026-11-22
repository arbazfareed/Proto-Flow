import { expect, test } from "playwright/test";
import { startWorkspace } from "./workspace";

// B32: on a 1280 x 720 laptop the side panels took 520 of 1,280 px (41%) and the canvas toolbar
// wrapped onto two rows.
test("B32: on a 1280x720 laptop the side panels leave room and the toolbar is one row", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await startWorkspace(page, "Blank project");

  const sidebar = await page.locator(".left-sidebar").boundingBox();
  const inspector = await page.locator("aside.inspector").boundingBox();
  const toolbar = await page.locator(".canvas-toolbar").boundingBox();
  if (!sidebar || !inspector || !toolbar) throw new Error("The workspace did not render.");

  // The two panels take no more than 36% of the width (they took 41%).
  expect((sidebar.width + inspector.width) / 1280).toBeLessThan(0.36);
  // The canvas toolbar is one row (43 px), not two (78 px).
  expect(toolbar.height).toBeLessThan(60);

  // Selecting something fills the inspector with controls; none may stick out sideways.
  await page.getByRole("button", { name: "Add Rectangle" }).click();
  const canvas = await page.locator(".canvas-stage-surface").boundingBox();
  if (!canvas) throw new Error("No canvas.");
  await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  await expect(page.getByText("1 selected")).toBeVisible();
  const overflow = await page.locator("aside.inspector").evaluate((element) => ({
    inspector: element.scrollWidth - element.clientWidth,
    body: (element.querySelector(".inspector-body") as HTMLElement | null)
      ? (element.querySelector(".inspector-body") as HTMLElement).scrollWidth
        - (element.querySelector(".inspector-body") as HTMLElement).clientWidth
      : 0,
  }));
  expect(overflow.inspector).toBeLessThanOrEqual(1);
  expect(overflow.body).toBeLessThanOrEqual(1);

  // The narrower inspector must still leave the layer's name visible (it once collapsed to nothing).
  const name = await page.locator(".layer-row .layer-name", { hasText: /^Rectangle$/ }).boundingBox();
  expect(name?.width ?? 0).toBeGreaterThanOrEqual(40);
});

test("B32: wider laptops keep the original panel widths", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await startWorkspace(page, "Blank project");
  expect((await page.locator(".left-sidebar").boundingBox())?.width).toBe(240);
  expect((await page.locator("aside.inspector").boundingBox())?.width).toBe(280);
});
