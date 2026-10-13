import { describe, expect, it } from "vitest";
import { getVirtualizedRange } from "./layerVirtualization";

describe("layer tree virtualization", () => {
  it("renders only the viewport and overscan rows for large trees", () => {
    const rows = Array.from({ length: 500 }, (_, index) => index);
    const range = getVirtualizedRange(rows.length, 6_000, 300, 30);
    const visibleRows = rows.slice(range.start, range.end);

    expect(visibleRows.length).toBeLessThanOrEqual(14);
    expect(visibleRows[0]).toBe(198);
    expect(range.topSpacerHeight).toBe(198 * 30);
    expect(range.bottomSpacerHeight).toBe((500 - range.end) * 30);
  });

  it("clamps the initial window at the beginning and end of the list", () => {
    expect(getVirtualizedRange(3, 0, 300, 30)).toMatchObject({
      start: 0,
      end: 3,
      topSpacerHeight: 0,
      bottomSpacerHeight: 0,
    });
  });

  it("clamps a stale scroll position after the tree collapses", () => {
    expect(getVirtualizedRange(3, 6_000, 300, 30)).toEqual({
      start: 0,
      end: 3,
      topSpacerHeight: 0,
      bottomSpacerHeight: 0,
    });
  });
});
