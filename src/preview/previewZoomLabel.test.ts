import { describe, expect, it } from "vitest";
import { PREVIEW_FIT_HINT, previewFitLabel } from "./previewZoomLabel";

describe("Preview fit label (B56)", () => {
  it("calls the slider a fit scale, not a zoom", () => {
    expect(previewFitLabel(100)).toBe("Fit 100%");
    expect(previewFitLabel(75)).toBe("Fit 75%");
    expect(previewFitLabel(100)).not.toMatch(/zoom/i);
  });

  it("explains that 100% means fit to the window", () => {
    expect(PREVIEW_FIT_HINT).toContain("fits each device to the window");
  });
});
