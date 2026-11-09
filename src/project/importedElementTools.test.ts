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
    expect(getImportedElementTools(["Music"])).toEqual(["audio"]);
  });

  it("maps every recognized semantic icon to an existing element-library tool", () => {
    const requiredIcons = [
      "Calendar",
      "Check",
      "CheckSquare",
      "ChevronDown",
      "ChevronDownSquare",
      "CircleDot",
      "Code2",
      "CodeXml",
      "Compass",
      "FileText",
      "Heading1",
      "Heading2",
      "Image",
      "Layout",
      "Link",
      "List",
      "ListOrdered",
      "Lock",
      "Mail",
      "Menu",
      "MousePointer2",
      "Music",
      "PanelBottom",
      "PanelLeft",
      "PanelTop",
      "Quote",
      "RectangleHorizontal",
      "Search",
      "Square",
      "SquareStack",
      "Table",
      "TextCursorInput",
      "Type",
      "Video",
      "AppWindow",
      "AlignLeft",
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
