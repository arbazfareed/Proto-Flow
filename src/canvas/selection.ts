import type { Widget } from "../project/schema";
import type { CanvasPoint } from "./snapping";

export interface SelectionBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type SelectionOperation =
  | "align-left"
  | "align-center"
  | "align-right"
  | "align-top"
  | "align-middle"
  | "align-bottom"
  | "distribute-horizontal"
  | "distribute-vertical"
  | "match-width"
  | "match-height";

export function getSelectionBounds(
  widgets: readonly Pick<Widget, "x" | "y" | "width" | "height">[],
): SelectionBounds | null {
  if (widgets.length === 0) return null;
  const left = Math.min(...widgets.map((widget) => widget.x));
  const top = Math.min(...widgets.map((widget) => widget.y));
  const right = Math.max(...widgets.map((widget) => widget.x + widget.width));
  const bottom = Math.max(...widgets.map((widget) => widget.y + widget.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function getWidgetsInsideBounds(
  widgets: readonly Widget[],
  bounds: SelectionBounds,
): string[] {
  const left = Math.min(bounds.x, bounds.x + bounds.width);
  const top = Math.min(bounds.y, bounds.y + bounds.height);
  const right = Math.max(bounds.x, bounds.x + bounds.width);
  const bottom = Math.max(bounds.y, bounds.y + bounds.height);
  return widgets
    .filter(
      (widget) =>
        widget.visible &&
        !widget.locked &&
        widget.x >= left &&
        widget.y >= top &&
        widget.x + widget.width <= right &&
        widget.y + widget.height <= bottom,
    )
    .map((widget) => widget.id);
}

export function getSelectionUpdates(
  widgets: readonly Widget[],
  operation: SelectionOperation,
): Array<Pick<Widget, "id" | "x" | "y" | "width" | "height">> {
  if (widgets.length < 2) return [];
  const bounds = getSelectionBounds(widgets);
  if (!bounds) return [];

  const ordered = [...widgets];
  const changes = new Map(
    ordered.map((widget) => [
      widget.id,
      {
        id: widget.id,
        x: widget.x,
        y: widget.y,
        width: widget.width,
        height: widget.height,
      },
    ]),
  );
  const first = ordered[0];

  if (operation === "match-width" || operation === "match-height") {
    for (const widget of ordered.slice(1)) {
      const update = changes.get(widget.id);
      if (update) {
        if (operation === "match-width") update.width = first.width;
        else update.height = first.height;
      }
    }
  } else if (operation === "distribute-horizontal" || operation === "distribute-vertical") {
    const horizontal = operation === "distribute-horizontal";
    const sorted = ordered.sort((a, b) =>
      horizontal ? a.x - b.x || a.y - b.y : a.y - b.y || a.x - b.x,
    );
    if (sorted.length < 3) return [];
    const start = horizontal ? sorted[0].x : sorted[0].y;
    const last = sorted.at(-1)!;
    const end = horizontal ? last.x + last.width : last.y + last.height;
    const occupied = sorted.reduce(
      (sum, widget) => sum + (horizontal ? widget.width : widget.height),
      0,
    );
    const gap = (end - start - occupied) / (sorted.length - 1);
    let cursor = start;
    for (const widget of sorted) {
      const update = changes.get(widget.id);
      if (update) {
        if (horizontal) update.x = cursor;
        else update.y = cursor;
      }
      cursor += (horizontal ? widget.width : widget.height) + gap;
    }
  } else {
    for (const widget of ordered) {
      const update = changes.get(widget.id);
      if (!update) continue;
      switch (operation) {
        case "align-left":
          update.x = bounds.x;
          break;
        case "align-center":
          update.x = bounds.x + (bounds.width - widget.width) / 2;
          break;
        case "align-right":
          update.x = bounds.x + bounds.width - widget.width;
          break;
        case "align-top":
          update.y = bounds.y;
          break;
        case "align-middle":
          update.y = bounds.y + (bounds.height - widget.height) / 2;
          break;
        case "align-bottom":
          update.y = bounds.y + bounds.height - widget.height;
          break;
      }
    }
  }

  return [...changes.values()];
}

export function offsetSelection(
  widgets: readonly Widget[],
  delta: CanvasPoint,
): Array<Pick<Widget, "id" | "x" | "y">> {
  return widgets
    .filter((widget) => !widget.locked)
    .map((widget) => ({
      id: widget.id,
      x: widget.x + delta.x,
      y: widget.y + delta.y,
    }));
}
