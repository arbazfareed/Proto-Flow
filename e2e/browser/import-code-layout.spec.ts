import { expect, test, type Locator } from "playwright/test";
import { startWorkspace } from "./workspace";

const HTML = `<header class="nav">
  <div class="logo">Brightly</div>
  <nav class="links"><a href="#">Features</a><a href="#">Pricing</a><a href="#">About</a></nav>
</header>
<section class="hero">
  <h1>Plan your week in minutes</h1>
  <button id="cta" class="cta">Start free</button>
</section>
<section class="cards">
  <article class="card"><h3>Smart lists</h3></article>
  <article class="card"><h3>Calendar sync</h3></article>
  <article class="card"><h3>Weekly review</h3></article>
</section>`;

const CSS = `* { box-sizing: border-box; }
body { margin: 0; font-family: Arial, sans-serif; }
.nav { display: flex; justify-content: space-between; align-items: center; padding: 20px 40px; background: #111827; }
.logo { color: #fff; font-size: 22px; font-weight: bold; }
.links { display: flex; gap: 24px; }
.links a { color: #d1d5db; text-decoration: none; font-size: 16px; }
.hero { padding: 64px 40px; text-align: center; background: #eef2ff; }
.hero h1 { margin: 0 0 16px; font-size: 44px; }
.cta { padding: 14px 28px; border: 0; background: #4f46e5; color: #fff; font-size: 16px; }
.cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; padding: 48px 40px; }
.card { padding: 24px; border: 1px solid #e5e7eb; }
.card h3 { margin: 0; font-size: 20px; }
@media (max-width: 767px) {
  .links { display: none; }
  .cards { grid-template-columns: 1fr; }
}`;

async function box(locator: Locator) {
  const value = await locator.boundingBox();
  if (!value) throw new Error("element has no box");
  return value;
}

test("imported HTML and CSS keep the browser's layout, responsiveness and two-way code sync", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await startWorkspace(page, "Blank project");
  await page.getByRole("button", { name: "Import Code" }).click();
  const dialog = page.getByRole("dialog", { name: "Import code" });
  const htmlEditor = page.getByRole("textbox", { name: "HTML code" });
  await htmlEditor.fill(HTML);
  await page.getByRole("tab", { name: "CSS" }).click();
  await page.getByRole("textbox", { name: "CSS code" }).fill(CSS);
  await page.getByRole("button", { name: "Render on Canvas" }).click();
  await expect(dialog).not.toBeVisible();

  const previewPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview" }).click();
  const preview = await previewPromise;
  await preview.setViewportSize({ width: 1440, height: 900 });

  const logo = await box(preview.getByText("Brightly", { exact: true }));
  const about = await box(preview.getByText("About", { exact: true }));
  const features = await box(preview.getByText("Features", { exact: true }));
  const heading = await box(preview.getByText("Plan your week in minutes", { exact: true }));
  const cta = await box(preview.getByRole("button", { name: "Start free" }));
  const cards = await Promise.all(
    ["Smart lists", "Calendar sync", "Weekly review"].map((name) =>
      box(preview.getByText(name, { exact: true })),
    ),
  );
  // Scale between the page's CSS pixels and the preview frame.
  const scale = (about.x + about.width - logo.x) / (1440 - 80);

  // Flex nav: links packed to the right with a 24px gap, logo at the left padding.
  expect(features.x).toBeGreaterThan(logo.x + 900 * scale);
  // Centred hero: the button and heading share the page's centre line.
  const centre = logo.x + (1440 / 2 - 40) * scale;
  expect(Math.abs(cta.x + cta.width / 2 - centre)).toBeLessThan(4);
  expect(Math.abs(heading.x + heading.width / 2 - centre)).toBeLessThan(6);
  // Three equal grid columns on one row.
  expect(Math.abs(cards[0].y - cards[2].y)).toBeLessThan(2);
  expect(Math.abs((cards[1].x - cards[0].x) - (cards[2].x - cards[1].x))).toBeLessThan(2);
  // Container tag names are never printed as visible text.
  await expect(preview.getByText(/^(section|article|header|nav)$/)).toHaveCount(0);
  await preview.close();

  // Responsive: at a mobile width the media query hides the links and stacks the cards.
  const mobilePreviewPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview" }).click();
  const mobilePreview = await mobilePreviewPromise;
  const devicePreset = mobilePreview.getByRole("combobox", { name: "Device preset" });
  const mobileOption = await devicePreset.locator('optgroup[label="Mobile"] option').first().getAttribute("value");
  await devicePreset.selectOption(mobileOption!);
  await expect(mobilePreview.getByText("Features", { exact: true })).toBeHidden();
  await expect(async () => {
    const [first, second] = await Promise.all(
      ["Smart lists", "Calendar sync"].map((name) => box(mobilePreview.getByText(name, { exact: true }))),
    );
    expect(second.y).toBeGreaterThan(first.y + 20);
    expect(Math.abs(second.x - first.x)).toBeLessThan(2);
  }).toPass();
  await mobilePreview.close();

  // Canvas → code: moving an imported element on the canvas rewrites its position in the HTML.
  await page.getByRole("searchbox", { name: "Search layers" }).fill("cta");
  await page.getByRole("region", { name: "Layers" }).getByText("cta", { exact: true }).first().click();
  const xPosition = page.getByLabel("X", { exact: true });
  await expect(xPosition).not.toHaveValue("Mixed");
  await xPosition.fill("130");
  await xPosition.press("Enter");
  await page.getByRole("button", { name: "Import Code" }).click();
  await expect(htmlEditor).toHaveValue(/id="cta"[^>]*left: 130px !important/);

  // Code → canvas: editing the code and rendering again updates the design.
  await htmlEditor.fill(HTML.replace("Start free", "Get started"));
  await page.getByRole("button", { name: "Render on Canvas" }).click();
  await expect(dialog).not.toBeVisible();
  const editedPreviewPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview" }).click();
  const editedPreview = await editedPreviewPromise;
  await expect(editedPreview.getByRole("button", { name: "Get started" })).toBeVisible();
  await editedPreview.close();
});
