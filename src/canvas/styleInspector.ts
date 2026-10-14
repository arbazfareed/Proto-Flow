import type { Widget, WidgetStyle } from "../project/schema";

export const SAFE_BLEND_MODES: NonNullable<WidgetStyle["blendMode"]>[] = [
  "source-over",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
];

export function getSafeBlendMode(
  blendMode: WidgetStyle["blendMode"],
): NonNullable<WidgetStyle["blendMode"]> {
  return blendMode && SAFE_BLEND_MODES.includes(blendMode)
    ? blendMode
    : "source-over";
}

export interface ParsedColor {
  hex: string;
  opacity: number;
}

function clampByte(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

function hueToRgb(p: number, q: number, t: number): number {
  let value = t;
  if (value < 0) value += 1;
  if (value > 1) value -= 1;
  if (value < 1 / 6) return p + (q - p) * 6 * value;
  if (value < 1 / 2) return q;
  if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
  return p;
}

export function parseStyleColor(input: string): ParsedColor | null {
  const value = input.trim().toLowerCase();
  const hex = value.match(/^#([\da-f]{3,8})$/i)?.[1];
  if (hex) {
    if (![3, 4, 6, 8].includes(hex.length)) return null;
    const expanded = hex.length < 5
      ? [...hex].map((part) => part + part).join("")
      : hex;
    const hasAlpha = expanded.length === 8;
    return {
      hex: `#${expanded.slice(0, 6)}`,
      opacity: hasAlpha ? parseInt(expanded.slice(6), 16) / 255 : 1,
    };
  }

  const rgb = value.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*[,/]\s*([\d.]+)%?\s*)?\)$/);
  if (rgb) {
    const channels = rgb.slice(1, 4).map(Number);
    const alphaText = rgb[4];
    if (channels.some((channel) => !Number.isFinite(channel))) return null;
    const alpha = alphaText === undefined ? 1 : Number(alphaText) / (value.includes(`${alphaText}%`) ? 100 : 1);
    if (!Number.isFinite(alpha)) return null;
    return {
      hex: `#${channels.map((channel) => clampByte(channel).toString(16).padStart(2, "0")).join("")}`,
      opacity: Math.min(1, Math.max(0, alpha)),
    };
  }

  const hsl = value.match(/^hsla?\(\s*([\d.-]+)(?:deg)?\s*[, ]\s*([\d.]+)%\s*[, ]\s*([\d.]+)%(?:\s*[,/]\s*([\d.]+)%?\s*)?\)$/);
  if (!hsl) return null;
  const hue = ((Number(hsl[1]) % 360) + 360) % 360 / 360;
  const saturation = Number(hsl[2]) / 100;
  const lightness = Number(hsl[3]) / 100;
  const alphaText = hsl[4];
  const alpha = alphaText === undefined ? 1 : Number(alphaText) / (value.includes(`${alphaText}%`) ? 100 : 1);
  if (![hue, saturation, lightness, alpha].every(Number.isFinite)) return null;
  const q = lightness < 0.5
    ? lightness * (1 + saturation)
    : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  const channels = saturation === 0
    ? [lightness, lightness, lightness]
    : [
        hueToRgb(p, q, hue + 1 / 3),
        hueToRgb(p, q, hue),
        hueToRgb(p, q, hue - 1 / 3),
      ];
  return {
    hex: `#${channels.map((channel) => clampByte(channel * 255).toString(16).padStart(2, "0")).join("")}`,
    opacity: Math.min(1, Math.max(0, alpha)),
  };
}

export function styleColorToRgba(color: string, opacity = 1): string {
  const parsed = parseStyleColor(color);
  if (!parsed) return color;
  const channels = parsed.hex.slice(1).match(/.{2}/g)?.map((channel) => parseInt(channel, 16)) ?? [];
  if (channels.length !== 3) return color;
  const alpha = Math.min(1, Math.max(0, parsed.opacity * opacity));
  return `rgba(${channels.join(", ")}, ${Number(alpha.toFixed(4))})`;
}

export function getStyleUpdates(
  widgets: readonly Widget[],
  patch: Partial<WidgetStyle>,
): Array<{ id: string; style: WidgetStyle }> {
  return widgets
    .filter((widget) => !widget.locked)
    .map((widget) => ({ id: widget.id, style: { ...widget.style, ...patch } }));
}

export function getTextPropertyUpdates(
  widgets: readonly Widget[],
  patch: Record<string, unknown>,
): Array<{ id: string; props: Record<string, unknown> }> {
  return widgets
    .filter(
      (widget) =>
        !widget.locked &&
        isTextStyleWidget(widget),
    )
    .map((widget) => ({ id: widget.id, props: { ...widget.props, ...patch } }));
}

export function isTextStyleWidget(widget: Widget): boolean {
  return (
    typeof widget.props.text === "string" ||
    typeof widget.props.label === "string" ||
    typeof widget.props.placeholder === "string" ||
    typeof widget.props.value === "string" ||
    Array.isArray(widget.props.items)
  );
}

export function normalizeListItems(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item.trim();
        if (typeof item !== "object" || item === null) return "";
        const record = item as Record<string, unknown>;
        return typeof record.text === "string"
          ? record.text.trim()
          : typeof record.label === "string"
            ? record.label.trim()
            : "";
      })
      .filter(Boolean)
      .slice(0, 100);
  }
  if (typeof value === "string") {
    return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean).slice(0, 100);
  }
  return [];
}

export function getDefaultTextProperties(
  widget: Widget,
): Record<string, unknown> {
  if (widget.type === "text") {
    return {
      fontFamily: "Arial",
      fontSize: 24,
      fontWeight: "normal",
      fontStyle: "normal",
      underline: false,
      align: "left",
      verticalAlign: "top",
      lineHeight: 1.2,
      letterSpacing: 0,
    };
  }
  return {
    fontFamily: "Arial",
    fontSize: widget.type === "list" ? 16 : 14,
    fontWeight: widget.type === "button" ? "bold" : "normal",
    fontStyle: "normal",
    underline: false,
    align: "left",
    verticalAlign: "middle",
    lineHeight: 1.2,
    letterSpacing: 0,
  };
}
