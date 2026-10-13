import { describe, expect, it } from "vitest";
import { createShapeWidget } from "../canvas/shapes";
import {
  buildLayerGroups,
  getLayerCategory,
  LAYER_CATEGORIES,
} from "./layerGrouping";

function widget(type: string, zIndex: number) {
  return { ...createShapeWidget("rectangle", 0, 0), type, zIndex };
}

describe("layer tree grouping", () => {
  it("classifies every specified widget category and the unknown fallback", () => {
    expect(getLayerCategory("rectangle")).toBe("shapes");
    expect(getLayerCategory("toggle")).toBe("widgets");
    expect(getLayerCategory("dynamic-panel")).toBe("advanced");
    expect(getLayerCategory("symbol-instance")).toBe("symbols");
    expect(getLayerCategory("frame")).toBe("containers");
    expect(getLayerCategory("plugin-widget")).toBe("other");
    expect(LAYER_CATEGORIES).toHaveLength(6);
  });

  it("hides empty categories and orders category members by descending z-index", () => {
    const groups = buildLayerGroups([
      widget("rectangle", 1),
      widget("ellipse", 5),
      widget("button", 3),
      widget("repeater", 4),
    ], "category");

    expect(groups.map((group) => group.id)).toEqual(["shapes", "widgets", "advanced"]);
    expect(groups[0].widgets.map((item) => item.zIndex)).toEqual([5, 1]);
  });

  it("honors a persisted layer category override", () => {
    const groups = buildLayerGroups([
      { ...widget("rectangle", 1), layerCategory: "widgets" },
    ], "category");

    expect(groups.map((group) => group.id)).toEqual(["widgets"]);
    expect(getLayerCategory("rectangle", "widgets")).toBe("widgets");
  });

  it("uses saved group order in category and type modes", () => {
    const widgets = [widget("rectangle", 1), widget("button", 2), widget("ellipse", 3)];
    expect(buildLayerGroups(widgets, "category", ["widgets", "shapes"]).map((group) => group.id))
      .toEqual(["widgets", "shapes"]);
    expect(buildLayerGroups(widgets, "type", ["rectangle", "button"]).map((group) => group.id))
      .toEqual(["rectangle", "button", "ellipse"]);
  });

  it("keeps z-order mode flat and sorted by descending z-index", () => {
    const groups = buildLayerGroups([widget("rectangle", 2), widget("button", 9)], "z-order");
    expect(groups).toHaveLength(1);
    expect(groups[0].widgets.map((item) => item.zIndex)).toEqual([9, 2]);
  });
});
