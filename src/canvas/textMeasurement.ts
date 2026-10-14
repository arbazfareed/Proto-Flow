export const MAX_WIDGET_TEXT_LENGTH = 10_000;

export function measureTextBounds(
  text: string,
  fontFamily = "Arial",
  fontSize = 24,
  fontWeight = "normal",
  lineHeight = 1.2,
): { width: number; height: number } {
  const lines = text.slice(0, MAX_WIDGET_TEXT_LENGTH).split(/\r?\n/);
  let measuredWidth = 0;
  if (typeof document !== "undefined") {
    const context = document.createElement("canvas").getContext("2d");
    if (!context) throw new Error("The browser could not create a text measurement canvas.");
    context.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
    measuredWidth = Math.max(...lines.map((line) => context.measureText(line).width));
  } else {
    measuredWidth = Math.max(...lines.map((line) => [...line].length * fontSize * 0.6));
  }

  return {
    width: Math.max(1, Math.ceil(measuredWidth + 2)),
    height: Math.max(1, Math.ceil(lines.length * fontSize * lineHeight + 2)),
  };
}
