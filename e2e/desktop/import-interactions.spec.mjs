describe("PF-T807 Windows desktop imported DOM interactions", () => {
  it("binds an inspected imported element and navigates in native preview", async () => {
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

    await $('[aria-label="Add screen"]').click();
    const devicePicker = await $('[role="dialog"][aria-labelledby="screen-picker-title"]');
    await devicePicker.waitForDisplayed();
    await devicePicker.$('[aria-label="Search devices"]').setValue("iPhone 15");
    await devicePicker.$(
      '//button[contains(@class,"device-card") and .//strong[normalize-space(.)="iPhone 15"]]',
    ).click();
    await $('[aria-label="Previous screen"]').click();

    await $('[aria-label="Import Code"]').click();
    const dialog = await $('[role="dialog"][aria-labelledby="import-code-title"]');
    await dialog.waitForDisplayed();
    await $('[aria-label="HTML code"]').setValue(
      '<button id="navigate">Go to destination</button>',
    );
    await browser.waitUntil(async () =>
      await browser.execute(() =>
        document.querySelector('iframe[title="Sandboxed code preview"]')
          ?.getAttribute("srcdoc")
          ?.includes("Go to destination") ?? false,
      ),
    );
    await browser.switchToFrame(await $('iframe[title="Sandboxed code preview"]'));
    await $('button#navigate').waitForDisplayed();
    await browser.switchToParentFrame();
    const inspectButton = await $('//button[normalize-space(.)="Inspect elements"]');
    await inspectButton.click();
    await expect(inspectButton).toHaveAttribute("aria-pressed", "true");
    await browser.switchToFrame(await $('iframe[title="Sandboxed code preview"]'));
    await $('button#navigate').waitForDisplayed();
    await browser.execute(() => {
      const button = document.querySelector("#navigate");
      if (!button) throw new Error("Imported preview button is missing.");
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    await browser.waitUntil(async () =>
      await browser.execute(() =>
        document.querySelector("#navigate")?.classList.contains("protoflow-inspected") ?? false,
      ),
    );
    await browser.switchToParentFrame();

    const inspector = await $('[aria-label="DOM inspector"]');
    await browser.waitUntil(async () => (await inspector.getText()).includes("node-1"));
    const destination = await inspector.$('[aria-label="Interaction destination"]');
    const destinationId = await destination.getValue();
    expect(destinationId).not.toBe("");
    await inspector.$('//button[normalize-space(.)="Bind onClick navigation"]').click();
    await browser.waitUntil(async () =>
      (await inspector.getText()).includes("onClick navigates to"),
    );
    await $('//button[normalize-space(.)="Render on Canvas"]').click();
    await dialog.waitForDisplayed({ reverse: true });

    const editorWindow = await browser.getWindowHandle();
    await $('[aria-label="Open preview"]').click();
    await browser.waitUntil(async () => (await browser.getWindowHandles()).length > 1, {
      timeout: 30_000,
      timeoutMsg: "Native preview window did not open",
    });
    const previewWindow = (await browser.getWindowHandles()).find((handle) => handle !== editorWindow);
    if (!previewWindow) throw new Error("Native preview window handle was not returned.");
    await browser.switchToWindow(previewWindow);
    try {
      const screen = await $('[aria-label="Preview screen"]');
      await screen.waitForDisplayed({ timeout: 20_000 });
      await browser.waitUntil(async () =>
        (await screen.getValue()) !== destinationId,
      );
      await $('//button[normalize-space(.)="Go to destination"]').click();
      await browser.waitUntil(async () => (await screen.getValue()) === destinationId, {
        timeout: 15_000,
        timeoutMsg: "Clicking the imported element did not navigate to its bound screen",
      });
    } finally {
      await browser.closeWindow();
      await browser.switchToWindow(editorWindow);
    }
  });
});
