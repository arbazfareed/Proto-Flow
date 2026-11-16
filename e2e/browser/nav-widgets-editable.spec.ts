import { expect, test, type Page } from "playwright/test";
import { startWorkspace } from "./workspace";

async function placeAt(page: Page, name: string, dx: number, dy: number) {
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: `Add ${name}`, exact: true }).first().click();
  const box = await page.locator(".canvas-stage-surface").boundingBox();
  if (!box) throw new Error("No canvas.");
  const point = { x: box.x + box.width / 2 + dx, y: box.y + box.height / 2 + dy };
  await page.mouse.click(point.x, point.y);
  await expect(page.getByText("1 selected")).toBeVisible();
  // The widget's top-left corner is at the click; its middle is a little further in.
  return { x: point.x + 20, y: point.y + 10 };
}

async function editByDoubleClick(page: Page, at: { x: number; y: number }, text: string) {
  await page.mouse.dblclick(at.x, at.y);
  const editor = page.getByRole("textbox", { name: /^Edit .* text$/ });
  await expect(editor).toBeVisible();
  await editor.fill(text);
  // Clicking outside commits the edit (Escape would cancel it).
  const box = await page.locator(".canvas-stage-surface").boundingBox();
  await page.mouse.click(box!.x + 30, box!.y + box!.height - 30);
  await expect(editor).toHaveCount(0);
}

test("B72: app bar, bottom nav, chip, badge and search edit by double-click and are solid, not washed out", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await startWorkspace(page, "Blank project");

  const appBar = await placeAt(page, "App bar", -330, -200);
  await editByDoubleClick(page, appBar, "Inbox");
  const chip = await placeAt(page, "Chip", -330, -60);
  await editByDoubleClick(page, chip, "Unread");
  const badge = await placeAt(page, "Badge", -330, 40);
  await editByDoubleClick(page, badge, "3 new");
  const nav = await placeAt(page, "Bottom navigation", 60, -200);
  await editByDoubleClick(page, nav, "Chats | Calls | Settings");
  const search = await placeAt(page, "Search", 60, -60);
  await editByDoubleClick(page, search, "Search chats");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);

  const previewPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview" }).click();
  const preview = await previewPromise;
  for (const words of ["Inbox", "Unread", "3 new"]) {
    await expect(preview.getByText(words, { exact: true }).first()).toBeVisible();
  }
  await expect(preview.locator(".preview-widget", { hasText: "Chats" }).first()).toBeVisible();
  await expect(preview.getByPlaceholder("Search chats")).toBeVisible();
  // Solid backgrounds (no 10% tint): every one of these is fully opaque.
  const alphas = await preview.evaluate(() =>
    ["app-bar", "chip", "badge", "bottom-nav"].map((type) => {
      const element = document.querySelector<HTMLElement>(`[data-widget-type="${type}"]`);
      const colour = element ? getComputedStyle(element).backgroundColor : "";
      const match = colour.match(/rgba?\(([^)]+)\)/);
      const parts = match ? match[1].split(",").map((part) => Number(part.trim())) : [];
      return { type, alpha: parts.length === 4 ? parts[3] : parts.length === 3 ? 1 : 0 };
    }));
  for (const { type, alpha } of alphas) expect(alpha, type).toBe(1);
  await preview.close();
});
