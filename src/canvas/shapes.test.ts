import { describe, expect, it } from "vitest";
import { createEmptyProject } from "../project/schema";
import { ELEMENT_LIBRARY_TOOL_TYPES } from "./shapeTools";
import { CANVAS_ICON_NAMES, renderCanvasIconSvg } from "./iconLibrary";
import {
  createShapeWidget,
  getShapeDefinition,
  measureTextBounds,
  MAX_WIDGET_TEXT_LENGTH,
  SHAPE_TOOLS,
} from "./shapes";

describe("canvas shape registry", () => {
  it("registers each creation tool and its expected defaults", () => {
    expect(SHAPE_TOOLS).toEqual([
      "rectangle",
      "ellipse",
      "text",
      "line",
      "arrow",
      "icon",
      "button",
      "input",
      "image",
      "checkbox",
      "radio",
      "toggle",
    ]);
    expect(SHAPE_TOOLS.map((tool) => getShapeDefinition(tool)?.label)).toEqual([
      "Rectangle",
      "Ellipse",
      "Text",
      "Line",
      "Arrow",
      "Icon",
      "Button",
      "Input",
      "Image",
      "Checkbox",
      "Radio",
      "Toggle",
    ]);
    expect(
      SHAPE_TOOLS.map((tool) => {
        const definition = getShapeDefinition(tool);
        return [definition?.width, definition?.height];
      }),
    ).toEqual([
      [100, 100],
      [100, 100],
      [64, 32],
      [200, 1],
      [200, 1],
      [32, 32],
      [120, 40],
      [240, 40],
      [200, 200],
      [160, 24],
      [160, 24],
      [60, 32],
    ]);
  });

  it("registers widget props and creates each visual widget with isolated defaults", () => {
    expect(getShapeDefinition("button")?.props).toMatchObject({
      label: "Button",
      variant: "primary",
      state: "default",
    });
    expect(getShapeDefinition("input")?.props).toMatchObject({
      label: "",
      placeholder: "Enter text…",
      value: "",
      type: "text",
    });
    expect(getShapeDefinition("checkbox")?.props).toEqual({
      label: "Checkbox",
      checked: false,
    });
    expect(getShapeDefinition("radio")?.props).toEqual({
      label: "Radio",
      selected: false,
      groupName: "radio-group",
    });
    expect(getShapeDefinition("toggle")?.props).toEqual({ on: false, label: "" });

    const firstButton = createShapeWidget("button", 0, 0);
    firstButton.props.label = "Submit";
    expect(createShapeWidget("button", 0, 0).props.label).toBe("Button");
  });

  it("creates a visible, editable canvas definition for every library tool", () => {
    expect(ELEMENT_LIBRARY_TOOL_TYPES.length).toBeGreaterThanOrEqual(65);
    for (const type of ELEMENT_LIBRARY_TOOL_TYPES) {
      const definition = getShapeDefinition(type);
      expect(definition, `missing canvas definition for ${type}`).toBeDefined();
      expect(definition?.component, `missing canvas renderer for ${type}`).toBeDefined();
      expect(createShapeWidget(type, 12, 24)).toMatchObject({
        type,
        x: 12,
        y: 24,
        visible: true,
        locked: false,
      });
    }
  });

  it("creates list elements with visible bullet-list defaults", () => {
    expect(getShapeDefinition("list")).toMatchObject({
      width: 220,
      height: 96,
      props: {
        items: ["List item 1", "List item 2", "List item 3"],
        listStyle: "bullet",
        fontSize: 16,
      },
    });
    expect(createShapeWidget("list", 12, 24).props.items).toEqual([
      "List item 1",
      "List item 2",
      "List item 3",
    ]);
  });

  it("provides an editable avatar and modern app-element defaults", () => {
    expect(getShapeDefinition("avatar")?.props).toMatchObject({
      label: "Alex Morgan",
      initials: "AM",
    });
    expect(getShapeDefinition("icon-button")?.props.iconName).toBe("Plus");
    expect(getShapeDefinition("select")?.props).toMatchObject({
      placeholder: "Select...",
    });
    expect(getShapeDefinition("textarea")?.props).toMatchObject({
      placeholder: "Write something...",
    });
    expect(getShapeDefinition("file-upload")?.props).toMatchObject({
      placeholder: "Browse or drop a file",
    });
    expect(getShapeDefinition("slider")?.props.value).toBe(65);
    expect(getShapeDefinition("stepper")?.props.value).toBe(2);
    expect(getShapeDefinition("metric-card")?.props).toMatchObject({
      value: "$24,800",
      trend: "+12.8%",
    });
    expect(getShapeDefinition("profile-card")?.props).toMatchObject({
      label: "Alex Morgan",
      initials: "AM",
    });
    for (const type of [
      "toast",
      "notification",
      "metric-card",
      "profile-card",
      "empty-state",
      "code-block",
      "segmented-control",
      "step-indicator",
      "bottom-nav",
      "pricing-card",
    ] as const) {
      expect(ELEMENT_LIBRARY_TOOL_TYPES).toContain(type);
      expect(createShapeWidget(type, 10, 20).width).toBeGreaterThan(0);
    }
  });

  it("registers flex layout, spacer, and web/mobile learning elements", () => {
    expect(ELEMENT_LIBRARY_TOOL_TYPES).toEqual(expect.arrayContaining([
      "container",
      "flex-row",
      "flex-column",
      "spacer",
      "mobile-app",
      "web-app",
    ]));
    expect(createShapeWidget("flex-row", 0, 0).props).toMatchObject({
      layout: "flex-row",
      gap: 12,
      padding: 12,
    });
    expect(createShapeWidget("card", 0, 0).props).toMatchObject({
      title: "Product card",
      subtitle: expect.any(String),
      imageSrc: "",
      actionLabel: "Learn more",
    });
    expect(createShapeWidget("chart", 0, 0).props).toMatchObject({
      chartType: "bar",
      values: expect.any(Array),
    });
    expect(createShapeWidget("mobile-app", 0, 0).props.iconName).toBe("Smartphone");
    expect(createShapeWidget("web-app", 0, 0).props.iconName).toBe("AppWindow");
  });

  it("renders a broad set of valid Lucide SVGs for canvas icons", () => {
    expect(CANVAS_ICON_NAMES.length).toBeGreaterThanOrEqual(70);
    expect(CANVAS_ICON_NAMES).toEqual(expect.arrayContaining([
      "Smartphone",
      "TabletSmartphone",
      "AppWindow",
      "CodeXml",
    ]));
    const camera = renderCanvasIconSvg("Camera", "#f0abfc", 2);
    expect(camera).toContain("<svg");
    expect(camera).toContain("<path");
    expect(camera).toContain("#f0abfc");
    expect(renderCanvasIconSvg("not-an-icon", "#ffffff", 2)).toContain("<svg");
    for (const name of CANVAS_ICON_NAMES) {
      expect(renderCanvasIconSvg(name, "#ffffff", 2), `invalid canvas icon: ${name}`)
        .toMatch(/<(?:path|circle|line|polyline|polygon|rect|ellipse)\b/);
    }
  });

  it("creates UUID-backed unlocked widgets with isolated registry defaults", () => {
    const rectangle = createShapeWidget("rectangle", 12, 24);
    const icon = createShapeWidget("icon", 40, 50);

    expect(rectangle).toMatchObject({
      type: "rectangle",
      x: 12,
      y: 24,
      width: 100,
      height: 100,
      visible: true,
      locked: false,
      zIndex: 0,
    });
    expect(rectangle.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(icon.props).toEqual({ iconName: "Star" });
    icon.props.iconName = "Heart";
    expect(createShapeWidget("icon", 0, 0).props.iconName).toBe("Star");
  });

  it("keeps dragged bounds positive and accepts per-corner radii in the project schema", () => {
    const rectangle = createShapeWidget("rectangle", 0, 0, -20, 8);
    const project = createEmptyProject();
    project.screens[0].widgets = [
      { ...rectangle, style: { ...rectangle.style, cornerRadius: [1, 2, 3, 4] } },
    ];

    expect(rectangle.width).toBe(1);
    expect(project.screens[0].widgets[0].style.cornerRadius).toEqual([1, 2, 3, 4]);
  });

  it("measures multi-line text as a full text box", () => {
    expect(measureTextBounds("Proto\nFlow", "Arial", 20, "bold", 1.25)).toEqual({
      width: 62,
      height: 52,
    });
  });

  it("TC-FAIL-203A caps text measurement work at ten thousand characters", () => {
    expect(MAX_WIDGET_TEXT_LENGTH).toBe(10_000);
    const measured = measureTextBounds("x".repeat(20_000), "Arial", 12);
    expect(measured.width).toBeLessThan(100_000);
    expect(measured.height).toBeLessThan(20_000);
  });
});
