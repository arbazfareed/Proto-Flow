describe("Windows desktop first launch", () => {
  it("opens the native app, completes privacy setup, and reaches a working canvas", async () => {
    const privacyDialog = await $('[aria-labelledby="privacy-settings-title"]');
    await privacyDialog.waitForDisplayed({ timeout: 60_000 });
    await $('//button[normalize-space(.)="Continue with both off"]').click();

    const welcome = await $('[aria-labelledby="onboarding-title"]');
    await welcome.waitForDisplayed({ timeout: 30_000 });
    await expect(welcome.$("h1")).toHaveText("From first sketch to clickable prototype.");
    await $('//button[normalize-space(.)="Continue"]').click();

    const blankTemplate = await $(
      '//button[contains(@class,"onboarding-template-card") and .//strong[normalize-space(.)="Blank project"]]',
    );
    await blankTemplate.click();
    await $('//button[normalize-space(.)="Continue"]').click();
    await $('//button[normalize-space(.)="Got it"]').click();
    await $('//button[normalize-space(.)="Skip tour"]').click();
    await $('//button[normalize-space(.)="Finish"]').click();

    await expect($('[aria-label="Quick actions"]')).toBeDisplayed();
    await expect($('[data-onboarding-target="canvas"]')).toBeDisplayed();
    await expect($(".document-name")).toHaveText("Untitled project");
  });
});
