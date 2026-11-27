import type { Widget } from "./schema";
import { getWidgetParentIdMap } from "./layers";

/**
 * Remove only selected, unlocked widgets from the currently editable canvas scope.
 * The caller is responsible for merging this scoped list back into the project,
 * which preserves inactive panel states and repeater templates.
 */
export function removeSelectedWidgets(
  widgets: readonly Widget[],
  selectedIds: readonly string[],
): { widgets: Widget[]; deletedIds: string[] } {
  const selected = new Set(selectedIds);
  const deletedIds = widgets
    .filter((widget) => selected.has(widget.id) && !widget.locked)
    .map((widget) => widget.id);
  if (deletedIds.length === 0) {
    return { widgets: [...widgets], deletedIds: [] };
  }
  const deleted = new Set(deletedIds);
  return {
    widgets: widgets.filter((widget) => !deleted.has(widget.id)),
    deletedIds,
  };
}


/**
 * Returns selected, unlocked widgets and their unlocked descendants.
 * Locked descendants are preserved and can remain selected after deletion.
 */
export function getDeletableWidgetIds(
  widgets: readonly Widget[],
  selectedIds: readonly string[],
): Set<string> {
  const lockedIds = new Set(widgets.filter((widget) => widget.locked).map((widget) => widget.id));
  const availableIds = new Set(widgets.map((widget) => widget.id));
  const parentById = getWidgetParentIdMap(widgets);
  const childrenById = new Map<string, string[]>();

  for (const [childId, parentId] of parentById) {
    childrenById.set(parentId, [...(childrenById.get(parentId) ?? []), childId]);
  }

  const result = new Set<string>();
  const queue = selectedIds.filter((id) => availableIds.has(id) && !lockedIds.has(id));
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (result.has(id)) continue;
    result.add(id);
    for (const childId of childrenById.get(id) ?? []) {
      if (!result.has(childId) && !lockedIds.has(childId)) queue.push(childId);
    }
  }
  return result;
}
