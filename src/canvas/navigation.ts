export const MIN_CANVAS_ZOOM = 0.1;
export const MAX_CANVAS_ZOOM = 4;

export interface CanvasView {
  zoom: number;
  pan: { x: number; y: number };
}

export interface CanvasViewport {
  width: number;
  height: number;
}

export interface CanvasBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function clampCanvasZoom(zoom: number): number {
  return Math.min(MAX_CANVAS_ZOOM, Math.max(MIN_CANVAS_ZOOM, zoom));
}

export function zoomAroundPointer(
  view: CanvasView,
  pointer: { x: number; y: number },
  zoom: number,
): CanvasView {
  const nextZoom = clampCanvasZoom(zoom);
  const worldX = (pointer.x - view.pan.x) / view.zoom;
  const worldY = (pointer.y - view.pan.y) / view.zoom;

  return {
    zoom: nextZoom,
    pan: {
      x: pointer.x - worldX * nextZoom,
      y: pointer.y - worldY * nextZoom,
    },
  };
}

export function getWidgetBounds(
  widgets: readonly Pick<CanvasBounds, "x" | "y" | "width" | "height">[],
): CanvasBounds | null {
  if (widgets.length === 0) return null;

  const bounds = widgets.reduce(
    (current, widget) => ({
      x: Math.min(current.x, widget.x),
      y: Math.min(current.y, widget.y),
      right: Math.max(current.right, widget.x + widget.width),
      bottom: Math.max(current.bottom, widget.y + widget.height),
    }),
    {
      x: Number.POSITIVE_INFINITY,
      y: Number.POSITIVE_INFINITY,
      right: Number.NEGATIVE_INFINITY,
      bottom: Number.NEGATIVE_INFINITY,
    },
  );

  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.right - bounds.x,
    height: bounds.bottom - bounds.y,
  };
}

export function centerCanvasView(
  bounds: CanvasBounds | null,
  viewport: CanvasViewport,
  zoom = 1,
): CanvasView {
  const centerX = bounds ? bounds.x + bounds.width / 2 : 0;
  const centerY = bounds ? bounds.y + bounds.height / 2 : 0;

  return {
    zoom: clampCanvasZoom(zoom),
    pan: {
      x: viewport.width / 2 - centerX * zoom,
      y: viewport.height / 2 - centerY * zoom,
    },
  };
}

export function fitCanvasBounds(
  bounds: CanvasBounds,
  viewport: CanvasViewport,
  padding = 48,
): CanvasView {
  const availableWidth = Math.max(1, viewport.width - padding * 2);
  const availableHeight = Math.max(1, viewport.height - padding * 2);
  const zoom = clampCanvasZoom(
    Math.min(
      availableWidth / Math.max(1, bounds.width),
      availableHeight / Math.max(1, bounds.height),
    ),
  );

  return centerCanvasView(bounds, viewport, zoom);
}
