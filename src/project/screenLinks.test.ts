import { describe, expect, it } from "vitest";
import { createEmptyProject, parseProject, type Project } from "./schema";
import { findLinksToScreen, repointScreenLinks } from "./screenLinks";

function projectWithLinks(): { project: Project; home: string; checkout: string; help: string } {
  const base = createEmptyProject("Links");
  const template = base.screens[0];
  const [home, checkout, help] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  const rule = (id: string, actions: { type: string; target: string }[]) => ({
    id, event: "onClick" as const, conditions: [], conditionMode: "all" as const, actions,
  });
  const project = parseProject({
    ...base,
    startScreenId: home,
    screens: [
      { ...template, id: home, name: "Home", interactionRules: [
        rule(crypto.randomUUID(), [{ type: "navigate", target: checkout }]),
        rule(crypto.randomUUID(), [{ type: "navigate", target: checkout }, { type: "navigate", target: help }]),
      ] },
      { ...template, id: checkout, name: "Checkout", interactionRules: [
        rule(crypto.randomUUID(), [{ type: "navigate", target: home }]),
      ] },
      { ...template, id: help, name: "Help", interactionRules: [] },
    ],
  });
  return { project, home, checkout, help };
}

describe("links between screens (B84)", () => {
  it("finds the links from other screens to a screen", () => {
    const { project, home, checkout, help } = projectWithLinks();
    expect(findLinksToScreen(project, checkout)).toHaveLength(2);
    expect(findLinksToScreen(project, home)).toHaveLength(1);
    expect(findLinksToScreen(project, help)).toHaveLength(1);
  });

  it("re-points links to another screen", () => {
    const { project, home, checkout, help } = projectWithLinks();
    const next = repointScreenLinks(project, checkout, help);
    expect(findLinksToScreen(next, checkout)).toHaveLength(0);
    expect(findLinksToScreen(next, help)).toHaveLength(3);
    expect(() => parseProject(next)).not.toThrow();
    expect(next.screens.find((screen) => screen.id === home)?.interactionRules).toHaveLength(2);
  });

  it("removes links, and rules left with nothing to do", () => {
    const { project, home, checkout, help } = projectWithLinks();
    const next = repointScreenLinks(project, checkout, null);
    const rules = next.screens.find((screen) => screen.id === home)?.interactionRules ?? [];
    expect(rules).toHaveLength(1);
    expect(rules[0].actions).toEqual([expect.objectContaining({ type: "navigate", target: help })]);
    expect(findLinksToScreen(next, checkout)).toHaveLength(0);
  });
});
