import { describe, expect, it } from "vitest";
import { ELEMENT_LIBRARY_TOOL_TYPES } from "../canvas/shapeTools";
import { getImportedElementTools } from "./importedElementTools";

describe("getImportedElementTools", () => {
  it("maps semantic import icons to unique native tools from their library categories", () => {
    expect(getImportedElementTools(["Table", "Calendar", "Video", "Table", "Image"])).toEqual([
      "table",
      "date-picker",
      "video",
      "image",
    ]);
  });

  it("maps every recognized semantic icon to an existing element-library tool", () => {
    const requiredIcons = [
      "Calendar",
      "Check",
      "ChevronDown",
      "Code2",
      "Compass",
      "FileText",
      "Image",
      "Layout",
      "Link",
      "List",
      "ListOrdered",
      "Mail",
      "MousePointer2",
      "Music",
      "Search",
      "Table",
      "Type",
      "Video",
    ];

    expect(getImportedElementTools(requiredIcons)).not.toHaveLength(0);
    expect(getImportedElementTools(requiredIcons).every((tool) =>
      ELEMENT_LIBRARY_TOOL_TYPES.includes(tool),
    )).toBe(true);
  });

  it("ignores unknown icon names without creating unsupported widgets", () => {
    expect(getImportedElementTools(["UnknownIcon"])).toEqual([]);
  });
});
