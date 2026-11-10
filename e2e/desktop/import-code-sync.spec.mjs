describe("PF-T808 Windows desktop JavaScript and code synchronization", () => {
  it("converts a listener and synchronizes canvas geometry with imported HTML", async () => {
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
    let htmlEditor = await $('[aria-label="HTML code"]');
    await htmlEditor.setValue('<button id="save">Save</button>');
    await $("#import-code-tab-js").click();
    await $('[aria-label="JS code"]').setValue(
      `document.querySelector("#save").addEventListener("click", (event) => {
        event.currentTarget.textContent = "Saved";
      });`,
    );
    const convertListener = await $(
      '[aria-label="Convert click listener on #save to ProtoFlow rule"]',
    );
    await convertListener.waitForEnabled();
    await convertListener.click();
    await browser.waitUntil(async () =>
      (await convertListener.getAttribute("aria-pressed")) === "true",
    );
    await $('//button[normalize-space(.)="Render on Canvas"]').click();
    await $('[role="dialog"][aria-labelledby="import-code-title"]').waitForDisplayed({ reverse: true });

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
      await $('[aria-label="Preview screen"]').waitForDisplayed({ timeout: 20_000 });
      const saveButton = await $('//button[normalize-space(.)="Save"]');
      await saveButton.click();
      await browser.keys(["ENTER"]);
      await browser.waitUntil(async () =>
        await $('//button[normalize-space(.)="Saved"]').isDisplayed(),
      );
    } finally {
      await browser.closeWindow();
      await browser.switchToWindow(editorWindow);
    }

    const xPosition = await $('[aria-label="X"]');
    await xPosition.waitForEnabled();
    await xPosition.scrollIntoView({ block: "center" });
    await xPosition.click();
    await xPosition.setValue("130");
    await browser.waitUntil(async () => (await xPosition.getValue()) === "130");
    await browser.keys(["ENTER"]);
    await browser.waitUntil(async () => (await xPosition.getValue()) === "130");
    await $('[aria-label="Import Code"]').click();
    htmlEditor = await $('[aria-label="HTML code"]');
    await browser.waitUntil(async () =>
      (await htmlEditor.getValue()).includes("left: 130px !important"),
    );
    await htmlEditor.setValue(
      '<button id="save" style="position:absolute;left:180px;top:200px;width:210px;height:55px">Edited by HTML</button>',
    );
    await $("#import-code-tab-js").click();
    await $('[aria-label="Convert click listener on #save to ProtoFlow rule"]').click();
    await $('//button[normalize-space(.)="Render on Canvas"]').click();
    await $('[role="dialog"][aria-labelledby="import-code-title"]').waitForDisplayed({ reverse: true });

    const updatedXPosition = await $('[aria-label="X"]');
    await updatedXPosition.waitForEnabled();
    await browser.waitUntil(async () =>
      (await updatedXPosition.getValue()) === "180",
    );
  });
});
