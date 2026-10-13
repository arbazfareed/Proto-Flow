import { describe, expect, it } from "vitest";
import {
  createDefaultLayerTreePreferences,
  layerGroupCollapseKey,
  parseLayerTreePreferences,
  reorderLayerGroupIds,
  serializeLayerTreePreferences,
} from "./layerTreePreferences";

describe("layer tree preferences", () => {
  it("defaults to category mode and safely restores valid saved settings", () => {
    const defaults = createDefaultLayerTreePreferences();
    expect(defaults.mode).toBe("category");
    expect(parseLayerTreePreferences(serializeLayerTreePreferences({
      mode: "type",
      groupOrder: { type: ["button", "image"] },
      groupNames: { "type:button": "Primary actions" },
    }))).toEqual({
      mode: "type",
      groupOrder: { type: ["button", "image"] },
      groupNames: { "type:button": "Primary actions" },
    });
    expect(parseLayerTreePreferences(null)).toEqual(defaults);
  });

  it("rejects malformed persisted JSON and creates stable per-mode collapse keys", () => {
    expect(() => parseLayerTreePreferences("{")).toThrow();
    expect(layerGroupCollapseKey("category", "shapes")).toBe("category:shapes");
  });

  it("reorders visible groups without discarding filtered-out groups", () => {
    expect(reorderLayerGroupIds(
      ["shapes", "widgets", "advanced", "symbols"],
      ["shapes", "advanced"],
      "advanced",
      "shapes",
      "before",
    )).toEqual(["advanced", "shapes", "widgets", "symbols"]);
  });
});
