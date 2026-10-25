import { describe, expect, it } from "vitest";
import { createEmptyProject } from "./schema";
import {
  autoLayoutScreens,
  buildFlowSvg,
  getFlowViewportBounds,
  getInitialFlowPositions,
  getNavigationEdges,
  getVisibleFlowScreens,
  isFlowEdgeInViewport,
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

  it("culls flow nodes and edges outside the panned and zoomed viewport", () => {
    const project = projectWithScreens(3);
    const [source, target, offscreen] = project.screens;
    source.flowPosition = { x: 100, y: 100 };
    target.flowPosition = { x: 500, y: 100 };
    offscreen.flowPosition = { x: 2_000, y: 2_000 };
    source.interactionRules = [{
      id: crypto.randomUUID(),
      event: "onClick",
      conditions: [],
      actions: [{ type: "navigate", target: target.id }],
    }];
    const edges = getNavigationEdges(project);
    const positions = Object.fromEntries(project.screens.map((screen) => [
      screen.id,
      screen.flowPosition!,
    ]));
    const viewport = getFlowViewportBounds(800, 600, { x: -80, y: -60 }, 1);

    expect(getVisibleFlowScreens(project.screens, positions, viewport).map((screen) => screen.id))
      .toEqual([source.id, target.id]);
    expect(isFlowEdgeInViewport(edges[0], positions, viewport)).toBe(true);
    expect(getFlowViewportBounds(800, 600, { x: 0, y: 0 }, 2).width)
      .toBeLessThan(getFlowViewportBounds(800, 600, { x: 0, y: 0 }, 1).width);
    expect(() => getFlowViewportBounds(800, 600, { x: 0, y: 0 }, 0)).toThrow(RangeError);
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

  it("exports widget annotation markers and escaped note details", () => {
    const project = projectWithScreens(1);
    project.screens[0].widgets = [{
      id: crypto.randomUUID(),
      type: "button",
      x: 10,
      y: 20,
      width: 120,
      height: 40,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      zIndex: 0,
      style: {},
      props: {},
      notes: {
        description: "Keep <checkout> accessible",
        requirementId: "REQ-9",
        priority: "critical",
        status: "approved",
        tags: ["accessibility"],
        custom: {},
      },
    }];
    const svg = buildFlowSvg(project, getInitialFlowPositions(
      project.screens,
      [],
      project.startScreenId,
    ));

    expect(svg).toContain('fill="#e04f59"');
    expect(svg).toContain("Keep &lt;checkout&gt; accessible");
  });
});
