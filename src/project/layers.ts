import type { Widget } from "./schema";

export function isWidgetContainedBy(
  widget: Pick<Widget, "x" | "y" | "width" | "height">,
  parent: Pick<Widget, "x" | "y" | "width" | "height">,
): boolean {
  return (
    widget.x >= parent.x &&
    widget.y >= parent.y &&
    widget.x + widget.width <= parent.x + parent.width &&
    widget.y + widget.height <= parent.y + parent.height
  );
}

export function getSelectedContainingParentId(
  widgets: readonly Widget[],
  selectedIds: readonly string[],
  child: Widget,
): string | undefined {
  if (selectedIds.length !== 1) return undefined;
  const parent = widgets.find((widget) => widget.id === selectedIds[0]);
  return parent && parent.id !== child.id && isWidgetContainedBy(child, parent)
    ? parent.id
    : undefined;
}

export function reorderWidgets(
  widgets: readonly Widget[],
  draggedId: string,
  targetId: string,
  edge: "before" | "after",
): Widget[] {
  const ordered = [...widgets].sort((first, second) => second.zIndex - first.zIndex);
  const sourceIndex = ordered.findIndex((widget) => widget.id === draggedId);
  const targetIndex = ordered.findIndex((widget) => widget.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0 || draggedId === targetId) return [...widgets];

  const [dragged] = ordered.splice(sourceIndex, 1);
  const adjustedTarget = ordered.findIndex((widget) => widget.id === targetId);
  ordered.splice(adjustedTarget + (edge === "after" ? 1 : 0), 0, dragged);
  return ordered.map((widget, index) => ({
    ...widget,
    zIndex: ordered.length - index,
  }));
}

export function reorderScreens<T extends { id: string }>(
  screens: readonly T[],
  draggedId: string,
  targetId: string,
  edge: "before" | "after",
): T[] {
  const ordered = [...screens];
  const sourceIndex = ordered.findIndex((screen) => screen.id === draggedId);
  const targetIndex = ordered.findIndex((screen) => screen.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0 || draggedId === targetId) return [...screens];

  const [dragged] = ordered.splice(sourceIndex, 1);
  const adjustedTarget = ordered.findIndex((screen) => screen.id === targetId);
  ordered.splice(adjustedTarget + (edge === "after" ? 1 : 0), 0, dragged);
  return ordered;
}
