import { describe, expect, it } from "vitest";
import { getPreviewWindowSize } from "./windowSizing";

describe("preview window sizing", () => {
  it("includes toolbar and window chrome around the selected viewport", () => {
    expect(getPreviewWindowSize({ width: 393, height: 852 }, null)).toEqual({
      width: 429,
      height: 960,
    });
  });

  it("clamps logical dimensions to the monitor work area at its scale factor", () => {
    expect(getPreviewWindowSize(
      { width: 1440, height: 900 },
      { scaleFactor: 2, workArea: { size: { width: 1920, height: 1080 } } },
    )).toEqual({ width: 912, height: 492 });
  });

  it("prefers available work area over minimum dimensions on small monitors", () => {
    expect(getPreviewWindowSize(
      { width: 393, height: 852 },
      { scaleFactor: 2, workArea: { size: { width: 600, height: 400 } } },
    )).toEqual({ width: 252, height: 152 });
  });
});
