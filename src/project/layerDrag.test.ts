import { describe, expect, it } from "vitest";
import { createShapeWidget } from "../canvas/shapes";
import {
  createDraggedWidgetCopies,
  parseLayerDragPayload,
  reorderWidgetSet,
  serializeLayerDragPayload,
} from "./layerDrag";

describe("layer drag payloads", () => {
  it("round-trips valid widget payloads and rejects malformed data", () => {
    const widget = createShapeWidget("rectangle", 4, 8);
    const serialized = serializeLayerDragPayload({
      version: 1,
      kind: "widgets",
      widgetIds: [widget.id],
    });

    expect(parseLayerDragPayload(serialized)).toEqual({
      version: 1,
      kind: "widgets",
      widgetIds: [widget.id],
    });
    expect(parseLayerDragPayload("{")).toBeNull();
    expect(parseLayerDragPayload(JSON.stringify({
      version: 1,
      kind: "widgets",
      widgetIds: ["", widget.id],
    }))).toBeNull();
  });

  it("copies a selection with relative offsets and remapped group IDs", () => {
    const first = { ...createShapeWidget("rectangle", 20, 40), groupId: "group-source" };
    const second = { ...createShapeWidget("ellipse", 55, 75), groupId: "group-source" };
    let nextId = 0;

    const copies = createDraggedWidgetCopies(
      [first, second],
      { x: 100, y: 120 },
      9,
      () => `new-${++nextId}`,
    );

    expect(copies.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 100, y: 120 },
      { x: 135, y: 155 },
    ]);
    expect(copies.map((widget) => widget.zIndex)).toEqual([11, 10]);
    expect(copies[0].id).not.toBe(first.id);
    expect(copies[0].groupId).toBe(copies[1].groupId);
    expect(copies[0].groupId).not.toBe(first.groupId);
  });

  it("reorders a selected set as one block and keeps z-order descending", () => {
    const items = ["a", "b", "c", "d"].map((id, index) => ({
      ...createShapeWidget("rectangle", 0, 0),
      id,
      zIndex: 4 - index,
    }));

    const reordered = reorderWidgetSet(items, ["a", "c"], "d", "after");

    expect(reordered.map((widget) => widget.id)).toEqual(["b", "d", "a", "c"]);
    expect(reordered.map((widget) => widget.zIndex)).toEqual([4, 3, 2, 1]);
    expect(reorderWidgetSet(items, ["a"], "a", "after")).toEqual(items);
  });
});
