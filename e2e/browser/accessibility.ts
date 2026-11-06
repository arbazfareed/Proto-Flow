import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "playwright/test";

export async function expectAccessible(page: Page, surface: string): Promise<void> {
  const activeModal = '[role="dialog"][aria-modal="true"]';
  const builder = new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]);
  if (await page.locator(activeModal).count()) builder.include(activeModal);
  const results = await builder.analyze();
  const seriousViolations = results.violations.filter((violation) =>
    violation.impact === "critical" || violation.impact === "serious",
  );
  const details = seriousViolations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    description: violation.description,
    nodes: violation.nodes.map((node) => ({
      target: node.target,
      summary: node.failureSummary,
    })),
  }));
  expect(details, `axe-core WCAG 2.1 AA violations on ${surface}`).toEqual([]);
}
