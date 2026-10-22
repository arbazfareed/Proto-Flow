import { describe, expect, it } from "vitest";
import { createEmptyProject } from "./schema";
import {
  autoLayoutScreens,
  buildFlowSvg,
  getInitialFlowPositions,
  getNavigationEdges,
} from "./flow";

function projectWithScreens(count: number) {
  const project = createEmptyProject("Navigation");
  const first = project.screens[0];
  project.screens = [first, ...Array.from({ length: count - 1 }, (_, index) => ({
    ...first,
    id: crypto.randomUUID(),
    name: `Screen ${index + 2}`,
    widgets: [],
    interactionRules: [],
  }))];
  return project;
}

describe("flow diagram model", () => {
  it("extracts navigation actions and preserves condition labels", () => {
    const project = projectWithScreens(2);
    const [source, target] = project.screens;
    source.interactionRules = [{
      id: crypto.randomUUID(),
      widgetId: crypto.randomUUID(),
      event: "onClick",
      conditions: [{ variable: "ready", operator: "equals", value: true }],
      actions: [
        { type: "setVariable", target: "attempts", value: 3 },
        { type: "navigate", target: target.id },
        { type: "show", target: crypto.randomUUID() },
      ],
    }];

    expect(getNavigationEdges(project)).toMatchObject([{
      ruleId: source.interactionRules[0].id,
      actionIndex: 1,
      sourceScreenId: source.id,
      targetScreenId: target.id,
      widgetId: source.interactionRules[0].widgetId,
      label: "ready = true · attempts ← 3",
    }]);
  });

  it("ignores navigation actions whose targets do not exist", () => {
    const project = projectWithScreens(1);
    project.screens[0].interactionRules = [{
      id: crypto.randomUUID(),
      event: "onClick",
      conditions: [],
      actions: [{ type: "navigateTo", target: crypto.randomUUID() }],
    }];
    expect(getNavigationEdges(project)).toEqual([]);
  });

  it("auto-layouts reachable screens by navigation depth and lays out disconnected screens", () => {
    const project = projectWithScreens(4);
    const [first, second, third] = project.screens;
    first.interactionRules = [{
      id: crypto.randomUUID(),
      event: "onClick",
      conditions: [],
      actions: [{ type: "navigate", target: second.id }],
    }];
    second.interactionRules = [{
      id: crypto.randomUUID(),
      event: "onClick",
      conditions: [],
      actions: [{ type: "navigate", target: third.id }],
    }];
    const positions = autoLayoutScreens(project.screens, getNavigationEdges(project), first.id);

    expect(positions[first.id].x).toBeLessThan(positions[second.id].x);
    expect(positions[second.id].x).toBeLessThan(positions[third.id].x);
    expect(positions[project.screens[3].id].x).toBeGreaterThan(positions[third.id].x);
  });

  it("lays out screens when a back-navigation opposes a disconnected-screen layout edge", () => {
    const project = projectWithScreens(2);
    const [start, backNavigation] = project.screens;
    backNavigation.interactionRules = [{
      id: crypto.randomUUID(),
      event: "onClick",
      conditions: [],
      actions: [{ type: "navigate", target: start.id }],
    }];

    const positions = autoLayoutScreens(
      project.screens,
      getNavigationEdges(project),
      start.id,
    );

    expect(positions[start.id].x).toBeLessThan(positions[backNavigation.id].x);
  });

  it("preserves saved positions and exports an SVG with nodes and navigation labels", () => {
    const project = projectWithScreens(2);
    const [source, target] = project.screens;
    source.flowPosition = { x: 420, y: 180 };
    source.interactionRules = [{
      id: crypto.randomUUID(),
      event: "onClick",
      conditions: [],
      actions: [{ type: "navigate", target: target.id }],
    }];
    const positions = getInitialFlowPositions(project.screens, getNavigationEdges(project), source.id);
    const svg = buildFlowSvg(project, positions);

    expect(positions[source.id]).toEqual({ x: 420, y: 180 });
    expect(svg).toContain("<svg");
    expect(svg).toContain(source.name);
    expect(svg).toContain("onClick");
    expect(svg).toContain("marker-end");
  });
});
