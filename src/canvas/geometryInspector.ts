import type { Widget } from "../project/schema";

export type GeometryField =
  | "x"
  | "y"
  | "width"
  | "height"
  | "rotation"
  | "opacity";

export type GeometryUpdate = Partial<
  Pick<Widget, "x" | "y" | "width" | "height" | "rotation" | "opacity">
> & { id: string };

export function evaluateGeometryExpression(expression: string): number | null {
  let index = 0;

  const skipWhitespace = () => {
    while (/\s/.test(expression[index] ?? "")) index += 1;
  };

  const parsePrimary = (): number => {
    skipWhitespace();
    const sign = expression[index] === "-" ? -1 : 1;
    if (expression[index] === "+" || expression[index] === "-") {
      index += 1;
      return sign * parsePrimary();
    }
    if (expression[index] === "(") {
      index += 1;
      const value = parseSum();
      skipWhitespace();
      if (expression[index] !== ")") throw new Error("Missing closing parenthesis.");
      index += 1;
      return value;
    }

    const match = expression.slice(index).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i);
    if (!match) throw new Error("Expected a number.");
    index += match[0].length;
    return Number(match[0]);
  };

  const parseProduct = (): number => {
    let value = parsePrimary();
    while (true) {
      skipWhitespace();
      const operator = expression[index];
      if (operator !== "*" && operator !== "/") return value;
      index += 1;
      const right = parsePrimary();
      if (operator === "/" && right === 0) throw new Error("Division by zero.");
      value = operator === "*" ? value * right : value / right;
    }
  };

  const parseSum = (): number => {
    let value = parseProduct();
    while (true) {
      skipWhitespace();
      const operator = expression[index];
      if (operator !== "+" && operator !== "-") return value;
      index += 1;
      const right = parseProduct();
      value = operator === "+" ? value + right : value - right;
    }
  };

  try {
    if (!expression.trim()) return null;
    if (/\+\s*\+/.test(expression)) return null;
    const value = parseSum();
    skipWhitespace();
    return index === expression.length && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export function normalizeRotation(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

export function getGeometryUpdates(
  widgets: readonly Widget[],
  field: GeometryField,
  value: number,
): GeometryUpdate[] {
  if (!Number.isFinite(value)) return [];
  const editable = widgets.filter((widget) => !widget.locked);
  if (editable.length === 0) return [];

  if (field === "x" || field === "y") {
    const primary = editable[0];
    const delta = value - primary[field];
    return editable.map((widget) => ({
      id: widget.id,
      [field]: widget[field] + delta,
    }));
  }

  if (field === "width" || field === "height") {
    return editable.map((widget) => ({
      id: widget.id,
      [field]: Math.max(4, value),
    }));
  }

  if (field === "opacity") {
    const opacity = Math.min(1, Math.max(0, value));
    return editable.map((widget) => ({ id: widget.id, opacity }));
  }

  const rotation = normalizeRotation(value);
  return editable.map((widget) => {
    const oldRadians = (widget.rotation * Math.PI) / 180;
    const newRadians = (rotation * Math.PI) / 180;
    const centerX =
      widget.x +
      (widget.width / 2) * Math.cos(oldRadians) -
      (widget.height / 2) * Math.sin(oldRadians);
    const centerY =
      widget.y +
      (widget.width / 2) * Math.sin(oldRadians) +
      (widget.height / 2) * Math.cos(oldRadians);
    return {
      id: widget.id,
      x:
        centerX -
        ((widget.width / 2) * Math.cos(newRadians) -
          (widget.height / 2) * Math.sin(newRadians)),
      y:
        centerY -
        ((widget.width / 2) * Math.sin(newRadians) +
          (widget.height / 2) * Math.cos(newRadians)),
      rotation,
    };
  });
}
