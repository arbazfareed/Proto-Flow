import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect } from "@wdio/globals";

describe("PF-T803 Windows desktop HTML canvas rendering", () => {
  it("previews code in a sandbox and imports editable elements onto the canvas", async () => {
    const longSections = Array.from({ length: 6 }, (_, index) =>
      `<section class="long-section"><h2>Milestone ${index + 1}</h2><p>Imported section content ${index + 1}</p></section>`,
    ).join("");
    const fullDocument = `<!doctype html><html><head><title>Desktop child care test</title><style>
      body { color: #333; font-family: Arial, sans-serif; }
      .hero { display: flex; padding: 24px; gap: 20px; background: linear-gradient(90deg, #e4f8ee, #fff); }
      .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
      .card { padding: 16px; border: 1px solid #ddd; border-radius: 12px; }
      .long-section { min-height: 220px; padding: 24px; }
    </style></head><body>
      <main class="hero"><h1>Desktop full document</h1><p>Embedded styles imported</p></main>
      <section class="cards"><article class="card"><h2>First</h2></article><article class="card"><h2>Second</h2></article><article class="card"><h2>Third</h2></article></section>
      <section><table><thead><tr><th>Age group</th></tr></thead><tbody><tr><td>Preschool</td></tr></tbody></table><video aria-label="Program introduction"></video><input type="date" aria-label="Start date"></section>
      ${longSections}
      <script>document.body.dataset.ready = "yes";</script></body></html>`;
    const privacyDialog = await $('[aria-labelledby="privacy-settings-title"]');
    await privacyDialog.waitForDisplayed({ timeout: 60_000 });
    await $('//button[normalize-space(.)="Continue with both off"]').click();

    await $('[aria-labelledby="onboarding-title"]').waitForDisplayed({ timeout: 30_000 });
    await $('//button[normalize-space(.)="Continue"]').click();
    await $(
      '//button[contains(@class,"onboarding-template-card") and .//strong[normalize-space(.)="Blank project"]]',
    ).click();
    await $('//button[normalize-space(.)="Continue"]').click();
    await $('//button[normalize-space(.)="Got it"]').click();
    await $('//button[normalize-space(.)="Skip tour"]').click();
    await $('//button[normalize-space(.)="Finish"]').click();

    await $('[aria-label="Import Code"]').click();
    const dialog = await $('[role="dialog"][aria-labelledby="import-code-title"]');
    await dialog.waitForDisplayed();
    const previewFrame = () => $('iframe[title="Sandboxed code preview"]');
    const getPreviewSource = async () => {
      const frame = await previewFrame();
      if (!await frame.isExisting()) return null;
      return frame.getAttribute("srcdoc");
    };
    const iframe = await previewFrame();
    await expect(iframe).toHaveAttribute("sandbox", "allow-scripts");
    await browser.waitUntil(async () =>
      (await getPreviewSource())?.includes("connect-src 'none'") ?? false,
    );
    const previewSource = await getPreviewSource();
    expect(previewSource).toContain("connect-src 'none'");
    expect(previewSource).toContain("Welcome to ProtoFlow");

    const evidenceDirectory = path.join("test-results", "desktop");
    mkdirSync(evidenceDirectory, { recursive: true });
    await browser.saveScreenshot(path.join(evidenceDirectory, "pf-t801-import-modal.png"));

    const htmlTab = await dialog.$("#import-code-tab-html");
    await htmlTab.click();
    const htmlEditor = await $('[aria-label="HTML code"]');
    await htmlEditor.setValue(
      '<video aria-label="Intro"></video><table><tr><td>Report</td></tr></table><input type="date" aria-label="Start date">',
    );
    const requiredIcons = await $('[aria-label="Required icons"]');
    await browser.waitUntil(async () => (await requiredIcons.getText()).includes("Calendar"));
    expect(await requiredIcons.getText()).toContain("Video");
    expect(await requiredIcons.getText()).toContain("Table");
    await browser.waitUntil(async () =>
      (await getPreviewSource())?.includes('aria-label="Intro"') ?? false,
    );
    await browser.saveScreenshot(path.join(evidenceDirectory, "pf-t802-required-icons.png"));

    await htmlEditor.setValue(fullDocument);
    await browser.waitUntil(async () => (await htmlEditor.getValue()) === fullDocument);
    await browser.waitUntil(async () =>
      (await getPreviewSource())?.includes("Desktop full document") ?? false,
    );
    await browser.saveScreenshot(path.join(evidenceDirectory, "pf-t803-full-document-preview.png"));
    const sandboxSource = await getPreviewSource();
    expect(sandboxSource).toContain(".hero { display: flex;");
    expect(sandboxSource).toContain('document.body.dataset.ready = "yes"');

    await $('//button[normalize-space(.)="Render on Canvas"]').click();
    await dialog.waitForDisplayed({ reverse: true });
    await expect($(".document-name")).toHaveText("Untitled project");
    await $(".toast").waitForDisplayed();
    await expect($(".toast")).toHaveText(/Unlocked \d+ new icons from imported code/);
    const importedTools = await $('[aria-label="Detected in imported code"]');
    const importedTable = await importedTools.$('[aria-label="Add Table"]');
    const importedDatePicker = await importedTools.$('[aria-label="Add Date picker"]');
    const importedVideo = await importedTools.$('[aria-label="Add Video"]');
    await importedTable.waitForDisplayed();
    await importedDatePicker.waitForDisplayed();
    await importedVideo.waitForDisplayed();
    await importedTable.click();
    await expect(importedTable).toHaveAttribute("aria-pressed", "true");
    const layerSearch = await $('[aria-label="Search layers"]');
    await layerSearch.setValue("h1 Desktop full document");
    const expectLayerVisible = async (name) => {
      const selector = `//*[contains(@class,"layer-name") and normalize-space(.)="${name}"]`;
      await browser.waitUntil(async () => (await $$(selector)).length > 0, {
        timeout: 10_000,
        timeoutMsg: `Expected layer "${name}" to appear in the filtered layer list`,
      });
      const matches = await $$(selector);
      await expect(matches[0]).toBeDisplayed();
    };
    await expectLayerVisible("h1 Desktop full document");
    for (const heading of ["h2 First", "h2 Second", "h2 Third"]) {
      await layerSearch.setValue(heading);
      await expectLayerVisible(heading);
    }
    const activeBreakpoint = await $('[aria-label="Active breakpoint"]');
    const selectedBreakpoint = await activeBreakpoint.$("option:checked");
    const desktopHeight = Number((await selectedBreakpoint.getText()).match(/×\s*(\d+)/)?.[1] ?? 0);
    expect(desktopHeight).toBeGreaterThan(900);
    const mobileOption = await activeBreakpoint.$("option*=Mobile");
    await activeBreakpoint.selectByAttribute("value", await mobileOption.getAttribute("value"));
    await importedDatePicker.click();
    await expect(importedDatePicker).toHaveAttribute("aria-pressed", "true");
    const desktopOption = await activeBreakpoint.$("option*=Desktop");
    await activeBreakpoint.selectByAttribute("value", await desktopOption.getAttribute("value"));
    for (let index = 1; index <= 6; index += 1) {
      await layerSearch.setValue(`h2 Milestone ${index}`);
      await expectLayerVisible(`h2 Milestone ${index}`);
    }
    await browser.saveScreenshot(path.join(evidenceDirectory, "pf-t803-imported-canvas.png"));

    await $('[aria-label="Import Code"]').click();
    const reopenedHtml = await $('[aria-label="HTML code"]');
    await expect(reopenedHtml).toHaveValue(fullDocument);
    await $("#import-code-tab-css").click();
    await expect($('[aria-label="CSS code"]')).toHaveValue("");
    await $("#import-code-tab-js").click();
    await expect($('[aria-label="JS code"]')).toHaveValue("");
    await browser.waitUntil(async () =>
      (await getPreviewSource())?.includes("document.body.dataset.ready") ?? false,
    );
  });
});
