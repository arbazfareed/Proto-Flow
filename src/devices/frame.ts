import type { CanvasBounds } from "../canvas/navigation";
import type { Widget } from "../project/schema";
import type { DeviceOrientation, ScreenDevice } from "./types";

export function getSafeAreaBounds(device: ScreenDevice): CanvasBounds {
  return {
    x: device.insets.left,
    y: device.insets.top,
    width: device.width - device.insets.left - device.insets.right,
    height: device.height - device.insets.top - device.insets.bottom,
  };
}

function getRotatedWidgetBounds(
  widget: Pick<Widget, "x" | "y" | "width" | "height"> & Partial<Pick<Widget, "rotation">>,
): CanvasBounds {
  const radians = ((widget.rotation ?? 0) * Math.PI) / 180;
  const halfWidth = widget.width / 2;
  const halfHeight = widget.height / 2;
  const rotatedHalfWidth =
    Math.abs(Math.cos(radians)) * halfWidth +
    Math.abs(Math.sin(radians)) * halfHeight;
  const rotatedHalfHeight =
    Math.abs(Math.sin(radians)) * halfWidth +
    Math.abs(Math.cos(radians)) * halfHeight;
  return {
    x: widget.x + halfWidth - rotatedHalfWidth,
    y: widget.y + halfHeight - rotatedHalfHeight,
    width: rotatedHalfWidth * 2,
    height: rotatedHalfHeight * 2,
  };
}

export function getDeviceFrameBounds(
  device: ScreenDevice,
  bezel: number,
  showChrome: boolean,
): CanvasBounds {
  const safeBezel = showChrome ? Math.max(0, bezel) : 0;
  const browserBar = showChrome && device.presetId.startsWith("desktop-") ? 30 : 0;
  const laptopBase = showChrome && device.presetId.startsWith("macbook-") ? 10 : 0;
  return {
    x: safeBezel === 0 ? 0 : -safeBezel,
    y: (safeBezel === 0 ? 0 : -safeBezel) - browserBar,
    width: device.width + safeBezel * 2,
    height: device.height + safeBezel * 2 + browserBar + laptopBase,
  };
}

export function getWidgetsOutsideSafeArea(
  widgets: readonly Widget[],
  device: ScreenDevice,
): Widget[] {
  const safeArea = getSafeAreaBounds(device);
  return widgets.filter((widget) => {
    if (!widget.visible) return false;
    const bounds = getRotatedWidgetBounds(widget);
    return (
      bounds.x < safeArea.x ||
      bounds.y < safeArea.y ||
      bounds.x + bounds.width > safeArea.x + safeArea.width ||
      bounds.y + bounds.height > safeArea.y + safeArea.height
    );
  });
}

export function rotateDevice(device: ScreenDevice): ScreenDevice {
  const currentOrientation =
    device.orientation ?? (device.width >= device.height ? "landscape" : "portrait");
  const orientation: DeviceOrientation =
    currentOrientation === "portrait" ? "landscape" : "portrait";
  const insets =
    orientation === "landscape"
      ? {
          top: device.insets.left,
          right: device.insets.top,
          bottom: device.insets.right,
          left: device.insets.bottom,
        }
      : {
          top: device.insets.right,
          right: device.insets.bottom,
          bottom: device.insets.left,
          left: device.insets.top,
        };
  return {
    ...device,
    width: device.height,
    height: device.width,
    insets,
    orientation,
  };
}

export function rotateWidgetForDevice(
  widget: Widget,
  oldDevice: ScreenDevice,
  orientation: DeviceOrientation,
): Widget {
  if (orientation === "landscape") {
    return {
      ...widget,
      x: oldDevice.height - widget.y - widget.height,
      y: widget.x,
      width: widget.height,
      height: widget.width,
      rotation: widget.rotation + 90,
    };
  }
  return {
    ...widget,
    x: widget.y,
    y: oldDevice.width - widget.x - widget.width,
    width: widget.height,
    height: widget.width,
    rotation: widget.rotation - 90,
  };
}

export function widgetOverflowsDevice(
  widget: Pick<Widget, "x" | "y" | "width" | "height"> & Partial<Pick<Widget, "rotation">>,
  device: Pick<ScreenDevice, "width" | "height">,
): boolean {
  return getWidgetViewportOverflow(widget, device) > 0;
}

export function getWidgetViewportOverflow(
  widget: Pick<Widget, "x" | "y" | "width" | "height"> & Partial<Pick<Widget, "rotation">>,
  viewport: Pick<ScreenDevice, "width" | "height">,
): number {
  const bounds = getRotatedWidgetBounds(widget);
  const overflow = Math.max(
    0,
    -bounds.x,
    -bounds.y,
    bounds.x + bounds.width - viewport.width,
    bounds.y + bounds.height - viewport.height,
  );
  return overflow < 0.01 ? 0 : Math.ceil(overflow);
}
