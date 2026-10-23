import { describe, expect, it } from "vitest";
import { createShapeWidget } from "../canvas/shapes";
import { getAutoLayoutPositions } from "./widgetLayout";

describe("auto-layout widget positions", () => {
  it("flows row children horizontally using gap and padding", () => {
    const row = createShapeWidget("flex-row", 10, 20);
    const first = createShapeWidget("button", 15, 25, 80, 32);
    const second = createShapeWidget("button", 25, 35, 90, 40);
    first.groupId = row.id;
    second.groupId = row.id;
    row.props.padding = 8;
    row.props.gap = 10;
    row.props.alignItems = "flex-start";

    expect(getAutoLayoutPositions([row, first, second])).toEqual(new Map([
      [first.id, { x: 18, y: 28 }],
      [second.id, { x: 108, y: 28 }],
    ]));
  });

  it("flows column children vertically and leaves freeform widgets unchanged", () => {
    const column = createShapeWidget("flex-column", 100, 200);
    const first = createShapeWidget("text", 0, 0, 120, 20);
    const second = createShapeWidget("text", 0, 0, 150, 30);
    const loose = createShapeWidget("button", 5, 7);
    first.groupId = column.id;
    second.groupId = column.id;
    column.props.padding = 10;
    column.props.gap = 6;
    column.props.alignItems = "flex-start";

    expect(getAutoLayoutPositions([column, first, second])).toEqual(new Map([
      [first.id, { x: 110, y: 210 }],
      [second.id, { x: 110, y: 236 }],
    ]));
    expect(getAutoLayoutPositions([column, first, second]).has(loose.id)).toBe(false);
  });
});
