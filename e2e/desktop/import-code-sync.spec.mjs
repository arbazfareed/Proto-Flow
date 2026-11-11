import { expect } from "@wdio/globals";

async function replaceEditorValue(editor, value) {
  await editor.click();
  await browser.keys(["\uE009", "a"]);
  await editor.addValue(value);
}

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
    await replaceEditorValue(htmlEditor, '<button id="save">Save</button>');
    expect(await htmlEditor.getValue()).toBe('<button id="save">Save</button>');
    await $("#import-code-tab-js").click();
    await replaceEditorValue(
      await $('[aria-label="JS code"]'),
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
    await expect($(".inspector-top h2")).toHaveText("Save");

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
    await replaceEditorValue(xPosition, "130");
    await browser.waitUntil(async () => (await xPosition.getValue()) === "130");
    await $('[aria-label="Import Code"]').click();
    htmlEditor = await $('[aria-label="HTML code"]');
    await browser.waitUntil(async () =>
      (await htmlEditor.getValue()).includes("left: 130px !important"),
    );
    await replaceEditorValue(
      htmlEditor,
      '<button id="save" style="position:absolute;left:180px;top:200px;width:210px;height:55px">Edited by HTML</button>',
    );
    expect(await htmlEditor.getValue()).toContain(
      'style="position:absolute;left:180px;top:200px;width:210px;height:55px"',
    );
    await $("#import-code-tab-js").click();
    await replaceEditorValue(
      await $('[aria-label="JS code"]'),
      `document.querySelector("#save").addEventListener("click", (event) => {
        event.currentTarget.textContent = "Saved";
      });`,
    );
    await $('[aria-label="Convert click listener on #save to ProtoFlow rule"]').click();
    await $('//button[normalize-space(.)="Render on Canvas"]').click();
    await $('[role="dialog"][aria-labelledby="import-code-title"]').waitForDisplayed({ reverse: true });

    const updatedXPosition = await $('[aria-label="X"]');
    await updatedXPosition.waitForEnabled();
    await expect($(".inspector-top h2")).toHaveText("Edited by HTML");
    await browser.waitUntil(async () =>
      (await updatedXPosition.getValue()) === "180",
    );
  });
});
