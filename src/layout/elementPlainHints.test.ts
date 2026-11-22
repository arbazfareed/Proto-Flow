import { describe, expect, it } from "vitest";
import { ELEMENT_LIBRARY_TOOL_TYPES } from "../canvas/shapeTools";
import { PLAIN_ELEMENT_HINTS, plainElementHint } from "./elementPlainHints";

describe("plain element hints (B64)", () => {
  it("explains the expert elements in everyday words", () => {
    expect(plainElementHint("repeater")).toBe("A list that repeats one design for each item.");
    for (const tool of ["dynamic-panel", "flex-row", "flex-column", "skeleton", "repeater"]) {
      expect(plainElementHint(tool), tool).toBeTruthy();
    }
  });

  it("keeps every hint to one short sentence with no code words", () => {
    for (const [tool, hint] of Object.entries(PLAIN_ELEMENT_HINTS)) {
      expect(hint.length, tool).toBeLessThanOrEqual(80);
      expect(hint.endsWith("."), tool).toBe(true);
      expect(hint, tool).not.toMatch(/\b(DOM|CSS|HTML|flexbox|div|API|JSON)\b/i);
    }
  });

  it("only describes elements that exist in the library", () => {
    const known = new Set<string>(ELEMENT_LIBRARY_TOOL_TYPES);
    for (const tool of Object.keys(PLAIN_ELEMENT_HINTS)) expect(known.has(tool), tool).toBe(true);
  });
});
