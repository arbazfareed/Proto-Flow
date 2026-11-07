import { expect } from "@wdio/globals";

const tutorialSteps = [
  "Select a shape",
  "Move it on the canvas",
  "Change its style",
  "Add a button",
  "Create a navigation rule",
  "Open the preview",
  "Try the interaction",
  "Check the device frame",
  "Try a mobile override",
  "Switch panel states",
  "Edit repeater data",
  "Use an expression",
  "Try the AI generator",
  "View the flow",
  "Export and start creating",
];

async function completeTutorial() {
  const tutorial = await $('[data-testid="tutorial-guide"]');
  await tutorial.waitForDisplayed({ timeout: 30_000 });
  for (const [index, title] of tutorialSteps.entries()) {
    await browser.waitUntil(async () =>
      (await tutorial.$(".tutorial-guide-content h2").getText()) === title,
    );
    if (index === tutorialSteps.length - 1) {
      await tutorial.$('//button[normalize-space(.)="Finish"]').click();
    } else {
      await tutorial.$('//button[normalize-space(.)="Next"]').click();
    }
  }
  await tutorial.waitForDisplayed({ reverse: true });
}

describe("Windows desktop first launch", () => {
  it("opens the native app, completes privacy setup, and reaches a working canvas", async () => {
    const privacyDialog = await $('[aria-labelledby="privacy-settings-title"]');
    await privacyDialog.waitForDisplayed({ timeout: 60_000 });
    await $('//button[normalize-space(.)="Continue with both off"]').click();

    const welcome = await $('[aria-labelledby="onboarding-title"]');
    await welcome.waitForDisplayed({ timeout: 30_000 });
    await expect(welcome.$("h1")).toHaveText("From first sketch to clickable prototype.");
    await $('//button[@role="radio" and .//strong[normalize-space(.)="Light"]]').click();
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
    const savedOnboarding = await browser.execute(() =>
      JSON.parse(localStorage.getItem("protoflow.onboarding.v1") ?? "null"),
    );
    expect(savedOnboarding).toMatchObject({
      hasCompletedOnboarding: true,
      theme: "light",
      selectedTemplate: "blank",
      deviceTourCompleted: true,
    });

    await $('[aria-label="Open privacy and diagnostics settings"]').click();
    const settings = await $('[aria-labelledby="privacy-settings-title"]');
    await settings.$('//button[normalize-space(.)="Show onboarding again"]').click();
    const restartedWelcome = await $('[aria-labelledby="onboarding-title"]');
    await restartedWelcome.waitForDisplayed();
    await browser.keys(["TAB"]);
    const focusRemainedInOnboarding = await browser.execute(() =>
      document.querySelector('[aria-labelledby="onboarding-title"]')
        ?.contains(document.activeElement) ?? false,
    );
    expect(focusRemainedInOnboarding).toBe(true);

    await $('//button[normalize-space(.)="Continue"]').click();
    await $('//button[normalize-space(.)="Continue"]').click();
    await $('//button[normalize-space(.)="Got it"]').click();
    await $('//button[normalize-space(.)="Skip tour"]').click();
    await $('//button[normalize-space(.)="Take the tour"]').click();
    const tutorial = await $('[data-testid="tutorial-guide"]');
    await tutorial.waitForDisplayed();
    await expect(tutorial.$(".tutorial-guide-content h2")).toHaveText("Select a shape");
    await tutorial.$('[aria-label="Close tutorial"]').click();
    await expect($(".document-name")).toHaveText("Untitled project");

    const showWorkspacePanel = await $('[aria-label="Show workspace panel"]');
    if (await showWorkspacePanel.isExisting()) await showWorkspacePanel.click();
    await $('//button[.//span[normalize-space(.)="Open tutorial project"]]').click();
    await completeTutorial();
    await expect($(".document-name")).toHaveText("Untitled project");

    await browser.keys(["F1"]);
    const help = await $('[role="dialog"][aria-labelledby="help-title"]');
    await help.waitForDisplayed();
    expect(await help.$(".help-panel-footer").getText()).toContain("56 guides");
    await help.$('[aria-label="Search help articles"]').setValue("device frames");
    await help.$('//button[contains(@class,"help-nav-article") and .//strong[normalize-space(.)="Device frames overview"]]').click();
    await expect(help.$("h1")).toHaveText("Device frames overview");
    await help.$('//button[normalize-space(.)="Start interactive tutorial"]').click();
    await completeTutorial();
    await expect($(".document-name")).toHaveText("Untitled project");
  });
});
