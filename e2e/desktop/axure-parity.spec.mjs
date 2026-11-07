describe("Windows desktop Axure-parity workflows", () => {
  it("opens Flow and creates a local version-history checkpoint", async () => {
    const privacyDialog = await $('[aria-labelledby="privacy-settings-title"]');
    await privacyDialog.waitForDisplayed({ timeout: 60_000 });
    await $('//button[normalize-space(.)="Continue with both off"]').click();

    await $('[aria-labelledby="onboarding-title"]').waitForDisplayed({ timeout: 30_000 });
    await $('//button[normalize-space(.)="Continue"]').click();
    await $(
      '//button[contains(@class,"onboarding-template-card") and .//strong[normalize-space(.)="Responsive web"]]',
    ).click();
    await $('//button[normalize-space(.)="Continue"]').click();
    await $('//button[normalize-space(.)="Got it"]').click();
    await $('//button[normalize-space(.)="Skip tour"]').click();
    await $('//button[normalize-space(.)="Finish"]').click();

    await $('[aria-label="Quick actions"]').waitForDisplayed();
    const canvasViewOptionsButton = await $(
      '.canvas-view-menu-anchor > button[aria-label="Canvas view options"]',
    );
    await canvasViewOptionsButton.click();
    const frameToggle = await $('//button[.//span[normalize-space(.)="Show device frame"]]');
    const safeAreaToggle = await $('//button[.//span[normalize-space(.)="Show safe area"]]');
    const initialFrameState = await frameToggle.getAttribute("aria-pressed");
    const initialSafeAreaState = await safeAreaToggle.getAttribute("aria-pressed");
    await frameToggle.click();
    await expect(frameToggle).toHaveAttribute(
      "aria-pressed",
      initialFrameState === "true" ? "false" : "true",
    );
    await frameToggle.click();
    await expect(frameToggle).toHaveAttribute("aria-pressed", initialFrameState);
    await safeAreaToggle.click();
    await expect(safeAreaToggle).toHaveAttribute(
      "aria-pressed",
      initialSafeAreaState === "true" ? "false" : "true",
    );
    await safeAreaToggle.click();
    await expect(safeAreaToggle).toHaveAttribute("aria-pressed", initialSafeAreaState);

    const orientationToggle = await $('[aria-label="Rotate device orientation"]');
    const initialOrientationLabel = await orientationToggle.getText();
    await orientationToggle.click();
    const orientationChoices = await $('[aria-label="Orientation overflow choices"]');
    if (await orientationChoices.isExisting()) {
      await orientationChoices.$('//button[normalize-space(.)="Rotate widgets too"]').click();
    }
    await expect(orientationToggle).not.toHaveText(initialOrientationLabel);
    await orientationToggle.click();
    if (await orientationChoices.isExisting()) {
      await orientationChoices.$('//button[normalize-space(.)="Keep widgets as-is"]').click();
    }
    await expect(orientationToggle).toHaveText(initialOrientationLabel);

    await canvasViewOptionsButton.click();
    await $('//button[normalize-space(.)="Flow"]').click();
    await $('[aria-label="Screen flow diagram"]').waitForDisplayed();
    await $('[aria-label="Responsive web screen"]').waitForDisplayed();
    await $('[aria-label="Workspace view"]').$('button[aria-pressed="false"]').click();

    await $('[aria-label="Quick actions"]').click();
    const filter = await $('[role="combobox"][aria-label="Filter commands"]');
    await filter.setValue("Version History");
    await $('[role="option"][data-value="Version History"]').click();
    const history = await $('[role="dialog"][aria-labelledby="version-history-title"]');
    await history.waitForDisplayed();
    await history.$("#checkpoint-label").setValue("Desktop parity check");
    await history.$('//button[normalize-space(.)="Create"]').click();
    const checkpoint = await $(
      '//button[contains(@class,"version-history-item") and .//strong[normalize-space(.)="Desktop parity check"]]',
    );
    await checkpoint.waitForDisplayed();
    await expect(checkpoint).toHaveAttribute("aria-pressed", "true");
    expect(await history.getText()).toContain("Stored locally on this device");
  });
});
