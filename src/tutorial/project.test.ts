import { describe, expect, it } from "vitest";
import { collectWidgetsDeep } from "../project/dynamicPanels";
import { createTutorialProjectCopy } from "./project";

describe("interactive tutorial project", () => {
  it("ships the requested screens and Axure-parity examples", () => {
    const project = createTutorialProjectCopy();
    expect(project.screens.map((screen) => screen.name)).toEqual([
      "Home",
      "Details",
      "Settings",
      "Dashboard",
    ]);
    expect(project.screens[0].device?.presetId).toBe("iphone-15");
    expect(project.screens[1].device?.presetId).toBe("iphone-15");
    expect(project.screens[3].device?.presetId).toBe("desktop-1440-900");
    expect(project.variables).toHaveLength(4);
    expect(project.screens[0].widgets.find((widget) => widget.type === "dynamic-panel")?.props.states).toHaveLength(3);
    expect(project.screens[0].widgets.find((widget) => widget.type === "repeater")?.props.dataset).toHaveLength(5);
    expect(project.screens.flatMap((screen) => screen.widgets).some((widget) => widget.notes?.requirementId === "REQ-HOME-01")).toBe(true);
    expect(project.screens.find((screen) => screen.name === "Settings")?.widgets.find((widget) => widget.props.richText === true)).toBeDefined();
    expect(project.screens.reduce((count, screen) => count + screen.interactionRules.length, 0)).toBeGreaterThanOrEqual(3);
    expect(project.screens[0].interactionRules.some((rule) => rule.actions.some((action) => action.type === "navigate"))).toBe(true);
    expect(project.screens[0].interactionRules.some((rule) => rule.actions.some((action) => action.type === "show"))).toBe(true);
    expect(project.screens[0].interactionRules.some((rule) => rule.actions.some((action) => action.type === "setPanelState"))).toBe(true);
    expect(collectWidgetsDeep(project.screens[0].widgets).some((widget) => widget.props.text === "Updated: [[now()]]")).toBe(true);
  });

  it("creates an isolated editable copy each time", () => {
    const first = createTutorialProjectCopy();
    const second = createTutorialProjectCopy();
    expect(first.id).not.toBe(second.id);
    expect(first.screens[0].id).toBe(second.screens[0].id);
  });
});
