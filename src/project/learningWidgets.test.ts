import { describe, expect, it } from "vitest";
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
    expect(getWidgetLearningGuide("video").element).toBe("<figure>");
  });

  it("provides an explicit generic guide for the rest of the library", () => {
    expect(getWidgetLearningGuide("date-picker")).toMatchObject({
      element: "<div>",
      css: expect.stringContaining("box-sizing: border-box"),
    });
  });
});
