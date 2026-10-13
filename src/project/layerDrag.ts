import type { Widget } from "./schema";

export const LAYER_DRAG_MIME = "application/x-protoflow-layer";

export type LayerDragPayload =
  | { version: 1; kind: "widgets"; widgetIds: string[] }
  | { version: 1; kind: "screen"; screenId: string };

let activeLayerDragPayload: LayerDragPayload | null = null;

export function setActiveLayerDragPayload(payload: LayerDragPayload | null): void {
  activeLayerDragPayload = payload;
}

export function getActiveLayerDragPayload(): LayerDragPayload | null {
  return activeLayerDragPayload;
}

export function serializeLayerDragPayload(payload: LayerDragPayload): string {
  return JSON.stringify(payload);
}

export function parseLayerDragPayload(value: string): LayerDragPayload | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return null;
    const payload = parsed as Record<string, unknown>;
    if (payload.version !== 1) return null;
    if (payload.kind === "screen" && typeof payload.screenId === "string") {
      return { version: 1, kind: "screen", screenId: payload.screenId };
    }
    if (
      payload.kind !== "widgets" ||
      !Array.isArray(payload.widgetIds) ||
      payload.widgetIds.length === 0 ||
      !payload.widgetIds.every((id) => typeof id === "string" && id.length > 0)
    ) return null;
    return new Set(payload.widgetIds).size === payload.widgetIds.length
      ? { version: 1, kind: "widgets", widgetIds: payload.widgetIds }
      : null;
  } catch {
    return null;
  }
}

export function createDraggedWidgetCopies(
  source: readonly Widget[],
  position: { x: number; y: number },
  highestZIndex: number,
  createId: () => string = () => crypto.randomUUID(),
): Widget[] {
  if (source.length === 0) return [];
  const minX = Math.min(...source.map((widget) => widget.x));
  const minY = Math.min(...source.map((widget) => widget.y));
  const groupIds = new Map<string, string>();
  const copies = source.map((widget, index) => {
    if (widget.groupId && !groupIds.has(widget.groupId)) {
      groupIds.set(widget.groupId, createId());
    }
    return {
      ...structuredClone(widget),
      id: createId(),
      groupId: widget.groupId ? groupIds.get(widget.groupId) : undefined,
      x: position.x + widget.x - minX,
      y: position.y + widget.y - minY,
      zIndex: highestZIndex + source.length - index,
    };
  });
  return copies;
}

export function reorderWidgetSet(
  widgets: readonly Widget[],
  draggedIds: readonly string[],
  targetId: string,
  edge: "before" | "after",
): Widget[] {
  const movingIds = new Set(draggedIds);
  const ordered = [...widgets].sort((a, b) => b.zIndex - a.zIndex);
  if (
    movingIds.size === 0 ||
    !ordered.some((widget) => widget.id === targetId) ||
    movingIds.has(targetId) ||
    [...movingIds].some((id) => !ordered.some((widget) => widget.id === id))
  ) {
    return [...widgets];
  }
  const moving = ordered.filter((widget) => movingIds.has(widget.id));
  const remaining = ordered.filter((widget) => !movingIds.has(widget.id));
  const targetIndex = remaining.findIndex((widget) => widget.id === targetId);
  remaining.splice(targetIndex + (edge === "after" ? 1 : 0), 0, ...moving);
  return remaining.map((widget, index) => ({
    ...widget,
    zIndex: remaining.length - index,
  }));
}
