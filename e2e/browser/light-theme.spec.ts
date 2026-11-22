import { expect, test, type Page } from "playwright/test";
import { startWorkspace } from "./workspace";

/** Visible editor UI (not the user's design) with a dark background or hard-to-read text. */
function findLightThemeProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const luminance = (colour: string) => {
      const parts = colour.match(/[\d.]+/g)?.map(Number);
      if (!parts || parts.length < 3) return { value: 1, alpha: 0 };
      const channel = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      return { value: 0.2126 * channel(parts[0]) + 0.7152 * channel(parts[1]) + 0.0722 * channel(parts[2]), alpha: parts[3] ?? 1 };
    };
    const backgroundBehind = (element: Element | null) => {
      for (let node = element; node; node = node.parentElement) {
        const { value, alpha } = luminance(getComputedStyle(node).backgroundColor);
        if (alpha > 0.5) return value;
      }
      return 1;
    };
    const problems = new Set<string>();
    for (const element of Array.from(document.querySelectorAll("body *"))) {
      if (element.closest("canvas, svg, .konvajs-content, .preview-screen, .brand-mark, .canvas-performance-overlay")) continue;
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (box.width < 4 || box.height < 4 || style.visibility === "hidden" || style.display === "none") continue;
      const name = `${element.tagName.toLowerCase()}.${String(element.className).trim().split(/\s+/).slice(0, 2).join(".")}`;
      const background = luminance(style.backgroundColor);
      // Accent buttons are allowed to be strong; panels, fields and cards must not be dark.
      if (background.alpha > 0.5 && background.value < 0.06 && !/button-primary|is-accent/.test(name)) {
        problems.add(`dark background: ${name} ${style.backgroundColor}`);
      }
      const ownText = Array.from(element.childNodes).some((node) => node.nodeType === 3 && node.textContent?.trim());
      if (ownText && !(element as HTMLButtonElement).disabled && !element.closest("[disabled], [aria-disabled='true']")) {
        const text = luminance(style.color).value;
        const behind = backgroundBehind(element);
        const ratio = (Math.max(text, behind) + 0.05) / (Math.min(text, behind) + 0.05);
        if (ratio < 3) problems.add(`low contrast ${ratio.toFixed(2)}: ${name} "${element.textContent?.trim().slice(0, 30)}"`);
      }
    }
    return Array.from(problems);
  });
}

test("light theme has no dark panels or unreadable text in the main editor views", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("protoflow.theme.v1", "light"));
  await page.setViewportSize({ width: 1440, height: 900 });
  await startWorkspace(page, "Blank project");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  const problems: string[] = [];
  problems.push(...await findLightThemeProblems(page));

  const box = (await page.locator(".canvas-stage-surface").boundingBox())!;
  await page.getByRole("button", { name: "Add Button" }).first().click();
  await page.mouse.move(box.x + 200, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 360, box.y + 348, { steps: 6 });
  await page.mouse.up();
  problems.push(...await findLightThemeProblems(page));

  await page.mouse.click(box.x + 600, box.y + 200, { button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
  problems.push(...await findLightThemeProblems(page));
  await page.keyboard.press("Escape");

  await page.keyboard.press("Control+k");
  problems.push(...await findLightThemeProblems(page));
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Open settings" }).click();
  problems.push(...await findLightThemeProblems(page));

  expect([...new Set(problems)]).toEqual([]);
});
