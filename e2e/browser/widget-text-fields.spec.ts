import { expect, test, type Page } from "playwright/test";
import { startWorkspace } from "./workspace";

async function clickCanvas(page: Page, dx = 0, dy = 0) {
  const box = await page.locator(".canvas-stage-surface").boundingBox();
  if (!box) throw new Error("No canvas.");
  await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
}

/** Arms the widget tool and places it with a click on an empty spot (it is then selected). */
async function addAndSelect(page: Page, name: string, dx: number) {
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: `Add ${name}`, exact: true }).first().click();
  await clickCanvas(page, dx, -120);
  await expect(page.getByText("1 selected")).toBeVisible();
}

test("B70 + B71 + B73: text colour on any widget, a Content field for visible text, editable avatar initials", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await startWorkspace(page, "Blank project");
  const properties = page.getByRole("region", { name: "Widget properties" });

  // B70: a Button's label colour can be set.
  await addAndSelect(page, "Button", -200);
  await page.getByLabel("Text colour", { exact: true }).fill("#d1242f");
  await expect(page.getByText("#d1242f")).toBeVisible();
  await properties.getByLabel("Text shown").fill("Pay now");

  // B73: an Avatar shows the initials of its name, or the initials typed.
  await addAndSelect(page, "Avatar", 150);
  await properties.getByLabel("Person's name").fill("Sara Khan");
  await properties.getByLabel("Initials (shown)").fill("");

  // B71 + B70: a Text widget's words are edited in "Content", and its Fill is called Text colour.
  await page.getByRole("button", { name: "Add Text" }).first().click();
  const stage = page.locator(".canvas-stage-surface");
  const box = await stage.boundingBox();
  if (!box) throw new Error("No canvas.");
  await page.mouse.move(box.x + 120, box.y + 120);
  await page.mouse.down();
  await page.mouse.move(box.x + 320, box.y + 160, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Screen child Text", exact: true }).first().click();
  await expect(page.getByText("1 selected")).toBeVisible();
  await expect(properties.getByLabel("Content")).toBeVisible();
  await properties.getByLabel("Content").fill("Welcome back");
  await expect(page.getByLabel("Text colour hex, RGBA, or HSL")).toBeVisible();
  await page.waitForTimeout(600);

  const previewPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview" }).click();
  const preview = await previewPromise;
  const button = preview.locator('.preview-widget[data-widget-type="button"], button').filter({ hasText: "Pay now" }).first();
  await expect(button).toBeVisible();
  await expect(button).toHaveCSS("color", "rgb(209, 36, 47)");
  await expect(preview.locator('.preview-widget[data-widget-type="avatar"]')).toHaveText("SK");
  await expect(preview.getByText("Welcome back")).toBeVisible();
  await preview.close();

  // Typed initials win over the name.
  await page.keyboard.press("Escape");
  // The avatar was placed with its top-left corner at the click; aim for its middle.
  await clickCanvas(page, 150 + 12, -120 + 12);
  await expect(properties.getByLabel("Initials (shown)")).toBeVisible();
  await properties.getByLabel("Initials (shown)").fill("ZA");
  await page.waitForTimeout(600);
  const secondPreviewPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview" }).click();
  const secondPreview = await secondPreviewPromise;
  await expect(secondPreview.locator('.preview-widget[data-widget-type="avatar"]')).toHaveText("ZA");
  await secondPreview.close();
});
