import { expect } from "@wdio/globals";

describe("PF-T716 Windows desktop dashboard workflow", () => {
  it("previews the dashboard on multiple devices and exports an offline prototype", async () => {
    const startedAt = Date.now();
    const privacyDialog = await $('[aria-labelledby="privacy-settings-title"]');
    await privacyDialog.waitForDisplayed({ timeout: 60_000 });
    await $('//button[normalize-space(.)="Continue with both off"]').click();

    await $('[aria-labelledby="onboarding-title"]').waitForDisplayed({ timeout: 30_000 });
    await $('//button[normalize-space(.)="Continue"]').click();
    await $(
      '//button[contains(@class,"onboarding-template-card") and .//strong[normalize-space(.)="Dashboard"]]',
    ).click();
    await $('//button[normalize-space(.)="Continue"]').click();
    await $('//button[normalize-space(.)="Got it"]').click();
    await $('//button[normalize-space(.)="Skip tour"]').click();
    await $('//button[normalize-space(.)="Finish"]').click();

    await expect($(".document-name")).toHaveText("Dashboard");
    await $('[aria-label="Export HTML bundle"]').click();
    const htmlExport = await $('[role="dialog"][aria-labelledby="html-export-title"]');
    await htmlExport.waitForDisplayed();
    expect(await htmlExport.getText()).toContain("0 credits · no upload · local export");
    await $('[aria-label="Close HTML export dialog"]').click();

    const editorWindow = await browser.getWindowHandle();
    await $('[aria-label="Open preview"]').click();
    await browser.waitUntil(async () => (await browser.getWindowHandles()).length > 1, {
      timeout: 30_000,
      timeoutMsg: "Native dashboard preview window did not open",
    });
    const previewWindow = (await browser.getWindowHandles()).find((handle) => handle !== editorWindow);
    if (!previewWindow) throw new Error("The native dashboard preview window was not returned.");
    await browser.switchToWindow(previewWindow);
    try {
      const layout = await $('[aria-label="Preview layout"]');
      await layout.waitForDisplayed({ timeout: 20_000 });
      await expect(layout).toHaveValue("single");
      await expect($(".preview-screen")).toBeDisplayed();
      await layout.selectByAttribute("value", "columns");
      await browser.waitUntil(async () => (await $$(".preview-frame-card")).length === 3);
      await expect($$(".preview-frame-card")).toBeElementsArrayOfSize(3);
      expect(await $(".preview-status").getText()).toContain("3 devices");
    } finally {
      await browser.closeWindow();
      await browser.switchToWindow(editorWindow);
    }

    await $('[aria-label="Canvas view options"]').click();
    await $('//button[normalize-space(.)="Flow"]').click();
    await $('[aria-label="Screen flow diagram"]').waitForDisplayed();
    await $('[aria-label="Workspace view"]').$('button[aria-pressed="false"]').click();
    await $('[aria-label="Quick actions"]').click();
    await $('[role="combobox"][aria-label="Filter commands"]').setValue("Version History");
    await $('[role="option"][data-value="Version History"]').click();
    const history = await $('[role="dialog"][aria-labelledby="version-history-title"]');
    await history.waitForDisplayed();
    await history.$("#checkpoint-label").setValue("PF-T716 W1 dashboard");
    await history.$('//button[normalize-space(.)="Create"]').click();
    const checkpoint = await $(
      '//button[contains(@class,"version-history-item") and .//strong[normalize-space(.)="PF-T716 W1 dashboard"]]',
    );
    await checkpoint.waitForDisplayed();
    await expect(checkpoint).toHaveAttribute("aria-pressed", "true");
    expect(Date.now() - startedAt).toBeLessThan(5 * 60 * 1000);
  });
});
