import { describe, expect, it } from "vitest";
import { createEmptyProject } from "../project/schema";
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
