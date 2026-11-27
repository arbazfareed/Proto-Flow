import type { Widget } from "./schema";

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
