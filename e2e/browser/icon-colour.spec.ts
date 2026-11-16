import { expect, test, type Page } from "playwright/test";
import { startWorkspace } from "./workspace";

async function place(page: Page, name: string, dx: number) {
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: `Add ${name}`, exact: true }).first().click();
  const box = await page.locator(".canvas-stage-surface").boundingBox();
  if (!box) throw new Error("No canvas.");
  await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 - 120);
  await expect(page.getByText("1 selected")).toBeVisible();
}

test("B75: icons have an Icon colour field, and icon buttons show their icon in that colour", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await startWorkspace(page, "Blank project");

  await place(page, "Icon", -200);
  await expect(page.getByLabel("Icon colour hex, RGBA, or HSL")).toBeVisible();
  // The unused Fill field is not offered for icons.
  await expect(page.getByLabel("Fill hex, RGBA, or HSL")).toHaveCount(0);
  await page.getByLabel("Icon colour hex, RGBA, or HSL").fill("#16a34a");
  await page.getByLabel("Icon colour hex, RGBA, or HSL").press("Enter");

  await place(page, "Icon button", 150);
  await page.getByLabel("Icon colour", { exact: true }).fill("#dc2626");
  await expect(page.getByText("#dc2626")).toBeVisible();
  await page.waitForTimeout(600);

  const previewPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview" }).click();
  const preview = await previewPromise;
  await expect(preview.locator(".preview-canvas-icon svg")).toHaveAttribute("stroke", "#16a34a");
  const iconButton = preview.locator(".is-icon-button");
  await expect(iconButton.locator("svg")).toHaveAttribute("stroke", "#dc2626");
  // It shows an icon, not the word "Button".
  await expect(iconButton).not.toContainText("Button");
  await preview.close();
});
