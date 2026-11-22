import type { Widget } from "./schema";

export const LAYER_CONTAINER_TYPES = new Set([
  "container",
  "flex-row",
  "flex-column",
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
]);
// Plain shapes (rectangle, ellipse) are deliberately not containers: anything drawn on top of
// a background shape used to be adopted by it silently, so clicks and double-clicks hit the
// shape instead of what is on it. A shape keeps children only if a child already names it.

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

/**
 * A container adopts a widget when the widget's centre is inside it (B4), as in Figma. A widget
 * drawn half over a card used to be left outside it silently, so it did not move with the card.
 */
export function isWidgetCentreInside(
  widget: Pick<Widget, "x" | "y" | "width" | "height">,
  parent: Pick<Widget, "x" | "y" | "width" | "height">,
): boolean {
  const centreX = widget.x + widget.width / 2;
  const centreY = widget.y + widget.height / 2;
  return (
    centreX >= parent.x &&
    centreX <= parent.x + parent.width &&
    centreY >= parent.y &&
    centreY <= parent.y + parent.height
  );
}

/** Repeaters keep the full-fit rule; every other container nests by centre point. */
export function containerAdoptsWidget(
  parent: Pick<Widget, "type" | "x" | "y" | "width" | "height">,
  widget: Pick<Widget, "x" | "y" | "width" | "height">,
): boolean {
  return parent.type === "repeater"
    ? isWidgetContainedBy(widget, parent)
    : isWidgetContainedBy(widget, parent) || isWidgetCentreInside(widget, parent);
}

/**
 * A repeater only takes a widget that fits completely inside it, because the widgets inside are
 * its row template. Every other container adopts by centre point, so a widget dragged or drawn
 * over a repeater with its centre inside, but hanging over an edge, is left outside it. This finds
 * that repeater (the smallest, if several) so the canvas can say why instead of leaving the widget
 * outside with no hint (B17). A widget that is too big to ever fit gets no hint: there is nothing
 * to move.
 */
export function findRepeaterThatCannotTake<
  T extends Pick<Widget, "type" | "x" | "y" | "width" | "height">,
>(
  moving: Pick<Widget, "x" | "y" | "width" | "height">,
  candidates: readonly T[],
): T | undefined {
  let found: T | undefined;
  for (const candidate of candidates) {
    if (
      candidate.type !== "repeater" ||
      !isWidgetCentreInside(moving, candidate) ||
      isWidgetContainedBy(moving, candidate) ||
      moving.width > candidate.width ||
      moving.height > candidate.height
    ) continue;
    if (!found || candidate.width * candidate.height < found.width * found.height) found = candidate;
  }
  return found;
}

export function getWidgetParentIdMap(
  widgets: readonly WidgetParentCandidate[],
): Map<string, string> {
  const widgetsById = new Map(widgets.map((widget) => [widget.id, widget]));
  // Only containers adopt widgets by position. A shape that a widget explicitly names as its
  // parent keeps that one child (handled below), but does not start adopting everything else
  // drawn over it.
  const candidateParents = widgets.filter(isWidgetContainer);

  const parents = new Map<string, string>();
  for (const widget of widgets) {
    const referencedParent = widget.groupId
      ? widgetsById.get(widget.groupId)
      : undefined;
    const validReferencedParent =
      referencedParent &&
      referencedParent.id !== widget.id &&
      (referencedParent.type === "repeater" || containerAdoptsWidget(referencedParent, widget));
    const widgetArea = widget.width * widget.height;
    const containingParents = candidateParents.filter((candidate) =>
      candidate.id !== widget.id &&
      candidate.width * candidate.height > widgetArea &&
      containerAdoptsWidget(candidate, widget),
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
    isWidgetContainer(parent) &&
    !isWidgetContainer(child) &&
    containerAdoptsWidget(parent, child)
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
