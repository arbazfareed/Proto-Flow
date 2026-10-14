import { describe, expect, it } from "vitest";
import { createShapeWidget } from "./shapes";
import {
  getSelectionBounds,
  getSelectedParentWidgetIds,
  getSelectionUpdates,
  getWidgetsInsideBounds,
  offsetSelection,
  constrainTransformerBounds,
} from "./selection";

function widget(
  x: number,
  y: number,
  width = 20,
  height = 10,
  options: { locked?: boolean; visible?: boolean } = {},
) {
  return {
    ...createShapeWidget("rectangle", x, y, width, height),
    ...options,
  };
}

describe("selection geometry", () => {
  it("finds selected widgets' parent containers and ancestors without looping on cycles", () => {
    const widgets = [
      { id: "screen", type: "frame", groupId: undefined, x: 0, y: 0, width: 500, height: 500, zIndex: 0 },
      { id: "card", type: "card", groupId: "screen", x: 10, y: 10, width: 200, height: 200, zIndex: 1 },
      { id: "image", type: "image", groupId: "card", x: 20, y: 20, width: 50, height: 50, zIndex: 2 },
      { id: "cycle-a", type: "text", groupId: "cycle-b", x: 0, y: 0, width: 500, height: 500, zIndex: 3 },
      { id: "cycle-b", type: "text", groupId: "cycle-a", x: 0, y: 0, width: 500, height: 500, zIndex: 4 },
    ];

    expect([...getSelectedParentWidgetIds(widgets, ["image"])].sort())
      .toEqual(["card", "screen"]);
    expect([...getSelectedParentWidgetIds(widgets, ["cycle-a"])]).toEqual(["cycle-b"]);
    expect([...getSelectedParentWidgetIds(widgets, ["missing"])]).toEqual([]);
    expect([...getSelectedParentWidgetIds([
      { id: "panel", type: "panel", groupId: undefined, x: 0, y: 0, width: 100, height: 100, zIndex: 0 },
      { id: "outside", type: "text", groupId: "panel", x: 150, y: 0, width: 20, height: 20, zIndex: 1 },
    ], ["outside"])]).toEqual([]);
  });

  it("highlights inferred container ancestors when a widget is moved inside them", () => {
    const widgets = [
      { id: "frame", type: "frame", groupId: undefined, x: 0, y: 0, width: 400, height: 400, zIndex: 0 },
      { id: "card", type: "card", groupId: undefined, x: 50, y: 50, width: 200, height: 200, zIndex: 1 },
      { id: "text", type: "text", groupId: undefined, x: 60, y: 60, width: 40, height: 20, zIndex: 2 },
    ];

    expect([...getSelectedParentWidgetIds(widgets, ["text"])].sort()).toEqual(["card", "frame"]);
    expect([...getSelectedParentWidgetIds(
      widgets.map((widget) => widget.id === "text" ? { ...widget, x: 300 } : widget),
      ["text"],
    )]).toEqual(["frame"]);
  });

  it("transformer-inversion rejects inverted, undersized, and non-finite bounds", () => {
    const oldBox = { x: 0, y: 0, width: 20, height: 20 };
    expect(constrainTransformerBounds(oldBox, { x: 10, y: 10, width: -2, height: 20 }))
      .toBe(oldBox);
    expect(constrainTransformerBounds(oldBox, { x: 10, y: 10, width: 3, height: 20 }))
      .toBe(oldBox);
    expect(constrainTransformerBounds(oldBox, { x: 1, y: 2, width: 4, height: 5 }))
      .toEqual({ x: 1, y: 2, width: 4, height: 5 });
  });

  it("returns bounds for selected elements", () => {
    expect(getSelectionBounds([widget(10, 20, 20, 10), widget(-5, 8, 5, 12)])).toEqual({
      x: -5,
      y: 8,
      width: 35,
      height: 22,
    });
    expect(getSelectionBounds([])).toBeNull();
  });

  it("rubberband-selects only visible, unlocked widgets fully inside", () => {
    const inside = widget(10, 10);
    const edge = widget(90, 10);
    const locked = widget(10, 30, 20, 10, { locked: true });
    const hidden = widget(10, 50, 20, 10, { visible: false });
    expect(
      getWidgetsInsideBounds(
        [inside, edge, locked, hidden],
        { x: 0, y: 0, width: 100, height: 60 },
      ),
    ).toEqual([inside.id]);
  });

  it("aligns and sizes a multi-selection while preserving untouched geometry", () => {
    const first = widget(10, 20, 20, 10);
    const second = widget(60, 45, 10, 30);
    const updates = getSelectionUpdates([first, second], "align-middle");
    expect(updates.find((item) => item.id === first.id)?.y).toBe(42.5);
    expect(updates.find((item) => item.id === second.id)?.y).toBe(32.5);

    const matched = getSelectionUpdates([first, second], "match-width");
    expect(matched.find((item) => item.id === second.id)?.width).toBe(20);
  });

  it("distributes items evenly without moving the outermost items", () => {
    const widgets = [widget(0, 0, 10, 10), widget(30, 0, 20, 10), widget(100, 0, 10, 10)];
    const updates = getSelectionUpdates(widgets, "distribute-horizontal");
    expect(updates.map((item) => item.x)).toEqual([0, 45, 100]);
    expect(getSelectionUpdates(widgets.slice(0, 2), "distribute-horizontal")).toEqual([]);
  });

  it("multi-drag-offsets preserves relative positions and skips locked elements", () => {
    const movable = widget(10, 20);
    const locked = widget(30, 40, 20, 10, { locked: true });
    expect(offsetSelection([movable, locked], { x: 10, y: -10 })).toEqual([
      { id: movable.id, x: 20, y: 10 },
    ]);
  });
});
