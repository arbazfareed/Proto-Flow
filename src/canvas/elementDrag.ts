import { ELEMENT_LIBRARY_TOOL_TYPES } from "./shapeTools";
import type { ShapeTool } from "./shapeTools";

export const ELEMENT_DRAG_MIME = "application/x-protoflow-element";

export function parseElementDragPayload(value: string): ShapeTool | null {
  return ELEMENT_LIBRARY_TOOL_TYPES.find((tool) => tool === value) ?? null;
}
