import { describe, expect, it } from "vitest";
import {
  getScreenIconDefinition,
  getWidgetIconDefinition,
  IMPORTED_HTML_ICON_REGISTRY,
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
    expect(getWidgetIconDefinition("api-request").category).toBe("advanced");
    expect(getWidgetIconDefinition("database").category).toBe("data");
    expect(getWidgetIconDefinition("image-gallery").category).toBe("media");
  });

  it("provides distinct Lucide icons for the supported web and app elements", () => {
    const icons = ELEMENT_LIBRARY_TOOL_TYPES.map((type) => {
      expect(WIDGET_ICON_REGISTRY[type], `missing icon for ${type}`).toBeDefined();
      return WIDGET_ICON_REGISTRY[type].icon;
    });
    expect(new Set(icons).size).toBe(ELEMENT_LIBRARY_TOOL_TYPES.length);
    expect(ELEMENT_LIBRARY_TOOL_TYPES.length).toBeGreaterThanOrEqual(78);
  });

  it("uses distinct visual language for element-library categories", () => {
    expect(getWidgetIconDefinition("grid").color).not.toBe(
      getWidgetIconDefinition("search").color,
    );
    expect(getWidgetIconDefinition("navbar").color).not.toBe(
      getWidgetIconDefinition("image").color,
    );
    expect(getWidgetIconDefinition("card").color).not.toBe(
      getWidgetIconDefinition("alert").color,
    );
    expect(getWidgetIconDefinition("flex-row").icon).not.toBe(
      getWidgetIconDefinition("flex-column").icon,
    );
    expect(getWidgetIconDefinition("spacer").icon).not.toBe(
      getWidgetIconDefinition("container").icon,
    );
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

  it("provides an icon for each imported HTML suggestion", () => {
    const names = [
      "AlignLeft", "AppWindow", "Calendar", "CheckSquare", "ChevronDown",
      "Check", "ChevronDownSquare", "CircleDot", "Code2", "CodeXml", "Compass", "FileText",
      "Heading1", "Heading2", "Image", "Layout", "Link", "List", "ListOrdered",
      "Lock", "Mail", "Menu", "Music", "PanelBottom", "PanelLeft", "PanelTop",
      "MousePointer2", "Quote", "RectangleHorizontal", "Search", "Square", "SquareStack",
      "TextCursorInput", "Type", "Video",
    ];
    expect(names.every((name) => IMPORTED_HTML_ICON_REGISTRY[name])).toBe(true);
  });
});
