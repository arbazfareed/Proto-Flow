import { describe, expect, it } from "vitest";
import { getWidgetIconDefinition, UNKNOWN_WIDGET_ICON } from "./widgetIcons";

describe("widget icon registry", () => {
  it("maps each supported widget type to its category icon and tint", () => {
    expect(getWidgetIconDefinition("rectangle")).toMatchObject({ category: "shape", color: "#6b7280" });
    expect(getWidgetIconDefinition("button")).toMatchObject({ category: "widget", color: "#2563eb" });
    expect(getWidgetIconDefinition("repeater")).toMatchObject({ category: "advanced", color: "#ea580c" });
    expect(getWidgetIconDefinition("symbol-instance")).toMatchObject({ category: "symbol", color: "#7c3aed" });
    expect(getWidgetIconDefinition("frame")).toMatchObject({ category: "container", color: "#ca8a04" });
    expect(getWidgetIconDefinition("rectangle").icon).not.toBe(getWidgetIconDefinition("ellipse").icon);
    expect(getWidgetIconDefinition("button").icon).not.toBe(getWidgetIconDefinition("input").icon);
  });

  it("uses the gray square fallback for unknown types", () => {
    expect(getWidgetIconDefinition("unrecognized-widget")).toBe(UNKNOWN_WIDGET_ICON);
    expect(UNKNOWN_WIDGET_ICON.color).toBe("#9ca3af");
  });
});
