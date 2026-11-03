import { describe, expect, it } from "vitest";
import { getWidgetViewportOverflow } from "../devices/frame";
import { createEmptyProject, parseProject, serializeProject } from "./schema";
import {
  createDefaultBreakpoints,
  getWidgetsMissingBreakpointOverrides,
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
          opacity: 0.7,
          cascadeMode: "absolute",
          constraints: { horizontal: "left", vertical: "top" },
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
      opacity: 0.7,
      cascadeMode: "absolute",
      constraints: { horizontal: "left", vertical: "top" },
      visible: false,
      style: { fill: "#123456" },
      props: { label: "Compact" },
    });
    expect(widget).toMatchObject({ x: 100, width: 240, visible: true, style: {}, props: {} });
  });

  it("fits widgets inside each viewport without changing their saved base geometry", () => {
    const widget = makeWidget({
      x: 360,
      y: 820,
      width: 400,
      height: 900,
      rotation: 20,
    });
    const mobile = createDefaultBreakpoints()[0];
    const [resolved] = resolveWidgetsForBreakpoint([widget], mobile, 1440, 900);

    expect(getWidgetViewportOverflow(resolved, mobile)).toBe(0);
    expect(resolved.width).toBeLessThan(widget.width);
    expect(resolved.height).toBeLessThan(widget.height);
    expect(widget).toMatchObject({ x: 360, y: 820, width: 400, height: 900 });
  });

  it("auto-fits an oversized widget while preserving its desktop and tablet overrides", () => {
    const widget = makeWidget({
      x: 800,
      y: 600,
      width: 300,
      height: 240,
      overrides: {
        mobile: { x: 360, width: 200 },
        tablet: { x: 500, width: 240 },
      },
    });
    const [mobile] = resolveWidgetsForBreakpoint([widget], createDefaultBreakpoints()[0], 1440);
    const [tablet] = resolveWidgetsForBreakpoint([widget], createDefaultBreakpoints()[1], 1440);
    const [desktop] = resolveWidgetsForBreakpoint([widget], createDefaultBreakpoints()[2], 1440);

    expect(mobile.x + mobile.width).toBeLessThanOrEqual(390);
    expect(tablet.x + tablet.width).toBeLessThanOrEqual(768);
    expect(desktop).toMatchObject({ x: 800, y: 600, width: 300, height: 240 });
    expect(mobile.x).not.toBe(widget.x);
    expect(widget.overrides).toEqual({
      mobile: { x: 360, width: 200 },
      tablet: { x: 500, width: 240 },
    });
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

  it("uses breakpoint-specific cascade modes and constraints", () => {
    const widget = makeWidget({
      x: 1200,
      width: 200,
      cascadeMode: "hide",
      constraints: { horizontal: "right", vertical: "top" },
      overrides: {
        mobile: {
          cascadeMode: "absolute",
          constraints: { horizontal: "left", vertical: "top" },
        },
      },
    });
    const [mobile] = resolveWidgetsForBreakpoint(
      [widget],
      createDefaultBreakpoints()[0],
      1440,
    );
    const [tablet] = resolveWidgetsForBreakpoint(
      [widget],
      createDefaultBreakpoints()[1],
      1440,
    );

    expect(mobile.visible).toBe(true);
    expect(mobile.x).toBe(190);
    expect(tablet.visible).toBe(false);
    expect(widget.cascadeMode).toBe("hide");
    expect(widget.constraints).toEqual({ horizontal: "right", vertical: "top" });
  });

  it("hides desktop-only widgets in opt-in compact layouts while retaining explicit compact overrides", () => {
    const desktopOnly = makeWidget({ x: 80, y: 90, width: 400, height: 100 });
    const compactWidget = makeWidget({
      x: 800,
      y: 600,
      width: 300,
      height: 80,
      cascadeMode: "absolute",
      overrides: { mobile: { x: 16, y: 24, width: 358, height: 80, visible: true } },
    });
    const mobile = createDefaultBreakpoints()[0];
    const resolved = resolveWidgetsForBreakpoint(
      [desktopOnly, compactWidget],
      mobile,
      1440,
      900,
      true,
    );

    expect(resolved[0].visible).toBe(false);
    expect(resolved[1]).toMatchObject({ x: 16, y: 24, width: 358, visible: true });
    expect(desktopOnly.visible).toBe(true);
  });

  it("scales compact mobile widgets vertically to fit shorter phone viewports", () => {
    const widget = makeWidget({
      x: 18,
      y: 800,
      width: 354,
      height: 40,
      cascadeMode: "absolute",
      props: { fontSize: 12 },
      overrides: { mobile: { x: 18, y: 800, width: 354, height: 40, visible: true } },
    });
    const shortPhone = { ...createDefaultBreakpoints()[0], width: 375, height: 667 };
    const [resolved] = resolveWidgetsForBreakpoint([widget], shortPhone, 1440, 900, true);

    expect(resolved.y).toBeCloseTo(800 * 667 / 844);
    expect(resolved.x).toBeCloseTo(18 * 375 / 390);
    expect(resolved.width).toBeCloseTo(354 * 375 / 390);
    expect(resolved.y + resolved.height).toBeLessThanOrEqual(667);
    expect(resolved.props.fontSize).toBe(10);
    expect(widget).toMatchObject({ y: 800, height: 40 });
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

  it("applies pin, center, stretch, and scaling constraints against the base viewport", () => {
    const breakpoint = createDefaultBreakpoints()[0];
    const constrained = makeWidget({
      x: 100,
      y: 50,
      width: 1200,
      height: 700,
      constraints: { horizontal: "stretch", vertical: "stretch" },
    });
    const rightBottom = makeWidget({
      x: 100,
      y: 100,
      width: 200,
      height: 100,
      constraints: { horizontal: "right", vertical: "bottom" },
    });
    const center = makeWidget({
      x: 620,
      y: 400,
      width: 200,
      height: 100,
      constraints: { horizontal: "center", vertical: "center" },
    });
    const scaled = makeWidget({
      constraints: { horizontal: "scale", vertical: "scale" },
    });
    const byId = new Map(
      resolveWidgetsForBreakpoint(
        [constrained, rightBottom, center, scaled],
        breakpoint,
        1440,
        900,
      ).map((widget) => [widget.id, widget]),
    );

    expect(byId.get(constrained.id)).toMatchObject({ x: 100, width: 150, y: 50, height: 644 });
    expect(byId.get(rightBottom.id)).toMatchObject({ x: 0, y: 144 });
    expect(byId.get(center.id)).toMatchObject({ x: 95, y: 372 });
    expect(byId.get(scaled.id)?.width).toBeCloseTo(scaled.width * 390 / 1440);
    expect(byId.get(scaled.id)?.height).toBeCloseTo(scaled.height * 844 / 900);
  });

  it("warns only for important, visible widgets without an override at the breakpoint", () => {
    const important = makeWidget({ important: true });
    const overridden = makeWidget({
      important: true,
      overrides: { mobile: {} },
    });
    const hidden = makeWidget({ important: true, visible: false });

    expect(
      getWidgetsMissingBreakpointOverrides([important, overridden, hidden], "mobile"),
    ).toEqual([important]);
  });

  it("round-trips responsive screen and widget data and rejects overlapping ranges", () => {
    const project = createEmptyProject();
    const screen = project.screens[0];
    const widget = updateWidgetOverride(makeWidget({
      important: true,
      constraints: { horizontal: "right", vertical: "bottom" },
    }), "mobile", {
      x: 24,
      rotation: 15,
      opacity: 0.6,
      cascadeMode: "fluid",
      constraints: { horizontal: "left", vertical: "top" },
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
