import { describe, expect, it } from "vitest";
import { createEmptyProject, parseProject, serializeProject } from "./schema";
import {
  createDefaultBreakpoints,
  getWidgetsOutsideBreakpointViewport,
  resolveActiveBreakpoint,
  resolveWidgetsForBreakpoint,
  updateWidgetOverride,
} from "./responsive";
import type { Widget } from "./schema";

function makeWidget(overrides: Partial<Widget> = {}): Widget {
  return {
    id: crypto.randomUUID(),
    type: "rectangle",
    x: 100,
    y: 80,
    width: 240,
    height: 120,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    zIndex: 0,
    style: {},
    props: {},
    ...overrides,
  };
}

describe("responsive breakpoints", () => {
  it("creates ordered desktop, tablet, and mobile presets", () => {
    const breakpoints = createDefaultBreakpoints(1280, 800);
    expect(breakpoints.map((item) => item.id)).toEqual(["mobile", "tablet", "desktop"]);
    expect(breakpoints[2]).toMatchObject({ width: 1280, height: 800 });
  });

  it("resolves per-breakpoint geometry, styles, properties, and visibility", () => {
    const widget = makeWidget({
      overrides: {
        mobile: {
          x: 12,
          width: 180,
          visible: false,
          style: { fill: "#123456" },
          props: { label: "Compact" },
        },
      },
    });
    const mobile = createDefaultBreakpoints()[0];
    const [resolved] = resolveWidgetsForBreakpoint([widget], mobile, 1440);

    expect(resolved).toMatchObject({
      x: 12,
      width: 180,
      visible: false,
      style: { fill: "#123456" },
      props: { label: "Compact" },
    });
    expect(widget).toMatchObject({ x: 100, width: 240, visible: true, style: {}, props: {} });
  });

  it("supports hide, stack, fluid cascade modes without mutating source widgets", () => {
    const widgets = [
      makeWidget({ x: 20, y: 20, width: 500, height: 80, cascadeMode: "stack" }),
      makeWidget({ x: 60, y: 50, width: 600, height: 100, zIndex: 1, cascadeMode: "stack" }),
      makeWidget({ x: 80, width: 400, cascadeMode: "fluid" }),
      makeWidget({ cascadeMode: "hide" }),
    ];
    const mobile = createDefaultBreakpoints()[0];
    const resolved = resolveWidgetsForBreakpoint(widgets, mobile, 1440);
    const byId = new Map(resolved.map((widget) => [widget.id, widget]));

    expect(byId.get(widgets[0].id)).toMatchObject({ x: 0, y: 24, width: 390 });
    expect(byId.get(widgets[1].id)).toMatchObject({ x: 0, y: 120, width: 390 });
    expect(byId.get(widgets[2].id)?.width).toBeCloseTo(400 * 390 / 1440);
    expect(byId.get(widgets[3].id)?.visible).toBe(false);
    expect(widgets[0]).toMatchObject({ x: 20, y: 20, width: 500 });
  });

  it("uses a valid default when the transient breakpoint ID is absent or stale", () => {
    const screen = createEmptyProject().screens[0];
    expect(resolveActiveBreakpoint(screen, "missing").id).toBe("desktop");
  });

  it("reports only visible widgets whose bounds exceed the active viewport", () => {
    const visible = makeWidget({ x: 380, width: 20 });
    const hidden = makeWidget({ x: -10, visible: false });
    const mobile = createDefaultBreakpoints()[0];

    expect(getWidgetsOutsideBreakpointViewport([visible, hidden], mobile)).toEqual([visible]);
  });

  it("round-trips responsive screen and widget data and rejects overlapping ranges", () => {
    const project = createEmptyProject();
    const screen = project.screens[0];
    const widget = updateWidgetOverride(makeWidget(), "mobile", {
      x: 24,
      rotation: 15,
    });
    const responsiveProject = {
      ...project,
      screens: [{
        ...screen,
        breakpoints: createDefaultBreakpoints(),
        widgets: [widget],
      }],
    };

    expect(parseProject(serializeProject(responsiveProject))).toEqual(responsiveProject);
    expect(() =>
      parseProject({
        ...responsiveProject,
        screens: [{
          ...responsiveProject.screens[0],
          breakpoints: [
            ...createDefaultBreakpoints(),
            { id: "overlap", name: "Overlap", minWidth: 700, maxWidth: 900, width: 800, height: 600 },
          ],
        }],
      }),
    ).toThrow();
  });
});
