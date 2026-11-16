import { describe, expect, it } from "vitest";
import type { Widget } from "../project/schema";
import {
  backgroundColourAt,
  DARK_TEXT_COLOUR,
  LIGHT_TEXT_COLOUR,
  readableTextColour,
} from "./readableText";

function box(type: string, fill: string | null, extra: Partial<Widget> = {}, fillOpacity?: number): Widget {
  return {
    id: crypto.randomUUID(), type, x: 100, y: 100, width: 300, height: 200,
    rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 0,
    style: { fill, ...(fillOpacity === undefined ? {} : { fillOpacity }) }, props: {},
    ...extra,
  };
}

const textBounds = { x: 150, y: 150, width: 120, height: 32 };

describe("readable default text colour", () => {
  it("uses dark text on the white screen", () => {
    expect(readableTextColour([], textBounds)).toBe(DARK_TEXT_COLOUR);
  });

  it("uses white text on a dark rectangle", () => {
    expect(readableTextColour([box("rectangle", "#5c4a89")], textBounds)).toBe(LIGHT_TEXT_COLOUR);
  });

  it("uses dark text in a pale container drawn at 10% fill", () => {
    const container = box("container", "#f59e0b", {}, 0.1);
    expect(backgroundColourAt([container], { x: 200, y: 160 })[0]).toBeGreaterThan(240);
    expect(readableTextColour([container], textBounds)).toBe(DARK_TEXT_COLOUR);
  });

  it("looks at the topmost filled layer and ignores text, hidden and distant widgets", () => {
    const dark = box("rectangle", "#111111", { zIndex: 1 });
    const paleOnTop = box("rectangle", "#ffffff", { zIndex: 2 });
    const hidden = box("rectangle", "#000000", { zIndex: 3, visible: false });
    const otherText = box("text", "#000000", { zIndex: 4 });
    const farAway = box("rectangle", "#000000", { x: 900, zIndex: 5 });
    expect(readableTextColour([dark, paleOnTop, hidden, otherText, farAway], textBounds)).toBe(DARK_TEXT_COLOUR);
    expect(readableTextColour([dark, hidden, otherText, farAway], textBounds)).toBe(LIGHT_TEXT_COLOUR);
  });
});
