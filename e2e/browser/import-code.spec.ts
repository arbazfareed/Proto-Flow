import { expect, test } from "playwright/test";
import { startWorkspace } from "./workspace";

const CHILD_CARE_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Little Stars Child Care</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; font-family: Arial, sans-serif; }
body { color: #333; background: #fff; line-height: 1.6; }
header { background: white; padding: 18px 8%; display: flex; justify-content: space-between; align-items: center; }
.logo { font-size: 25px; font-weight: bold; color: #39a982; }
nav { display: flex; gap: 25px; }
nav a { color: #333; text-decoration: none; font-weight: 600; }
.hero { min-height: 570px; background: linear-gradient(90deg, #e4f8ee 45%, #fff); display: flex; align-items: center; justify-content: space-between; padding: 70px 8%; gap: 40px; }
.hero-content { max-width: 550px; }
.hero h1 { font-size: 52px; line-height: 1.2; color: #254b3c; margin-bottom: 20px; }
.hero img { width: 48%; max-width: 550px; height: 380px; object-fit: cover; border-radius: 25px; }
section { padding: 80px 8%; }
.cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 25px; }
.card { background: white; padding: 25px; border-radius: 18px; text-align: center; box-shadow: 0 5px 20px #ddd; }
.card img { width: 100%; height: 200px; object-fit: cover; border-radius: 12px; }
.faq-item { border-bottom: 1px solid #ddd; padding: 20px 0; }
.faq-answer { display: none; }
.faq-item.active .faq-answer { display: block; }
@media (max-width: 600px) {
  .hero { flex-direction: column; text-align: center; }
  .hero h1 { font-size: 38px; }
  .cards { grid-template-columns: 1fr; }
}
</style>
</head>
<body>
<header><div class="logo">Little Stars</div><nav><a href="#home">Home</a><a href="#programs">Programs</a><a href="#contact">Contact</a></nav></header>
<section class="hero" id="home"><div class="hero-content"><h1>A Happy Place Where Little Minds Grow</h1><p>A safe, loving and fun environment where children learn, explore and grow.</p><a href="#contact">Book a Free Tour</a></div><img src="https://images.unsplash.com/photo-1503454537195-1dcabb73ffb9?w=900" alt="Happy child playing"></section>
<section class="cards" id="programs"><article class="card"><img src="https://images.unsplash.com/photo-1516627145497-ae6968895b74?w=600" alt="Infant care"><h2>Infant Care</h2><p>Gentle, loving care for babies.</p></article><article class="card"><img src="https://images.unsplash.com/photo-1471286174890-9c112ffca5b4?w=600" alt="Toddler learning"><h2>Toddler Program</h2><p>Activities that encourage exploration.</p></article><article class="card"><img src="https://images.unsplash.com/photo-1503919005314-30d93d07d823?w=600" alt="Preschool children"><h2>Preschool</h2><p>Early education through creative play.</p></article></section>
<section><div class="faq-item"><div class="faq-question">What ages do you accept?<span>+</span></div><div class="faq-answer">Infant, toddler and preschool programs.</div></div></section>
<section class="library-examples"><h2>Program tools</h2><table><thead><tr><th>Age group</th></tr></thead><tbody><tr><td>Preschool</td></tr></tbody></table><video aria-label="Program introduction"></video><input type="date" aria-label="Start date"></section>
<script>
document.querySelector(".faq-question").addEventListener("click", event => {
  const item = event.currentTarget.parentElement;
  item.classList.toggle("active");
  event.currentTarget.querySelector("span").textContent = item.classList.contains("active") ? "−" : "+";
});
</script>
</body>
</html>`;

test("PF-T803 imports nested HTML and SVG as editable Konva canvas elements", async ({
  page,
}, testInfo) => {
  await startWorkspace(page, "Blank project");
  await page.getByRole("button", { name: "Import Code" }).click();

  const dialog = page.getByRole("dialog", { name: "Import code" });
  const preview = page.getByTitle("Sandboxed code preview");
  await expect(dialog).toBeVisible();
  await expect(preview).toHaveAttribute("sandbox", "allow-scripts");
  await expect(preview).not.toHaveAttribute("sandbox", /allow-same-origin/);
  await expect(preview).toHaveAttribute("srcdoc", /connect-src 'none'/);
  const frame = page.frameLocator('iframe[title="Sandboxed code preview"]');
  await expect(frame.getByRole("heading", { name: "Welcome to ProtoFlow" })).toBeVisible();
  await testInfo.attach("PF-T801-import-modal-preview", {
    body: await page.screenshot({ path: testInfo.outputPath("pf-t801-import-modal.png") }),
    contentType: "image/png",
  });

  await frame.getByRole("button", { name: "Try it" }).click();
  await expect(frame.getByRole("button", { name: "It works!" })).toBeVisible();

  const htmlEditor = page.getByRole("textbox", { name: "HTML code" });
  const requiredIcons = page.getByLabel("Required icons");
  await htmlEditor.fill(
    '<video aria-label="Intro"></video><table><tr><td>Report</td></tr></table><input type="date" aria-label="Start date">',
  );
  await expect(requiredIcons).toContainText("Video");
  await expect(requiredIcons).toContainText("Table");
  await expect(requiredIcons).toContainText("Calendar");
  await expect(frame.getByText("Report")).toBeVisible();
  await testInfo.attach("PF-T802-required-icon-matches", {
    body: await page.screenshot({ path: testInfo.outputPath("pf-t802-required-icons.png") }),
    contentType: "image/png",
  });

  await htmlEditor.fill(CHILD_CARE_PAGE);
  await expect(frame.getByRole("heading", { name: "A Happy Place Where Little Minds Grow" })).toBeVisible();
  await expect.poll(() => frame.locator(".hero").evaluate((element) =>
    getComputedStyle(element).backgroundImage,
  )).toContain("linear-gradient");
  await frame.locator(".faq-question").click();
  await expect(frame.locator(".faq-answer")).toBeVisible();
  await expect(frame.locator(".faq-question span")).toHaveText("−");

  await page.getByRole("tab", { name: "HTML" }).click();
  await page.getByRole("button", { name: "Render on Canvas" }).click();
  await expect(page.locator(".toast")).toContainText(/Unlocked \d+ new icons from imported code/);
  await expect(dialog).not.toBeVisible();
  const importedTools = page.getByRole("region", { name: "Detected in imported code" });
  const importedTable = importedTools.getByRole("button", { name: "Add Table" });
  await expect(importedTable).toBeVisible();
  await expect(importedTools.getByRole("group", { name: "Forms" })
    .getByRole("button", { name: "Add Date picker" })).toBeVisible();
  await expect(importedTools.getByRole("group", { name: "Display" })
    .getByRole("button", { name: "Add Video" })).toBeVisible();
  await importedTable.dragTo(page.locator(".canvas-stage-surface"));
  const layerSearch = page.getByRole("searchbox", { name: "Search layers" });
  await layerSearch.fill("Table");
  await expect(page.locator(".layer-row").filter({
    has: page.locator(".layer-name", { hasText: "Table" }),
  }).first()).toBeVisible();
  await layerSearch.fill("h1 A Happy Place");
  await expect(page.locator(".layer-row").filter({
    has: page.locator(".layer-name", { hasText: "h1 A Happy Place" }),
  })).toBeVisible();
  await layerSearch.fill("article card");
  await expect(page.locator(".layer-row").filter({
    has: page.locator(".layer-name", { hasText: "article card" }),
  })).toHaveCount(3);
  const activeBreakpoint = page.getByLabel("Active breakpoint");
  const desktopBreakpoint = activeBreakpoint.locator("option:checked");
  const desktopHeight = await desktopBreakpoint.evaluate((option) =>
    Number(option.textContent?.match(/×\s*(\d+)/)?.[1] ?? 0),
  );
  expect(desktopHeight).toBeGreaterThan(900);
  await expect(page.locator(".save-state-label")).toHaveText("Unsaved changes");
  await testInfo.attach("PF-T801-imported-canvas-elements", {
    body: await page.screenshot({ path: testInfo.outputPath("pf-t803-imported-canvas.png") }),
    contentType: "image/png",
  });

  const mobileOption = activeBreakpoint.locator("option", { hasText: "Mobile" });
  await activeBreakpoint.selectOption(await mobileOption.getAttribute("value") ?? "");
  const mobileHeight = await activeBreakpoint.locator("option:checked").evaluate((option) =>
    Number(option.textContent?.match(/×\s*(\d+)/)?.[1] ?? 0),
  );
  expect(mobileHeight).toBeGreaterThan(844);
  await expect(importedTable).toBeVisible();
  const datePicker = importedTools.getByRole("button", { name: "Add Date picker" });
  await datePicker.click();
  await expect(datePicker).toHaveAttribute("aria-pressed", "true");
  const desktopOption = activeBreakpoint.locator("option", { hasText: "Desktop" });
  await activeBreakpoint.selectOption(await desktopOption.getAttribute("value") ?? "");

  await page.getByRole("button", { name: "Import Code" }).click();
  const reopenedHtml = page.getByRole("textbox", { name: "HTML code" });
  await expect(reopenedHtml).toHaveValue(CHILD_CARE_PAGE);
  await page.getByRole("tab", { name: "JS" }).click();
  await expect(page.getByRole("textbox", { name: "JS code" })).toHaveValue("");
  await expect(page.getByTitle("Sandboxed code preview")).toHaveAttribute("srcdoc", /faq-question/);
});
