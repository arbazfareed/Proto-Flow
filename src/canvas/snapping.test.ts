import { describe, expect, it } from "vitest";
import { snapWidgetPosition, type CanvasWidgetBounds } from "./snapping";

const dragged: CanvasWidgetBounds = {
  id: "dragged",
  x: 23,
  y: 37,
  width: 40,
  height: 20,
};

describe("widget snapping | snap-engine", () => {
  it("snaps both coordinates to the nearest grid multiple", () => {
    const result = snapWidgetPosition(dragged, [], 10, true);

    expect(result.position).toEqual({ x: 20, y: 40 });
    expect(result.guides).toEqual([]);
  });

  it("aligns edges to sibling widgets within five canvas units", () => {
    const sibling: CanvasWidgetBounds = {
      id: "sibling",
      x: 70,
      y: 37,
      width: 30,
      height: 20,
    };
    const result = snapWidgetPosition(
      { ...dragged, x: 28, y: 38 },
      [sibling],
      10,
      true,
    );

    expect(result.position).toEqual({ x: 30, y: 37 });
    expect(result.guides).toEqual([
      { axis: "x", coordinate: 70, distance: 2 },
      { axis: "y", coordinate: 37, distance: 1 },
    ]);
  });

  it("TC-FAIL-202A prefers sibling guide snapping over grid snapping per axis", () => {
    const sibling: CanvasWidgetBounds = {
      id: "sibling",
      x: 61,
      y: 200,
      width: 30,
      height: 30,
    };
    const result = snapWidgetPosition(
      { ...dragged, x: 26, y: 44 },
      [sibling],
      10,
      true,
    );

    expect(result.position).toEqual({ x: 21, y: 40 });
    expect(result.guides).toEqual([
      { axis: "x", coordinate: 61, distance: 5 },
    ]);
  });

  it("disables grid and smart snapping when snap is off or Alt is held", () => {
    const sibling: CanvasWidgetBounds = {
      id: "sibling",
      x: 30,
      y: 40,
      width: 40,
      height: 20,
    };

    expect(snapWidgetPosition(dragged, [sibling], 10, false)).toEqual({
      position: { x: 23, y: 37 },
      guides: [],
    });
    expect(snapWidgetPosition(dragged, [sibling], 10, true, true)).toEqual({
      position: { x: 23, y: 37 },
      guides: [],
    });
  });

  it("ignores the dragged widget when resolving alignment", () => {
    const result = snapWidgetPosition(dragged, [dragged], 10, true);

    expect(result.position).toEqual({ x: 20, y: 40 });
    expect(result.guides).toEqual([]);
  });
});
