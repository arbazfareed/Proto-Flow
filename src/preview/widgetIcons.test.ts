import { describe, expect, it } from "vitest";
import { CANVAS_ICON_LIBRARY } from "../canvas/iconLibrary";
import { getPreviewIconComponent } from "./widgetIcons";

describe("preview canvas icons", () => {
  it("resolves supported Lucide icons from the shared canvas registry", () => {
    expect(getPreviewIconComponent("Package")).toBe(CANVAS_ICON_LIBRARY.Package);
    expect(getPreviewIconComponent("ArrowLeft")).toBe(CANVAS_ICON_LIBRARY.ArrowLeft);
  });

  it("uses the same Star fallback as the canvas for unknown names", () => {
    expect(getPreviewIconComponent("not-a-real-icon")).toBe(CANVAS_ICON_LIBRARY.Star);
  });
});