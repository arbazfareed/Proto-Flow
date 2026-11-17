import type { Screen, Widget } from "../project/schema";
import { getScreenBreakpoints, resolveWidgetsForBreakpoint } from "../project/responsive";
import type { DevicePreset } from "../devices/types";

export const DEFAULT_MULTI_DEVICE_IDS = [
  "desktop-1440-900",
  "ipad-air",
  "iphone-15-pro",
  "pixel-8",
] as const;

export interface PreviewViewport {
  width: number;
  height: number;
}

export function getPreviewViewport(
  device: DevicePreset,
  rotated: boolean,
): PreviewViewport {
  return rotated
    ? { width: device.viewport.height, height: device.viewport.width }
    : { ...device.viewport };
}

export function resolvePreviewWidgets(
  screen: Screen,
  viewport: PreviewViewport,
): Widget[] {
  const baseWidth = screen.device?.width ?? viewport.width;
  const baseHeight = screen.device?.height ?? viewport.height;
  const breakpoints = getScreenBreakpoints(screen);
  const breakpoint = breakpoints.find((item) =>
    viewport.width >= item.minWidth &&
    (item.maxWidth === undefined || viewport.width <= item.maxWidth),
  ) ?? breakpoints.reduce((closest, item) =>
    Math.abs(item.width - viewport.width) < Math.abs(closest.width - viewport.width)
      ? item
      : closest,
  );

  // The widest breakpoint has no upper limit. When it was designed at its own width (not the
  // screen's base width) and the window is wider, lay it out as designed and stretch it to the
  // full width, instead of stopping at that width with a blank strip beside it (B91).
  if (
    breakpoint.maxWidth === undefined &&
    breakpoint.width !== baseWidth &&
    viewport.width > breakpoint.width
  ) {
    const designed = resolveWidgetsForBreakpoint(
      screen.widgets,
      { ...breakpoint, height: viewport.height },
      baseWidth,
      baseHeight,
      screen.compactLayout,
    );
    return stretchHorizontally(designed, viewport.width / breakpoint.width);
  }

  return resolveWidgetsForBreakpoint(
    screen.widgets,
    { ...breakpoint, width: viewport.width, height: viewport.height },
    baseWidth,
    baseHeight,
    screen.compactLayout,
  );
}

/** Widgets that would look wrong stretched (round, square or pictures): they move, not stretch. */
const KEEP_SHAPE_TYPES = new Set(["avatar", "icon", "custom-icon", "icon-button", "image", "fab", "checkbox", "radio", "toggle"]);

/**
 * Spreads a layout across a wider window: positions and widths scale by `scale`; widgets that
 * should keep their shape stay the same size, centred where they would have stretched to.
 */
export function stretchHorizontally(widgets: readonly Widget[], scale: number): Widget[] {
  return widgets.map((widget) => {
    const keepShape = KEEP_SHAPE_TYPES.has(widget.type) ||
      ((widget.type === "ellipse" || widget.type === "circle") && widget.width === widget.height);
    if (keepShape) {
      const centre = (widget.x + widget.width / 2) * scale;
      return { ...widget, x: Math.round(centre - widget.width / 2) };
    }
    return {
      ...widget,
      x: Math.round(widget.x * scale),
      width: Math.max(1, Math.round(widget.width * scale)),
    };
  });
}
