import { describe, expect, it } from "vitest";
import { createShapeWidget } from "./shapes";
import {
  evaluateGeometryExpression,
  getGeometryUpdates,
  normalizeRotation,
} from "./geometryInspector";

function widget(
  x: number,
  y: number,
  width = 20,
  height = 10,
  rotation = 0,
  locked = false,
) {
  return {
    ...createShapeWidget("rectangle", x, y, width, height),
    rotation,
    locked,
  };
}

describe("geometry inspector helpers | expression-eval", () => {
  it("evaluates arithmetic expressions without evaluating arbitrary code", () => {
    expect(evaluateGeometryExpression("100 + 20")).toBe(120);
    expect(evaluateGeometryExpression("(12.5 * 2) - -5")).toBe(30);
    expect(evaluateGeometryExpression("1 / 0")).toBeNull();
    expect(evaluateGeometryExpression("1 +")).toBeNull();
    expect(evaluateGeometryExpression("12++5")).toBeNull();
    expect(evaluateGeometryExpression("100/0")).toBeNull();
    expect(evaluateGeometryExpression("Math.random()")).toBeNull();
    expect(evaluateGeometryExpression("'); alert(1); ('")).toBeNull();
    expect(evaluateGeometryExpression("globalThis.alert(1)")).toBeNull();
  });

  it("normalizes degrees into the range from zero to under 360", () => {
    expect(normalizeRotation(390)).toBe(30);
    expect(normalizeRotation(-30)).toBe(330);
  });

  it("moves multi-selection positions by the primary delta and skips locked widgets", () => {
    const first = widget(10, 20);
    const second = widget(50, 70);
    const locked = widget(100, 120, 20, 10, 0, true);
    expect(getGeometryUpdates([first, second, locked], "x", 30)).toEqual([
      { id: first.id, x: 30 },
      { id: second.id, x: 70 },
    ]);
  });

  it("applies dimensions, opacity, and normalized rotation to editable widgets", () => {
    const widgets = [widget(0, 0), widget(40, 50)];
    expect(getGeometryUpdates(widgets, "width", 2).map(({ width }) => width)).toEqual([
      4,
      4,
    ]);
    expect(getGeometryUpdates(widgets, "opacity", 150).map(({ opacity }) => opacity)).toEqual([
      1,
      1,
    ]);
    expect(getGeometryUpdates(widgets, "rotation", -30).map(({ rotation }) => rotation)).toEqual([
      330,
      330,
    ]);
  });

  it("keeps the visual center fixed when rotation changes", () => {
    const item = widget(10, 20, 20, 10);
    const update = getGeometryUpdates([item], "rotation", 90)[0];
    expect(update.rotation).toBe(90);
    expect(update.x).toBeCloseTo(25);
    expect(update.y).toBeCloseTo(15);
  });
});
