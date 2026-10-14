import { z } from "zod";
import { ProtoWidgetSchema } from "./schema";
import type { Widget } from "./schema";

const WidgetClipboardSchema = z.object({
  format: z.literal("protoflow/widgets"),
  version: z.literal(1),
  widgets: z.array(ProtoWidgetSchema).min(1),
}).strict();

export type WidgetClipboardPayload = z.infer<typeof WidgetClipboardSchema>;

let internalClipboard: Widget[] = [];

function serializeWidgets(widgets: readonly Widget[]): string {
  return JSON.stringify({
    format: "protoflow/widgets",
    version: 1,
    widgets: [...widgets],
  } satisfies WidgetClipboardPayload);
}

export function parseWidgetClipboard(value: string): Widget[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Clipboard does not contain valid ProtoFlow widget JSON.");
  }
  const result = WidgetClipboardSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error("Clipboard does not contain valid ProtoFlow widget JSON.");
  }
  return structuredClone(result.data.widgets);
}

export async function copyWidgetsToClipboard(
  widgets: readonly Widget[],
): Promise<boolean> {
  if (widgets.length === 0) return false;
  const copy = structuredClone([...widgets]);
  internalClipboard = copy;
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) return false;
  await navigator.clipboard.writeText(serializeWidgets(copy));
  return true;
}

export async function readWidgetClipboard(): Promise<Widget[]> {
  if (internalClipboard.length > 0) return structuredClone(internalClipboard);
  if (typeof navigator === "undefined" || !navigator.clipboard?.readText) {
    throw new Error("System clipboard access is unavailable.");
  }
  const value = await navigator.clipboard.readText();
  return parseWidgetClipboard(value);
}

export function clearInternalWidgetClipboard(): void {
  internalClipboard = [];
}

export function createWidgetCopies(
  source: readonly Widget[],
  existing: readonly Widget[],
  offset: { x: number; y: number },
  createId: () => string = () => crypto.randomUUID(),
): Widget[] {
  if (source.length === 0) return [];
  const usedIds = new Set(existing.map((widget) => widget.id));
  const idFor = () => {
    let id = createId();
    while (usedIds.has(id)) id = createId();
    usedIds.add(id);
    return id;
  };
  const idMap = new Map(source.map((widget) => [widget.id, idFor()]));
  const highestZIndex = Math.max(0, ...existing.map((widget) => widget.zIndex));

  return source.map((widget, index) => ({
    ...structuredClone(widget),
    id: idMap.get(widget.id)!,
    groupId: widget.groupId
      ? idMap.get(widget.groupId) ?? widget.groupId
      : undefined,
    x: widget.x + offset.x,
    y: widget.y + offset.y,
    zIndex: highestZIndex + index + 1,
    overrides: widget.overrides
      ? Object.fromEntries(
          Object.entries(widget.overrides).map(([breakpointId, override]) => [
            breakpointId,
            {
              ...override,
              ...(override.x === undefined ? {} : { x: override.x + offset.x }),
              ...(override.y === undefined ? {} : { y: override.y + offset.y }),
            },
          ]),
        )
      : undefined,
  }));
}

export function reorderWidgetSelection(
  widgets: readonly Widget[],
  selectedIds: readonly string[],
  action: "forward" | "backward" | "front" | "back",
): Widget[] {
  const selected = new Set(selectedIds);
  if (selected.size === 0 || !widgets.some((widget) => selected.has(widget.id))) {
    return [...widgets];
  }
  const ordered = [...widgets].sort((first, second) =>
    first.zIndex - second.zIndex ||
    widgets.indexOf(first) - widgets.indexOf(second),
  );
  const moving = ordered.filter((widget) => selected.has(widget.id));
  const remaining = ordered.filter((widget) => !selected.has(widget.id));
  let insertionIndex: number;

  switch (action) {
    case "back":
      insertionIndex = 0;
      break;
    case "front":
      insertionIndex = remaining.length;
      break;
    case "forward": {
      const lastSelectedIndex = Math.max(
        ...ordered.map((item, index) => selected.has(item.id) ? index : -1),
      );
      const upperNeighbor = ordered
        .slice(lastSelectedIndex + 1)
        .find((widget) => !selected.has(widget.id));
      if (!upperNeighbor) return [...widgets];
      insertionIndex = remaining.findIndex((widget) => widget.id === upperNeighbor.id) + 1;
      break;
    }
    case "backward": {
      const firstSelectedIndex = Math.min(
        ...ordered.map((item, index) =>
          selected.has(item.id) ? index : Number.POSITIVE_INFINITY,
        ),
      );
      const lowerNeighbor = ordered
        .slice(0, firstSelectedIndex)
        .reverse()
        .find((widget) => !selected.has(widget.id));
      if (!lowerNeighbor) return [...widgets];
      insertionIndex = remaining.findIndex((widget) => widget.id === lowerNeighbor.id);
      break;
    }
  }

  remaining.splice(insertionIndex, 0, ...moving);
  return remaining.map((widget, index) => ({
    ...widget,
    zIndex: index + 1,
  }));
}
