import type { Widget } from "./schema";

export const LAYER_CONTAINER_TYPES = new Set([
  "group",
  "frame",
  "panel",
  "dynamic-panel",
  "dynamicPanel",
  "repeater",
  "card",
  "modal",
  "overlay",
  "drawer",
  "section",
  "accordion",
  "carousel",
  "tabs-container",
  "tabsContainer",
  "form",
  "navbar",
  "sidebar",
  "tabs",
  "menu",
  "dropdown-menu",
  "dropdownMenu",
  "footer",
  "component-master",
  "componentMaster",
  "calendar",
  "rectangle",
  "ellipse",
]);

const LAYER_CONTAINMENT_TOLERANCE = 8; // Keep near-edge canvas alignment in the same hierarchy.

export function isWidgetContainer(widget: Pick<Widget, "type">): boolean {
  return LAYER_CONTAINER_TYPES.has(widget.type);
}

export type WidgetParentCandidate = Pick<
  Widget,
  "id" | "groupId" | "type" | "x" | "y" | "width" | "height" | "zIndex"
>;

export function isWidgetContainedBy(
  widget: Pick<Widget, "x" | "y" | "width" | "height">,
  parent: Pick<Widget, "x" | "y" | "width" | "height">,
): boolean {
  return (
    widget.x >= parent.x - LAYER_CONTAINMENT_TOLERANCE &&
    widget.y >= parent.y - LAYER_CONTAINMENT_TOLERANCE &&
    widget.x + widget.width <= parent.x + parent.width + LAYER_CONTAINMENT_TOLERANCE &&
    widget.y + widget.height <= parent.y + parent.height + LAYER_CONTAINMENT_TOLERANCE
  );
}

export function getWidgetParentIdMap(
  widgets: readonly WidgetParentCandidate[],
): Map<string, string> {
  const widgetsById = new Map(widgets.map((widget) => [widget.id, widget]));
  const candidateParentIds = new Set(
    widgets.filter(isWidgetContainer).map((widget) => widget.id),
  );

  for (const widget of widgets) {
    const parent = widget.groupId ? widgetsById.get(widget.groupId) : undefined;
    if (parent && parent.id !== widget.id && isWidgetContainedBy(widget, parent)) {
      candidateParentIds.add(parent.id);
    }
  }
  const candidateParents = widgets.filter((widget) => candidateParentIds.has(widget.id));

  const parents = new Map<string, string>();
  for (const widget of widgets) {
    const referencedParent = widget.groupId
      ? widgetsById.get(widget.groupId)
      : undefined;
    const validReferencedParent =
      referencedParent &&
      referencedParent.id !== widget.id &&
      (referencedParent.type === "repeater" || isWidgetContainedBy(widget, referencedParent));
    const widgetArea = widget.width * widget.height;
    const containingParents = candidateParents.filter((candidate) =>
      candidate.id !== widget.id &&
      candidate.width * candidate.height > widgetArea &&
      isWidgetContainedBy(widget, candidate),
    );

    if (validReferencedParent) {
      const moreSpecificParent = containingParents
        .filter((candidate) =>
          candidate.id !== referencedParent.id &&
          candidate.width * candidate.height <
            referencedParent.width * referencedParent.height,
        )
        .sort((first, second) =>
          first.width * first.height - second.width * second.height ||
          first.zIndex - second.zIndex ||
          first.id.localeCompare(second.id),
        )[0];
      parents.set(widget.id, moreSpecificParent?.id ?? referencedParent.id);
      continue;
    }

    if (widget.groupId && !widgetsById.has(widget.groupId)) continue;

    containingParents.sort((first, second) =>
      first.width * first.height - second.width * second.height ||
      first.zIndex - second.zIndex ||
      first.id.localeCompare(second.id),
    );
    const parent = containingParents[0];
    if (parent) parents.set(widget.id, parent.id);
  }

  return parents;
}

export function syncWidgetGroupIdsToContainment(widgets: readonly Widget[]): Widget[] {
  const parentByWidgetId = getWidgetParentIdMap(widgets);
  const widgetIds = new Set(widgets.map((widget) => widget.id));

  return widgets.map((widget) => {
    const parentId = parentByWidgetId.get(widget.id);
    if (parentId) {
      return widget.groupId === parentId ? widget : { ...widget, groupId: parentId };
    }
    if (widget.groupId && widgetIds.has(widget.groupId)) {
      return { ...widget, groupId: undefined };
    }
    return widget;
  });
}

export function getSelectedContainingParentId(
  widgets: readonly WidgetParentCandidate[],
  selectedIds: readonly string[],
  child: WidgetParentCandidate,
): string | undefined {
  if (selectedIds.length !== 1) return undefined;
  const parent = widgets.find((widget) => widget.id === selectedIds[0]);
  const parentByWidgetId = getWidgetParentIdMap(widgets);
  const nearestContainingParentId = getWidgetParentIdMap([
    ...widgets,
    child,
  ]).get(child.id);
  return parent &&
    parent.id !== child.id &&
    !parentByWidgetId.has(parent.id) &&
    !isWidgetContainer(child) &&
    isWidgetContainedBy(child, parent)
    ? nearestContainingParentId ?? parent.id
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
