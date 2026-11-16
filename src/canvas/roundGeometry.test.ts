import { describe, expect, it } from "vitest";
import { roundGeometry } from "./roundGeometry";

describe("whole-pixel geometry (B78)", () => {
  it("rounds positions and sizes, keeping at least 1 px", () => {
    expect(roundGeometry({ x: 134.24, y: 20.5, width: 124.52, height: 0.3 }))
      .toEqual({ x: 134, y: 21, width: 125, height: 1 });
  });
  it("keeps rotation to one decimal and leaves missing fields out", () => {
    expect(roundGeometry({ rotation: 12.345 })).toEqual({ rotation: 12.3 });
  });
});
