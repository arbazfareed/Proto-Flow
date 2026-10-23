import { describe, expect, it } from "vitest";
import { fitWindowSizeToMonitor, getPreviewWindowSize } from "./windowSizing";

describe("preview window sizing", () => {
  it("fits an oversized editor window within the monitor's logical work area", () => {
    expect(fitWindowSizeToMonitor(
      { width: 1283, height: 729 },
      { scaleFactor: 1.5, workArea: { size: { width: 1280, height: 720 } } },
    )).toEqual({ width: 853, height: 480 });
  });

  it("keeps the current size when it already fits or monitor data is unavailable", () => {
    const viewport = { width: 1440, height: 900 };
    expect(fitWindowSizeToMonitor(
      viewport,
      { scaleFactor: 1, workArea: { size: { width: 1920, height: 1080 } } },
    )).toEqual(viewport);
    expect(fitWindowSizeToMonitor(viewport, null)).toEqual(viewport);
  });

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
