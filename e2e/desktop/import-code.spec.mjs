import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect } from "@wdio/globals";

describe("PF-T803 Windows desktop HTML canvas rendering", () => {
  it("previews code in a sandbox and imports editable elements onto the canvas", async () => {
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
    const iframe = await $('iframe[title="Sandboxed code preview"]');
    await expect(iframe).toHaveAttribute("sandbox", "allow-scripts");
    await browser.waitUntil(async () =>
      (await iframe.getAttribute("srcdoc"))?.includes("connect-src 'none'") ?? false,
    );
    const previewSource = await iframe.getAttribute("srcdoc");
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
      (await iframe.getAttribute("srcdoc"))?.includes('aria-label="Intro"') ?? false,
    );
    await browser.saveScreenshot(path.join(evidenceDirectory, "pf-t802-required-icons.png"));

    await htmlEditor.setValue(
      '<main style="width: 420px; padding: 16px; background-color: #eef2ff"><h1>Desktop import proof</h1><p>Editable canvas content</p><svg viewBox="10 20 100 50" style="width: 200px; height: 100px"><path d="M10 20 L110 20 L110 70 Z" fill="#ff0000" stroke="#111827" stroke-width="2"/></svg><button>Continue</button></main>',
    );
    await browser.waitUntil(async () =>
      (await iframe.getAttribute("srcdoc"))?.includes("Desktop import proof") ?? false,
    );

    await $('//button[normalize-space(.)="Render on Canvas"]').click();
    await dialog.waitForDisplayed({ reverse: true });
    await expect($(".document-name")).toHaveText("Untitled project");
    const layerSearch = await $('[aria-label="Search layers"]');
    await layerSearch.setValue("h1 Desktop import proof");
    await expect(
      await $('//*[contains(@class,"layer-name") and normalize-space(.)="h1 Desktop import proof"]'),
    ).toBeDisplayed();
    await layerSearch.setValue("path");
    await expect(
      await $('//*[contains(@class,"layer-name") and normalize-space(.)="path"]'),
    ).toBeDisplayed();
    await browser.saveScreenshot(path.join(evidenceDirectory, "pf-t803-imported-canvas.png"));
  });
});
