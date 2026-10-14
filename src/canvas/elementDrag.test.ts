import { describe, expect, it } from "vitest";
import { ELEMENT_DRAG_MIME, parseElementDragPayload } from "./elementDrag";

describe("element drag payload", () => {
  it("uses a dedicated MIME type and accepts available library tools", () => {
    expect(ELEMENT_DRAG_MIME).toBe("application/x-protoflow-element");
    expect(parseElementDragPayload("button")).toBe("button");
    expect(parseElementDragPayload("calendar")).toBe("calendar");
  });

  it("rejects values that are not available library tools", () => {
    expect(parseElementDragPayload("")).toBeNull();
    expect(parseElementDragPayload("not-a-widget")).toBeNull();
  });
});
