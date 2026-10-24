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

  return resolveWidgetsForBreakpoint(
    screen.widgets,
    { ...breakpoint, width: viewport.width, height: viewport.height },
    baseWidth,
    baseHeight,
    screen.compactLayout,
  );
}
