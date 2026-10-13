import { describe, expect, it } from "vitest";
import { createShapeWidget } from "./shapes";
import {
  getDefaultTextProperties,
  getSafeBlendMode,
  getStyleUpdates,
  getTextPropertyUpdates,
  parseStyleColor,
  styleColorToRgba,
} from "./styleInspector";

describe("style inspector helpers", () => {
  it("parses hex, RGBA, and HSL colors while retaining alpha", () => {
    expect(parseStyleColor("#abc")).toEqual({ hex: "#aabbcc", opacity: 1 });
    expect(parseStyleColor("#1234")).toEqual({
      hex: "#112233",
      opacity: 0x44 / 255,
    });
    expect(parseStyleColor("rgba(255, 0, 127, 0.5)")).toEqual({
      hex: "#ff007f",
      opacity: 0.5,
    });
    expect(parseStyleColor("hsl(120, 100%, 50%)")).toEqual({
      hex: "#00ff00",
      opacity: 1,
    });
    expect(parseStyleColor("rgba(1, 2, 3, .)")).toBeNull();
    expect(parseStyleColor("rgb(nope)")).toBeNull();
    expect(styleColorToRgba("#336699", 0.5)).toBe("rgba(51, 102, 153, 0.5)");
  });

  it("maps unsupported blend operations to the standard source-over composite", () => {
    expect(getSafeBlendMode("multiply")).toBe("multiply");
    expect(getSafeBlendMode("difference")).toBe("source-over");
  });

  it("merges appearance updates and excludes locked widgets", () => {
    const unlocked = createShapeWidget("rectangle", 0, 0);
    const button = createShapeWidget("button", 0, 0);
    const locked = { ...createShapeWidget("ellipse", 0, 0), locked: true };
    expect(getStyleUpdates([unlocked, locked], { strokeWidth: 5 })).toEqual([
      {
        id: unlocked.id,
        style: { ...unlocked.style, strokeWidth: 5 },
      },
    ]);
    expect(getTextPropertyUpdates([unlocked, button, locked], { fontSize: 18 })).toEqual([
      {
        id: button.id,
        props: { ...button.props, fontSize: 18 },
      },
    ]);
  });

  it("provides sensible text defaults for text and other label-bearing widgets", () => {
    const text = createShapeWidget("text", 0, 0);
    const button = createShapeWidget("button", 0, 0);
    expect(getDefaultTextProperties(text)).toMatchObject({
      fontSize: 24,
      verticalAlign: "top",
    });
    expect(getDefaultTextProperties(button)).toMatchObject({
      fontSize: 14,
      fontWeight: "bold",
      verticalAlign: "middle",
    });
  });
});
