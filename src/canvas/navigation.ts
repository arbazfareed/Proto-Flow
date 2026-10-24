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

export function normalizeCanvasViewport(
  viewport: CanvasViewport,
): CanvasViewport {
  return {
    width: Math.max(1, Math.floor(viewport.width)),
    height: Math.max(1, Math.floor(viewport.height)),
  };
}

export function getVisibleGridSpacing(gridSize: number, zoom: number): number {
  if (
    !Number.isFinite(gridSize) ||
    gridSize <= 0 ||
    !Number.isFinite(zoom) ||
    zoom <= 0
  ) {
    throw new RangeError("Grid size and zoom must be finite positive values.");
  }
  const screenSpacing = gridSize * zoom;
  const multiplier =
    screenSpacing >= 8 ? 1 : 2 ** Math.ceil(Math.log2(8 / screenSpacing));
  return gridSize * multiplier;
}

export interface CanvasBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RotatedCanvasBounds extends CanvasBounds {
  rotation?: number;
}

export function getCanvasViewportBounds(
  viewport: CanvasViewport,
  view: CanvasView,
  buffer = 200,
): CanvasBounds {
  if (
    !Number.isFinite(view.zoom) ||
    view.zoom <= 0 ||
    !Number.isFinite(buffer) ||
    buffer < 0
  ) {
    throw new RangeError("Canvas zoom must be positive and buffer must be non-negative.");
  }
  const worldBuffer = buffer / view.zoom;
  return {
    x: -view.pan.x / view.zoom - worldBuffer,
    y: -view.pan.y / view.zoom - worldBuffer,
    width: viewport.width / view.zoom + worldBuffer * 2,
    height: viewport.height / view.zoom + worldBuffer * 2,
  };
}

export function intersectsCanvasViewport(
  bounds: RotatedCanvasBounds,
  viewport: CanvasBounds,
): boolean {
  const angle = ((bounds.rotation ?? 0) * Math.PI) / 180;
  const cosine = Math.abs(Math.cos(angle));
  const sine = Math.abs(Math.sin(angle));
  const width = cosine * bounds.width + sine * bounds.height;
  const height = sine * bounds.width + cosine * bounds.height;
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const left = centerX - width / 2;
  const top = centerY - height / 2;
  return left <= viewport.x + viewport.width &&
    left + width >= viewport.x &&
    top <= viewport.y + viewport.height &&
    top + height >= viewport.y;
}

export function worldToScreen(
  point: { x: number; y: number },
  view: CanvasView,
): { x: number; y: number } {
  return {
    x: view.pan.x + point.x * view.zoom,
    y: view.pan.y + point.y * view.zoom,
  };
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
  const roundPan = (value: number) => Math.round(value * 10_000) / 10_000;

  return {
    zoom: nextZoom,
    pan: {
      x: roundPan(pointer.x - worldX * nextZoom),
      y: roundPan(pointer.y - worldY * nextZoom),
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
