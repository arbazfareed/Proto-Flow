import { describe, expect, it } from "vitest";
import { ELEMENT_LIBRARY_TOOL_TYPES, getShapeToolDefinition } from "../canvas/shapeTools";
import { getWidgetLearningGuide } from "./learningWidgets";

describe("widget learning guides", () => {
  it("documents semantic markup and CSS for the new learning widgets", () => {
    expect(getWidgetLearningGuide("flex-row")).toMatchObject({
      element: "<div>",
      css: expect.stringContaining("flex-direction: row"),
    });
    expect(getWidgetLearningGuide("card")).toMatchObject({
      element: "<article>",
      css: expect.stringContaining("flex-direction: column"),
    });
    expect(getWidgetLearningGuide("video").element).toContain("<video controls>");
  });

  it("provides useful, element-specific tips throughout the library", () => {
    expect(getWidgetLearningGuide("date-picker")).toMatchObject({
      element: expect.stringContaining('type="date"'),
      css: expect.stringContaining("min-height"),
    });
    for (const type of ELEMENT_LIBRARY_TOOL_TYPES) {
      const guide = getWidgetLearningGuide(type, getShapeToolDefinition(type)?.label);
      expect(guide.note, `missing description for ${type}`).not.toMatch(/A reusable UI element/);
      expect(guide.note.trim(), `empty description for ${type}`).not.toBe("");
      expect(guide.element, `missing HTML mapping for ${type}`).toMatch(/^</);
      expect(guide.css, `missing CSS mapping for ${type}`).not.toBe("");
    }
  });
});
