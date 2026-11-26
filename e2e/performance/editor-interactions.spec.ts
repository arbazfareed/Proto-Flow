import { expect, test, type Browser, type Page } from "playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { startWorkspace } from "../browser/workspace";

// B44: with many widgets, dragging, duplicating, nudging and selecting must stay close to what they
// cost with one widget. Before the fixes, one drag move cost 127 ms at 300 widgets against 28 ms at 3
// (4.5x) and a duplicate 85 ms against 46 ms (1.85x). Every action is timed from the input until the
// second animation frame after it, and compared with the same action on a project with one widget,
// measured in the same run, so the limits hold on a slow or a fast machine.

const HEAVY = Number(process.env.PF_BENCH_WIDGETS ?? 300);
const SAMPLES = Number(process.env.PF_BENCH_SAMPLES ?? 24);
const ATTEMPTS = 3;
// The same key the app uses for its recovery copy (src/project/autosave.ts).
const AUTOSAVE_KEY = "proto-flow:autosave:v1";

type Measurement = { select: number; nudge: number; dragMove: number; duplicate: number };
type Limits = Record<keyof Measurement, number>;

/**
 * How many times slower than with one widget each action may be. Measured on the dev server in a headless
 * browser with software rendering:
 *   dragMove: 1.0x with the fixes, 4.6-5.0x without them. It separates the two cleanly, so it has a tight limit.
 *   duplicate, nudge, select: noisy (the same code gave 0.6x-2.75x for duplicate, 1.2x-2.8x for select), so they
 *   only have loose limits that catch a large regression.
 */
const RATIO_LIMITS: Limits = { dragMove: 2.5, duplicate: 3.0, nudge: 3.5, select: 5.0 };
/** An absolute ceiling per action, in ms, in case the one-widget run was unusually slow. */
const ABSOLUTE_LIMIT_MS = 400;

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

async function twoFrames(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

/** A fresh session whose project has `count` rectangles, loaded the way a person restores unsaved work. */
async function openProjectWith(browser: Browser, count: number) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, baseURL: "http://127.0.0.1:1421" });
  const page = await context.newPage();
  await startWorkspace(page, "Blank project");

  // Take a valid, saved project from the app itself (so no schema is needed here), fill it with widgets and
  // leave it as the recovery copy. Saving first keeps the app from rewriting that copy when the page reloads.
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download .pflow" }).click();
  const project = JSON.parse(readFileSync(await (await download).path(), "utf8"));
  const widgets = Array.from({ length: count }, (_, i) => ({
    id: crypto.randomUUID(),
    type: "rectangle",
    name: `Box ${i}`,
    x: 20 + (i % 20) * 66,
    y: 20 + Math.floor(i / 20) * 46,
    width: 56,
    height: 36,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    zIndex: i,
    style: { fill: "#7758d7", fillOpacity: 1, stroke: "#343743", strokeWidth: 1, cornerRadius: 6 },
    props: { label: "" },
  }));
  project.screens[0].widgets = widgets;
  const ids = widgets.map((widget) => widget.id);
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [AUTOSAVE_KEY, JSON.stringify({ project, ts: Date.now() })]);

  await page.reload();
  await page.getByRole("button", { name: /Restore project/ }).click();
  await page.waitForFunction(() => Boolean((window as unknown as { Konva?: { stages: unknown[] } }).Konva?.stages.length));
  await page.keyboard.press("Control+0");
  await twoFrames(page);
  await twoFrames(page);
  return { context, page, ids };
}

async function measure(browser: Browser, count: number): Promise<Measurement> {
  const { context, page, ids } = await openProjectWith(browser, count);
  try {
    const centre = (index: number) => page.evaluate(([id]) => {
      type Stage = { findOne: (selector: string) => { getClientRect: () => { x: number; y: number; width: number; height: number } } | undefined; container: () => HTMLElement };
      const stages = (window as unknown as { Konva: { stages: Stage[] } }).Konva.stages;
      for (const stage of stages) {
        const node = stage.findOne("#" + id);
        if (!node) continue;
        const rect = node.getClientRect();
        const origin = stage.container().getBoundingClientRect();
        return { x: origin.x + rect.x + rect.width / 2, y: origin.y + rect.y + rect.height / 2 };
      }
      return null;
    }, [ids[index]] as const);

    const first = await centre(0);
    const second = await centre(Math.min(1, ids.length - 1));
    if (!first || !second) {
      const info = await page.evaluate((list) => {
        const w = window as unknown as { Konva: { stages: Array<{ find: (s: string) => unknown[]; findOne: (s: string) => unknown }> } };
        return { stages: w.Konva.stages.length, rects: w.Konva.stages.map((st) => st.find("Rect").length), found: list.map((id) => w.Konva.stages.some((st) => Boolean(st.findOne("#" + id)))), body: document.body.innerText.slice(0, 200) };
      }, ids.slice(0, 2));
      throw new Error(`The ${count} widgets are not on the canvas: ` + JSON.stringify(info));
    }
    const timed = async (action: () => Promise<void>) => {
      const start = Date.now();
      await action();
      await twoFrames(page);
      return Date.now() - start;
    };

    const selects: number[] = [];
    for (let i = 0; i < SAMPLES; i += 1) {
      const target = i % 2 === 0 ? first : second;
      selects.push(await timed(() => page.mouse.click(target.x, target.y)));
    }
    const nudges: number[] = [];
    for (let i = 0; i < SAMPLES; i += 1) nudges.push(await timed(() => page.keyboard.press(i % 2 ? "ArrowLeft" : "ArrowRight")));

    await page.mouse.click(first.x, first.y);
    await twoFrames(page);
    await page.mouse.move(first.x, first.y);
    await page.mouse.down();
    const moves: number[] = [];
    for (let i = 1; i <= SAMPLES; i += 1) moves.push(await timed(() => page.mouse.move(first.x + i * 3, first.y + i * 2)));
    await page.mouse.up();

    const duplicates: number[] = [];
    for (let i = 0; i < Math.min(SAMPLES, 16); i += 1) duplicates.push(await timed(() => page.keyboard.press("Control+d")));
    return { select: median(selects), nudge: median(nudges), dragMove: median(moves), duplicate: median(duplicates) };
  } finally {
    await context.close();
  }
}

test("B44: editor actions with many widgets stay close to their cost with one widget", async ({ browser }) => {
  const attempts: Array<{ one: Measurement; many: Measurement; ratio: Measurement; failures: string[] }> = [];

  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const one = await measure(browser, 1);
    const many = await measure(browser, HEAVY);
    const ratio = Object.fromEntries(
      (Object.keys(one) as Array<keyof Measurement>).map((key) => [key, Math.round((many[key] / one[key]) * 100) / 100]),
    ) as Measurement;
    const failures = (Object.keys(RATIO_LIMITS) as Array<keyof Measurement>).flatMap((key) => {
      const problems: string[] = [];
      if (ratio[key] > RATIO_LIMITS[key]) problems.push(`${key}: ${ratio[key]}x slower with ${HEAVY} widgets (limit ${RATIO_LIMITS[key]}x)`);
      if (many[key] > ABSOLUTE_LIMIT_MS) problems.push(`${key}: ${many[key]} ms with ${HEAVY} widgets (limit ${ABSOLUTE_LIMIT_MS} ms)`);
      return problems;
    });
    attempts.push({ one, many, ratio, failures });
    console.log(`attempt ${attempt}: 1 widget ${JSON.stringify(one)} | ${HEAVY} widgets ${JSON.stringify(many)} | ratio ${JSON.stringify(ratio)}${failures.length ? " | OVER: " + failures.join("; ") : " | within limits"}`);
    // A busy machine can slow one run; the limits only fail when every attempt is over.
    if (failures.length === 0) break;
  }

  mkdirSync("reports", { recursive: true });
  writeFileSync("reports/editor-interactions-latest.json", JSON.stringify({ widgets: HEAVY, samples: SAMPLES, ratioLimits: RATIO_LIMITS, attempts }, null, 2));
  const best = attempts.reduce((a, b) => (a.failures.length <= b.failures.length ? a : b));
  expect(best.failures, "an action is much slower with many widgets than with one").toEqual([]);
});
