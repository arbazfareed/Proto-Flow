import { expect, test } from "playwright/test";
import { startWorkspace } from "./workspace";

test("B78 + B90: drags land on whole pixels; 1 px sizes are kept and thin shapes can be clicked", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await startWorkspace(page, "Blank project");
  await page.getByRole("button", { name: "Add Rectangle" }).click();
  const box = await page.locator(".canvas-stage-surface").boundingBox();
  if (!box) throw new Error("No canvas.");
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.click(centre.x, centre.y);
  await expect(page.getByText("1 selected")).toBeVisible();

  // B78: an odd drag at a fractional zoom still gives whole numbers.
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await page.mouse.move(centre.x + 37.3, centre.y + 19.7, { steps: 7 });
  await page.mouse.up();
  const x = page.getByLabel("X", { exact: true });
  const y = page.getByLabel("Y", { exact: true });
  await expect(x).not.toHaveValue("");
  expect(await x.inputValue()).toMatch(/^-?\d+$/);
  expect(await y.inputValue()).toMatch(/^-?\d+$/);

  // Find the rectangle's top edge on screen (binary search with clicks), so the 1 px line it
  // becomes can be located.
  const empty = { x: box.x + 20, y: box.y + box.height - 20 };
  // The click that selected it was near its left edge; go 25 px further into it.
  const column = centre.x + 37 + 25;
  const hits = async (screenY: number) => {
    await page.mouse.click(empty.x, empty.y);
    await expect(page.getByText("0 selected")).toBeVisible();
    await page.mouse.click(column, screenY);
    return page.getByText("1 selected").waitFor({ timeout: 400 }).then(() => true, () => false);
  };
  let inside = centre.y + 20;
  let outside = box.y + 2;
  while (inside - outside > 1) {
    const middle = Math.floor((inside + outside) / 2);
    if (await hits(middle)) inside = middle;
    else outside = middle;
  }
  const topEdge = inside;
  expect(await hits(topEdge)).toBe(true);

  // B90: a typed height of 1 stays 1.
  const height = page.getByLabel("Height", { exact: true });
  await height.fill("1");
  await height.press("Enter");
  await expect(height).toHaveValue("1");

  // The 1 px line can be clicked a few pixels off (an enlarged click area), as with a finger.
  await page.mouse.click(empty.x, empty.y);
  await expect(page.getByLabel("Height", { exact: true })).toHaveCount(0);
  await page.mouse.click(empty.x, empty.y);
  await expect(page.getByText("0 selected")).toBeVisible();
  // Four screen pixels below a 1 px line: only the enlarged click area is there.
  await page.mouse.click(column, topEdge + 4);
  await expect(page.getByText("1 selected")).toBeVisible();
  await expect(height).toHaveValue("1");

  // Resize handles belong to the selection only: none once nothing is selected.
  const handleTargets = () => page.evaluate(() => {
    const konva = (window as unknown as { Konva?: { stages: Array<{ findOne: (selector: string) => { nodes: () => unknown[] } | undefined }> } }).Konva;
    return konva?.stages[0]?.findOne("Transformer")?.nodes().length ?? -1;
  });
  expect(await handleTargets()).toBe(1);
  await page.mouse.click(empty.x, empty.y);
  await expect(page.getByText("0 selected")).toBeVisible();
  expect(await handleTargets()).toBe(0);
});
