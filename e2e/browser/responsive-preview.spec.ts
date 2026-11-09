import { expect, test } from "playwright/test";
import { startWorkspace } from "./workspace";

test("responsive workspace switches breakpoints and previews multiple devices", async ({ page }) => {
  await startWorkspace(page, "Responsive web");

  const breakpoint = page.getByLabel("Active breakpoint");
  const mobile = breakpoint.locator("option", { hasText: "Mobile" });
  await expect(mobile).toHaveCount(1);
  await breakpoint.selectOption(await mobile.getAttribute("value") ?? "");
  await expect(breakpoint.locator("option:checked")).toContainText("Mobile");

  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview" }).click();
  const preview = await popupPromise;
  await preview.setViewportSize({ width: 1440, height: 900 });
  await expect(preview.getByLabel("Preview layout")).toBeVisible();
  await preview.getByLabel("Device preset").selectOption("iphone-15");
  await expect(preview.getByLabel("Device preset")).toHaveValue("iphone-15");
  await preview.getByLabel("Preview layout").selectOption({ label: "Desktop · tablet · mobile" });
  await expect(preview.getByLabel("Preview layout")).toHaveValue("columns");
  await expect(preview.locator("article.preview-frame-card")).toHaveCount(3);
  await expect(preview.getByText("3 devices", { exact: true })).toBeVisible();
  const cards = preview.locator("article.preview-frame-card");
  await expect.poll(async () => {
    const geometry = await cards.evaluateAll((elements) => elements.map((card) => {
      const viewport = card.querySelector(".preview-frame-viewport")?.getBoundingClientRect();
      const stage = card.querySelector(".preview-frame-stage")?.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      if (!viewport || !stage) return null;
      return {
        left: cardRect.left,
        top: cardRect.top,
        stageTop: stage.top,
        stageBottom: stage.bottom,
        viewportTop: viewport.top,
        viewportBottom: viewport.bottom,
      };
    }));
    return geometry.length === 3 &&
      geometry.every((frame) => frame !== null &&
        frame.stageTop >= frame.viewportTop - 1 &&
        frame.stageBottom <= frame.viewportBottom + 1) &&
      geometry[0]!.top === geometry[1]!.top &&
      geometry[1]!.top === geometry[2]!.top &&
      geometry[0]!.left < geometry[1]!.left &&
      geometry[1]!.left < geometry[2]!.left;
  }).toBe(true);
  await preview.setViewportSize({ width: 600, height: 900 });
  await expect.poll(async () => cards.evaluateAll((elements) => {
    const grid = elements[0]?.parentElement;
    const columns = grid ? getComputedStyle(grid).gridTemplateColumns.split(" ").length : 0;
    const tops = elements.map((card) => card.getBoundingClientRect().top);
    return columns === 1 && tops.length === 3 && tops[0] < tops[1] && tops[1] < tops[2];
  })).toBe(true);
  await preview.close();
});
