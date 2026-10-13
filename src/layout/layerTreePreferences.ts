import {
  LAYER_CATEGORIES,
  LAYER_VIEW_MODES,
} from "./layerGrouping";
import type { LayerCategoryId, LayerViewMode } from "./layerGrouping";

export interface LayerTreePreferences {
  mode: LayerViewMode;
  groupOrder: Partial<Record<LayerViewMode, string[]>>;
  groupNames: Record<string, string>;
}

export function createDefaultLayerTreePreferences(): LayerTreePreferences {
  return { mode: "category", groupOrder: {}, groupNames: {} };
}

export function parseLayerTreePreferences(
  stored: string | null,
): LayerTreePreferences {
  if (!stored) return createDefaultLayerTreePreferences();
  const parsed: unknown = JSON.parse(stored);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Layer-tree preferences must be an object.");
  }
  const value = parsed as Record<string, unknown>;
  const mode = LAYER_VIEW_MODES.includes(value.mode as LayerViewMode)
    ? value.mode as LayerViewMode
    : "category";
  const groupOrder: Partial<Record<LayerViewMode, string[]>> = {};
  if (value.groupOrder && typeof value.groupOrder === "object" && !Array.isArray(value.groupOrder)) {
    for (const viewMode of LAYER_VIEW_MODES) {
      const order = (value.groupOrder as Record<string, unknown>)[viewMode];
      if (Array.isArray(order) && order.every((id) => typeof id === "string")) {
        groupOrder[viewMode] = order;
      }
    }
  }
  const groupNames: Record<string, string> = {};
  if (value.groupNames && typeof value.groupNames === "object" && !Array.isArray(value.groupNames)) {
    for (const [id, name] of Object.entries(value.groupNames)) {
      if (typeof name === "string" && name.trim()) groupNames[id] = name.trim().slice(0, 60);
    }
  }
  return { mode, groupOrder, groupNames };
}

export function serializeLayerTreePreferences(
  preferences: LayerTreePreferences,
): string {
  return JSON.stringify(preferences);
}

export function layerGroupCollapseKey(mode: LayerViewMode, groupId: string): string {
  return `${mode}:${groupId}`;
}

export function layerGroupNameKey(mode: LayerViewMode, groupId: string): string {
  return `${mode}:${groupId}`;
}

export function validCategoryId(value: string): value is LayerCategoryId {
  return (LAYER_CATEGORIES as readonly string[]).includes(value);
}

export function reorderLayerGroupIds(
  currentOrder: string[],
  visibleIds: string[],
  draggedId: string,
  targetId: string,
  edge: "before" | "after",
): string[] {
  if (draggedId === targetId || !visibleIds.includes(draggedId) || !visibleIds.includes(targetId)) {
    return currentOrder;
  }
  const order = [...new Set([...currentOrder, ...visibleIds])];
  const draggedIndex = order.indexOf(draggedId);
  order.splice(draggedIndex, 1);
  const targetIndex = order.indexOf(targetId);
  order.splice(targetIndex + (edge === "after" ? 1 : 0), 0, draggedId);
  return order;
}
