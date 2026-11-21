import { describe, expect, it } from "vitest";
import { PREVIEW_WINDOW_BASE_TITLE, previewWindowTitle } from "./previewWindowTitle";

describe("previewWindowTitle (B69)", () => {
  it("says Preview, so it differs from the editor title", () => {
    expect(previewWindowTitle()).toBe("ProtoFlow Preview");
    expect(previewWindowTitle(null)).not.toBe("ProtoFlow");
    expect(previewWindowTitle("   ")).toBe(PREVIEW_WINDOW_BASE_TITLE);
  });

  it("puts the project name first so several previews can be told apart", () => {
    expect(previewWindowTitle("Shop app")).toBe("Shop app · ProtoFlow Preview");
    expect(previewWindowTitle("  Shop app  ")).toBe("Shop app · ProtoFlow Preview");
  });
});
