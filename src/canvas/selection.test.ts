import { describe, expect, it } from "vitest";
import { createShapeWidget } from "./shapes";
import {
  getSelectionBounds,
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
