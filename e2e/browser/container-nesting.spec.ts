import { expect, test, type Page } from "playwright/test";
import { startWorkspace } from "./workspace";

type Box = { x: number; y: number; width: number; height: number };

/** Every widget node on the canvas, in stage pixels (the same origin as the canvas surface). */
async function widgetBoxes(page: Page): Promise<Array<{ id: string; box: Box }>> {
  return page.evaluate(() => {
    const konva = (window as unknown as {
      Konva: { stages: Array<{ find: (selector: string) => Array<{ id: () => string; getClientRect: () => Box }> }> };
    }).Konva;
    return konva.stages[0].find("Group")
      .filter((node) => node.id())
      .map((node) => ({ id: node.id(), box: node.getClientRect() }));
  });
}

async function highlightShown(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const konva = (window as unknown as {
      Konva: { stages: Array<{ findOne: (selector: string) => unknown }> };
    }).Konva;
    return Boolean(konva.stages[0].findOne(".drop-container-highlight"));
  });
}

// B4: a widget dragged half over a container was silently left outside it, with no hint, so it
// did not move with the container. Now the container is outlined while you drag over it, and
// the widget is placed inside when its centre is inside.
test("B4: dragging onto a container highlights it and nests the widget by its centre", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await startWorkspace(page, "Blank project");
  const surface = (await page.locator(".canvas-stage-surface").boundingBox())!;
  const cx = surface.x + surface.width / 2;
  const cy = surface.y + surface.height / 2;

  await page.getByRole("button", { name: "Add Container" }).first().click();
  await page.mouse.move(cx - 150, cy - 100);
  await page.mouse.down();
  await page.mouse.move(cx + 150, cy + 100, { steps: 6 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Add Rectangle" }).click();
  await page.mouse.click(cx + 250, cy - 200);
  await expect(page.getByText("1 selected")).toBeVisible();

  const before = await widgetBoxes(page);
  const byArea = [...before].sort((a, b) => b.box.width * b.box.height - a.box.width * a.box.height);
  const container = byArea[0];
  const rectangle = byArea[1];
  expect(before).toHaveLength(2);

  // Drag the rectangle so it hangs over the container's right edge, centre just inside.
  const grabX = surface.x + rectangle.box.x + rectangle.box.width / 2;
  const grabY = surface.y + rectangle.box.y + rectangle.box.height / 2;
  const dropX = surface.x + container.box.x + container.box.width - 12;
  const dropY = surface.y + container.box.y + container.box.height / 2;
  await page.mouse.move(grabX, grabY);
  await page.mouse.down();
  await page.mouse.move(dropX, dropY, { steps: 10 });
  await expect.poll(() => highlightShown(page)).toBe(true);
  await page.mouse.up();
  await expect.poll(() => highlightShown(page)).toBe(false);

  await expect(page.locator(".layer-row", { hasText: "1 child" })).toBeVisible();
  // It is now inside: moving the container moves it too.
  const placed = (await widgetBoxes(page)).find((node) => node.id === rectangle.id)!.box;
  expect(placed.x + placed.width).toBeGreaterThan(container.box.x + container.box.width);
  const grabContainerX = surface.x + container.box.x + 30;
  const grabContainerY = surface.y + container.box.y + 30;
  await page.mouse.click(surface.x + 20, surface.y + surface.height - 20);
  await page.mouse.move(grabContainerX, grabContainerY);
  await page.mouse.down();
  await page.mouse.move(grabContainerX, grabContainerY - 60, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => {
    const moved = (await widgetBoxes(page)).find((node) => node.id === rectangle.id)!.box;
    return Math.round(placed.y - moved.y);
  }).toBeGreaterThan(40);

  // Nudging the (still selected) container with the keyboard moves its contents too.
  const beforeNudge = (await widgetBoxes(page)).find((node) => node.id === rectangle.id)!.box;
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");
  await expect.poll(async () => {
    const nudged = (await widgetBoxes(page)).find((node) => node.id === rectangle.id)!.box;
    return Math.round(nudged.x - beforeNudge.x);
  }).toBeGreaterThan(10);
});

test("B4: dropping with the centre outside the container leaves the widget outside, unhighlighted", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await startWorkspace(page, "Blank project");
  const surface = (await page.locator(".canvas-stage-surface").boundingBox())!;
  const cx = surface.x + surface.width / 2;
  const cy = surface.y + surface.height / 2;
  await page.getByRole("button", { name: "Add Container" }).first().click();
  await page.mouse.move(cx - 150, cy - 100);
  await page.mouse.down();
  await page.mouse.move(cx + 150, cy + 100, { steps: 6 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Add Rectangle" }).click();
  await page.mouse.click(cx + 250, cy - 200);
  await expect(page.getByText("1 selected")).toBeVisible();

  const nodes = await widgetBoxes(page);
  const byArea = [...nodes].sort((a, b) => b.box.width * b.box.height - a.box.width * a.box.height);
  const [container, rectangle] = byArea;
  const grabX = surface.x + rectangle.box.x + rectangle.box.width / 2;
  const grabY = surface.y + rectangle.box.y + rectangle.box.height / 2;
  await page.mouse.move(grabX, grabY);
  await page.mouse.down();
  await page.mouse.move(
    surface.x + container.box.x + container.box.width + 12,
    surface.y + container.box.y + container.box.height / 2,
    { steps: 10 },
  );
  await page.waitForTimeout(150);
  expect(await highlightShown(page)).toBe(false);
  await page.mouse.up();

  const placed = (await widgetBoxes(page)).find((node) => node.id === rectangle.id)!.box;
  const grabContainerX = surface.x + container.box.x + 30;
  const grabContainerY = surface.y + container.box.y + 30;
  await page.mouse.click(surface.x + 20, surface.y + surface.height - 20);
  await page.mouse.move(grabContainerX, grabContainerY);
  await page.mouse.down();
  await page.mouse.move(grabContainerX, grabContainerY - 60, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const after = (await widgetBoxes(page)).find((node) => node.id === rectangle.id)!.box;
  expect(Math.abs(after.y - placed.y)).toBeLessThan(10);
});

test("B4: double-clicking a Card or a Modal edits its title", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await startWorkspace(page, "Blank project");
  const surface = (await page.locator(".canvas-stage-surface").boundingBox())!;

  const texts = () => page.evaluate(() => {
    const konva = (window as unknown as {
      Konva: { stages: Array<{ find: (selector: string) => Array<{ text: () => string }> }> };
    }).Konva;
    return konva.stages[0].find("Text").map((node) => node.text());
  });

  for (const [tool, title] of [["Add Card", "Order summary"], ["Add Modal", "Confirm payment"]] as const) {
    const existing = new Set((await widgetBoxes(page)).map((node) => node.id));
    await page.getByRole("button", { name: tool }).first().click();
    await page.mouse.click(surface.x + (tool === "Add Card" ? 80 : 420), surface.y + 80);
    await expect(page.getByText("1 selected")).toBeVisible();
    const added = (await widgetBoxes(page)).find((node) => !existing.has(node.id))!.box;
    await page.mouse.dblclick(surface.x + added.x + added.width / 2, surface.y + added.y + added.height / 2);
    const editor = page.getByRole("textbox", { name: `Edit ${tool === "Add Card" ? "card" : "modal"} text` });
    await expect(editor).toBeVisible();
    await editor.fill(title);
    await page.mouse.click(surface.x + 20, surface.y + surface.height - 20);
    await expect.poll(texts).toContain(title);
  }
});
