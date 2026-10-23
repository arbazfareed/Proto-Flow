import type { Widget } from "./schema";

export interface WidgetPosition {
  x: number;
  y: number;
}

function finiteProp(widget: Widget, key: string, fallback: number): number {
  const value = widget.props[key];
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, value)
    : fallback;
}

export function getAutoLayoutPositions(
  widgets: readonly Widget[],
): Map<string, WidgetPosition> {
  const byId = new Map(widgets.map((widget) => [widget.id, widget]));
  const positions = new Map<string, WidgetPosition>();
  const layoutParents = widgets.filter(
    (widget) => widget.type === "flex-row" || widget.type === "flex-column",
  );

  for (const parent of layoutParents) {
    const direction = parent.type === "flex-row" ? "row" : "column";
    const gap = finiteProp(parent, "gap", 12);
    const padding = finiteProp(parent, "padding", 12);
    const children = widgets
      .filter((widget) => widget.groupId === parent.id && byId.has(widget.groupId))
      .sort((first, second) => first.zIndex - second.zIndex);
    let cursor = 0;

    for (const child of children) {
      const parentPosition = positions.get(parent.id) ?? { x: parent.x, y: parent.y };
      const crossOffset =
        parent.props.alignItems === "center"
          ? Math.max(0, (direction === "row" ? parent.height - child.height : parent.width - child.width) / 2)
          : parent.props.alignItems === "flex-end"
            ? Math.max(0, direction === "row" ? parent.height - child.height : parent.width - child.width)
            : 0;
      positions.set(child.id, direction === "row"
        ? { x: parentPosition.x + padding + cursor, y: parentPosition.y + padding + crossOffset }
        : { x: parentPosition.x + padding + crossOffset, y: parentPosition.y + padding + cursor });
      cursor += (direction === "row" ? child.width : child.height) + gap;
    }
  }

  return positions;
}
