import { describe, expect, it } from "vitest";
import { PREVIEW_RUNTIME_SCRIPT } from "../preview/publishBundle";
import { PLAIN_BOX_TYPES } from "./plainBoxes";

describe("plain layout boxes", () => {
  it("draws a Footer as a plain box like a Container, not a coloured card", () => {
    expect(PLAIN_BOX_TYPES.has("footer")).toBe(true);
    expect(PLAIN_BOX_TYPES.has("container")).toBe(true);
    for (const type of ["panel", "drawer", "overlay", "sidebar", "navbar", "form"]) {
      expect(PLAIN_BOX_TYPES.has(type)).toBe(true);
    }
    // Cards and modals keep their editable title.
    expect(PLAIN_BOX_TYPES.has("card")).toBe(false);
    expect(PLAIN_BOX_TYPES.has("modal")).toBe(false);
  });

  it("uses the same list in published prototypes", () => {
    const line = PREVIEW_RUNTIME_SCRIPT.match(/const PLAIN_BOX_TYPES = \[[^\]]*\];/)?.[0] ?? "";
    for (const type of PLAIN_BOX_TYPES) expect(line).toContain(`"${type}"`);
  });
});
