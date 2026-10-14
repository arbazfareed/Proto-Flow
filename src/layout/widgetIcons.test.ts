import { describe, expect, it } from "vitest";
import {
  getScreenIconDefinition,
  getWidgetIconDefinition,
  UNKNOWN_WIDGET_ICON,
  WIDGET_ICON_REGISTRY,
} from "./widgetIcons";
import { ELEMENT_LIBRARY_TOOL_TYPES } from "../canvas/shapeTools";

describe("widget icon registry", () => {
  it("maps each supported widget type to its category icon and tint", () => {
    expect(getWidgetIconDefinition("rectangle")).toMatchObject({ category: "shape", color: "#64748b" });
    expect(getWidgetIconDefinition("button")).toMatchObject({ category: "widget", color: "#3b82f6" });
    expect(getWidgetIconDefinition("repeater")).toMatchObject({ category: "advanced", color: "#f97316" });
    expect(getWidgetIconDefinition("symbol-instance")).toMatchObject({ category: "symbol", color: "#8b5cf6" });
    expect(getWidgetIconDefinition("frame")).toMatchObject({ category: "container", color: "#f59e0b" });
    expect(getWidgetIconDefinition("rectangle").icon).not.toBe(getWidgetIconDefinition("ellipse").icon);
    expect(getWidgetIconDefinition("button").icon).not.toBe(getWidgetIconDefinition("input").icon);
  });

  it("provides distinct Lucide icons for the supported web and app elements", () => {
    const icons = ELEMENT_LIBRARY_TOOL_TYPES.map((type) => {
      expect(WIDGET_ICON_REGISTRY[type], `missing icon for ${type}`).toBeDefined();
      return WIDGET_ICON_REGISTRY[type].icon;
    });
    expect(new Set(icons).size).toBe(ELEMENT_LIBRARY_TOOL_TYPES.length);
    expect(ELEMENT_LIBRARY_TOOL_TYPES.length).toBeGreaterThanOrEqual(65);
  });

  it("uses an indigo icon for each screen device category", () => {
    const categories = ["desktop", "laptop", "tablet", "phone", "watch"] as const;
    const icons = categories.map((category) => {
      const definition = getScreenIconDefinition(category);
      expect(definition.color).toBe("#6366f1");
      return definition.icon;
    });
    expect(new Set(icons).size).toBe(categories.length);
  });

  it("uses the gray square fallback for unknown types", () => {
    expect(getWidgetIconDefinition("unrecognized-widget")).toBe(UNKNOWN_WIDGET_ICON);
    expect(UNKNOWN_WIDGET_ICON.color).toBe("#9ca3af");
  });
});
