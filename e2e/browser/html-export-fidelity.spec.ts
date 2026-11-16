import { expect, test } from "playwright/test";

test("B89: exported HTML hides 'Hide on Mobile' widgets, draws no outline at stroke 0, and does not clip text", async ({
  page,
}) => {
  // Build the exported page with the app's own code, served by the dev server.
  await page.goto("/");
  const { html, ids } = await page.evaluate(async () => {
    const schema = await import("/src/project/schema.ts");
    const responsive = await import("/src/project/responsive.ts");
    const bundle = await import("/src/preview/publishBundle.ts");
    const widget = (overrides: Record<string, unknown>) => ({
      id: crypto.randomUUID(), type: "rectangle", x: 0, y: 0, width: 200, height: 80,
      rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 1, style: {}, props: {},
      ...overrides,
    });
    const project = schema.createEmptyProject("Export fidelity");
    const screen = project.screens[0];
    screen.breakpoints = responsive.createDefaultBreakpoints(1440, 900);
    const sidePanel = widget({
      x: 1100, width: 300, height: 600, style: { fill: "#eef2ff" }, props: { label: "" },
      overrides: { mobile: { cascadeMode: "hide" } },
    });
    const plainBox = widget({ x: 20, y: 20, style: { fill: "#ffffff", stroke: "#7c3aed", strokeWidth: 0 } });
    const heading = widget({
      type: "text", x: 20, y: 140, width: 260, height: 34,
      style: { fill: "#24212b" }, props: { text: "Inbox", fontSize: 28, lineHeight: 1.2 },
    });
    screen.widgets.push(sidePanel as never, plainBox as never, heading as never);
    const parsed = schema.parseProject(project);
    return {
      html: bundle.generatePublishedPreviewHtml(parsed),
      ids: { sidePanel: sidePanel.id as string, plainBox: plainBox.id as string, heading: heading.id as string },
    };
  });

  const styleOf = (id: string) => page.evaluate((widgetId) => {
    const element = document.querySelector<HTMLElement>(`[data-widget-id="${widgetId}"]`);
    if (!element) return null;
    const style = getComputedStyle(element);
    return {
      borderTopWidth: style.borderTopWidth,
      paddingTop: style.paddingTop,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    };
  }, id);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.setContent(html);
  await expect(page.locator(`[data-widget-id="${ids.sidePanel}"]`)).toBeVisible();
  expect((await styleOf(ids.plainBox))?.borderTopWidth).toBe("0px");
  const text = await styleOf(ids.heading);
  expect(text?.paddingTop).toBe("0px");
  // The text fits its box: nothing is cut off at the bottom.
  expect(text!.scrollHeight).toBeLessThanOrEqual(text!.clientHeight);

  // A phone-width window (a fresh page, as a visitor would open it).
  const phone = await page.context().newPage();
  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.setContent(html);
  await expect(phone.locator(`[data-widget-id="${ids.plainBox}"]`)).toBeVisible();
  await expect(phone.locator(`[data-widget-id="${ids.sidePanel}"]`)).toHaveCount(0);
  await phone.close();
});
