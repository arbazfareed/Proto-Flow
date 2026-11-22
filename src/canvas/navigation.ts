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

export interface CanvasWheelInput {
  deltaX: number;
  deltaY: number;
  /** WheelEvent.deltaMode: 0 pixels, 1 lines, 2 pages. */
  deltaMode: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

const WHEEL_LINE_PIXELS = 16;
const WHEEL_PAGE_PIXELS = 800;

const MAX_WHEEL_ZOOM_DELTA = 12;

// B31: Ctrl+= or Ctrl++ zooms in and Ctrl+- zooms out by one step (the same 10% as the zoom buttons).
export const KEYBOARD_ZOOM_STEP = 0.1;
export function keyboardZoomStep(event: { key: string; altKey?: boolean }): number {
  if (event.altKey) return 0;
  if (event.key === "=" || event.key === "+") return KEYBOARD_ZOOM_STEP;
  if (event.key === "-" || event.key === "_") return -KEYBOARD_ZOOM_STEP;
  return 0;
}

// B31: Shift+1 zooms to fit everything on the screen. It is matched by the physical key (Digit1), so
// it works on any keyboard layout, and only while no Ctrl, Cmd or Alt is held.
export function isZoomToFitAllShortcut(event: {
  key: string;
  code?: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}): boolean {
  if (!event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false;
  return event.code === "Digit1" || (event.code === undefined && event.key === "!");
}

/**
 * What the mouse wheel or a trackpad scroll does to the canvas (B29): Ctrl/Cmd+scroll (also a
 * trackpad pinch) zooms around the pointer, Shift+scroll pans sideways, and a plain scroll pans in
 * the direction of the scroll. Line and page wheel deltas are converted to pixels first.
 */
export function applyCanvasWheel(
  view: CanvasView,
  wheel: CanvasWheelInput,
  pointer: { x: number; y: number },
): CanvasView {
  const unit = wheel.deltaMode === 1 ? WHEEL_LINE_PIXELS : wheel.deltaMode === 2 ? WHEEL_PAGE_PIXELS : 1;
  let deltaX = wheel.deltaX * unit;
  let deltaY = wheel.deltaY * unit;

  if (wheel.ctrlKey || wheel.metaKey) {
    // B30: one mouse-wheel notch reports a delta of about 100, which used to zoom by 2.7x. Cap what a
    // single event can do (about 12%) so three notches no longer jump from 58% to 400%.
    // Trackpad pinches send small deltas and stay smooth.
    const zoomDelta = Math.max(-MAX_WHEEL_ZOOM_DELTA, Math.min(MAX_WHEEL_ZOOM_DELTA, deltaY));
    return zoomAroundPointer(view, pointer, view.zoom * Math.pow(1.01, -zoomDelta));
  }

  // Some systems already turn Shift+scroll into a sideways scroll, so only swap when they did not.
  if (wheel.shiftKey && deltaX === 0) {
    deltaX = deltaY;
    deltaY = 0;
  }
  const roundPan = (value: number) => Math.round(value * 10_000) / 10_000;
  return {
    zoom: view.zoom,
    pan: { x: roundPan(view.pan.x - deltaX), y: roundPan(view.pan.y - deltaY) },
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
