import type { Widget } from "../project/schema";
import { parseStyleColor } from "./styleInspector";

export const DARK_TEXT_COLOUR = "#24212b";
export const LIGHT_TEXT_COLOUR = "#ffffff";

/** Widgets whose fill is their text colour, so they never form a background. */
const TEXT_FILL_TYPES = new Set(["text", "heading", "paragraph", "link", "label", "code"]);

type Rgb = [number, number, number];

function toRgb(hex: string): Rgb {
  const channels = hex.slice(1).match(/.{2}/g) ?? ["ff", "ff", "ff"];
  return channels.map((channel) => parseInt(channel, 16)) as Rgb;
}

function relativeLuminance([red, green, blue]: Rgb): number {
  const [r, g, b] = [red, green, blue].map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(first: Rgb, second: Rgb): number {
  const [light, dark] = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

/**
 * The colour a reader sees behind a point: every visible, filled widget under it, painted
 * from the bottom up with its fill opacity and widget opacity over the screen background.
 */
export function backgroundColourAt(
  widgets: readonly Widget[],
  point: { x: number; y: number },
  screenBackground = "#ffffff",
): Rgb {
  let colour = toRgb(parseStyleColor(screenBackground)?.hex ?? "#ffffff");
  const layers = widgets
    .filter((widget) =>
      widget.visible !== false &&
      !TEXT_FILL_TYPES.has(widget.type) &&
      typeof widget.style.fill === "string" &&
      point.x >= widget.x && point.x <= widget.x + widget.width &&
      point.y >= widget.y && point.y <= widget.y + widget.height)
    .sort((first, second) => first.zIndex - second.zIndex);
  for (const layer of layers) {
    const parsed = parseStyleColor(layer.style.fill as string);
    if (!parsed) continue;
    const alpha = Math.min(1, Math.max(0,
      parsed.opacity * (layer.style.fillOpacity ?? 1) * (layer.opacity ?? 1)));
    const top = toRgb(parsed.hex);
    colour = colour.map((channel, index) => channel + (top[index] - channel) * alpha) as Rgb;
  }
  return colour;
}

/** Dark or white text, whichever reads better on what lies under the text's centre. */
export function readableTextColour(
  widgets: readonly Widget[],
  bounds: { x: number; y: number; width: number; height: number },
  screenBackground = "#ffffff",
): string {
  const background = backgroundColourAt(
    widgets,
    { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
    screenBackground,
  );
  return contrastRatio(background, toRgb(DARK_TEXT_COLOUR)) >= contrastRatio(background, toRgb(LIGHT_TEXT_COLOUR))
    ? DARK_TEXT_COLOUR
    : LIGHT_TEXT_COLOUR;
}

/** Dark or white text for a label drawn on its own fill (a button), painted over white. */
export function readableTextOnFill(fill: string | null | undefined, fillOpacity = 1): string {
  if (typeof fill !== "string") return DARK_TEXT_COLOUR;
  const parsed = parseStyleColor(fill);
  if (!parsed) return DARK_TEXT_COLOUR;
  const alpha = Math.min(1, Math.max(0, parsed.opacity * fillOpacity));
  const top = toRgb(parsed.hex);
  const background = top.map((channel) => 255 + (channel - 255) * alpha) as Rgb;
  return contrastRatio(background, toRgb(DARK_TEXT_COLOUR)) >= contrastRatio(background, toRgb(LIGHT_TEXT_COLOUR))
    ? DARK_TEXT_COLOUR
    : LIGHT_TEXT_COLOUR;
}
