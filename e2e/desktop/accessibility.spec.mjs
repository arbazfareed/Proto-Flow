import { readFileSync } from "node:fs";
import { expect } from "@wdio/globals";

const axeSource = readFileSync(
  new URL("../../node_modules/axe-core/axe.min.js", import.meta.url),
  "utf8",
);

async function expectAccessible(surface) {
  const results = await browser.execute((source) => {
    if (!window.axe) {
      const script = document.createElement("script");
      script.textContent = source;
      document.head.append(script);
    }
    if (!window.axe) return { error: "Could not load axe-core into the Tauri WebView." };
    const activeModal = document.querySelector('[role="dialog"][aria-modal="true"]');
    return window.axe.run(activeModal ?? document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
    });
  }, axeSource);
  if (results.error) throw new Error(results.error);
  const seriousViolations = results.violations.filter((violation) =>
    violation.impact === "critical" || violation.impact === "serious",
  );
  if (seriousViolations.length > 0) {
    throw new Error(
      `axe-core WCAG 2.1 AA violations on desktop ${surface}: ${JSON.stringify(seriousViolations)}`,
    );
  }
}

describe("Windows desktop accessibility", () => {
  it("audits the native workspace and verifies keyboard navigation and focus visibility", async () => {
    const privacyDialog = await $('[aria-labelledby="privacy-settings-title"]');
    await privacyDialog.waitForDisplayed({ timeout: 60_000 });
    await browser.execute(() => document.documentElement.setAttribute("data-theme", "dark"));
    await expectAccessible("privacy preferences (dark theme)");
    await browser.execute(() => document.documentElement.setAttribute("data-theme", "light"));
    await expectAccessible("privacy preferences (light theme)");
    await $('//button[normalize-space(.)="Continue with both off"]').click();

    const welcome = await $('[aria-labelledby="onboarding-title"]');
    await welcome.waitForDisplayed({ timeout: 30_000 });
    await expectAccessible("onboarding");
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
    await expectAccessible("workspace");

    await browser.execute(() => {
      document.querySelector('[aria-label="Quick actions"]')?.focus();
    });
    await browser.keys(["TAB"]);
    const focusStyle = await browser.execute(() => {
      const element = document.activeElement;
      if (!(element instanceof HTMLElement)) return null;
      const style = getComputedStyle(element);
      return {
        tagName: element.tagName,
        focusVisible: element.matches(":focus-visible"),
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
      };
    });
    expect(focusStyle).not.toBeNull();
    expect(focusStyle.tagName).not.toBe("BODY");
    expect(focusStyle.focusVisible).toBe(true);
    expect(focusStyle.outlineStyle).not.toBe("none");
    expect(parseFloat(focusStyle.outlineWidth)).toBeGreaterThan(0);

    await browser.keys(["F1"]);
    const help = await $('[role="dialog"][aria-labelledby="help-title"]');
    await help.waitForDisplayed();
    await expectAccessible("help panel");
    await browser.keys(["Escape"]);
    await help.waitForDisplayed({ reverse: true });
  });
});
