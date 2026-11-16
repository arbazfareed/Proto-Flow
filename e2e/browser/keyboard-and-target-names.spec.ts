import { expect, test } from "playwright/test";
import { startWorkspace } from "./workspace";

test("B2 + B93: Enter activates a clickable rectangle, and action targets use layer names", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await startWorkspace(page, "Blank project");
  await page.getByRole("button", { name: "Create Desktop screen" }).click();
  await page.getByRole("button", { name: "Previous screen" }).click();
  const box = await page.locator(".canvas-stage-surface").boundingBox();
  if (!box) throw new Error("No canvas.");
  const at = (dx: number, dy: number) => ({ x: box.x + box.width / 2 + dx, y: box.y + box.height / 2 + dy });

  // A button with words, and a rectangle that links to the second screen.
  await page.getByRole("button", { name: "Add Button", exact: true }).first().click();
  await page.mouse.click(at(-250, -150).x, at(-250, -150).y);
  await page.getByRole("region", { name: "Widget properties" }).getByLabel("Text shown").fill("Pay now");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Add Rectangle", exact: true }).first().click();
  await page.mouse.click(at(100, 0).x, at(100, 0).y);
  await expect(page.getByText("1 selected")).toBeVisible();
  await page.getByRole("tab", { name: "Interactions" }).click();
  const rules = page.getByRole("region", { name: "Interaction rules" });
  await rules.getByRole("button", { name: "Add rule" }).click();
  const target = rules.getByRole("combobox", { name: "Action target" });
  const destination = await target.locator("option").filter({ hasNotText: /Choose|Screen 1/ }).first().getAttribute("value");
  await target.selectOption(destination ?? "");

  // B93: a second action that hides a widget lists it by name, not as "button".
  await rules.getByRole("button", { name: "Add action" }).click();
  const secondType = rules.getByRole("combobox", { name: "Action type" }).nth(1);
  await secondType.selectOption("hide");
  const secondTarget = rules.getByRole("combobox", { name: "Action target" }).nth(1);
  await expect(secondTarget.locator("option", { hasText: "Pay now · Button" })).toHaveCount(1);
  await expect(secondTarget.locator("option", { hasText: /^button$/ })).toHaveCount(0);
  await secondTarget.selectOption({ label: "Pay now · Button" });
  await page.waitForTimeout(500);

  // B2 in Preview: Tab to the rectangle and press Enter.
  const previewPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview" }).click();
  const preview = await previewPromise;
  const screenPicker = preview.getByLabel("Preview screen", { exact: true });
  const start = await screenPicker.locator("option").nth(0).getAttribute("value");
  await screenPicker.selectOption(start ?? "");
  const rectangle = preview.locator('.preview-widget[data-widget-type="rectangle"]').first();
  await expect(rectangle).toHaveAttribute("tabindex", "0");
  await rectangle.focus();
  await preview.keyboard.press("Enter");
  await expect(screenPicker).toHaveValue(destination ?? "");
  await preview.close();
});

test("B2: in the exported HTML, Tab reaches a clickable card and Enter runs its click rule", async ({ page }) => {
  await page.goto("/");
  const { html, cardId, secondId } = await page.evaluate(async () => {
    const schema = await import("/src/project/schema.ts");
    const bundle = await import("/src/preview/publishBundle.ts");
    const project = schema.createEmptyProject("Keyboard");
    const first = project.screens[0];
    const second = { ...structuredClone(first), id: crypto.randomUUID(), name: "Details", widgets: [], interactionRules: [] };
    const card = {
      id: crypto.randomUUID(), type: "card", x: 40, y: 40, width: 260, height: 196, rotation: 0, opacity: 1,
      visible: true, locked: false, zIndex: 1, style: {}, props: { title: "Order #12", subtitle: "Open", imageSrc: "", actionLabel: "View" },
    };
    first.widgets.push(card as never);
    first.interactionRules.push({
      id: crypto.randomUUID(), event: "onClick", widgetId: card.id, conditions: [], conditionMode: "all",
      actions: [{ type: "navigate", target: second.id }],
    } as never);
    project.screens.push(second as never);
    const parsed = schema.parseProject(project);
    return { html: bundle.generatePublishedPreviewHtml(parsed), cardId: card.id, secondId: second.id };
  });
  await page.setContent(html);
  const card = page.locator(`[data-widget-id="${cardId}"]`);
  await expect(card).toHaveAttribute("tabindex", "0");
  await expect(card).toHaveAttribute("role", "button");
  await card.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Preview screen")).toHaveValue(secondId);
});
