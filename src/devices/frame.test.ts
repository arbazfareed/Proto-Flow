import { describe, expect, it } from "vitest";
import { createShapeWidget } from "../canvas/shapes";
import { createEmptyProject } from "../project/schema";
import {
  getDeviceFrameBounds,
  getSafeAreaBounds,
  getWidgetViewportOverflow,
  getWidgetsOutsideSafeArea,
  rotateDevice,
  rotateWidgetForDevice,
  widgetOverflowsDevice,
} from "./frame";
import type { ScreenDevice } from "./types";

const device: ScreenDevice = {
  presetId: "iphone-15-pro",
  width: 393,
  height: 852,
  dpr: 3,
  insets: { top: 59, bottom: 34, left: 0, right: 0 },
  orientation: "portrait",
};

describe("device frame geometry", () => {
  it("computes screen, safe-area, and editor-only frame bounds", () => {
    expect(getSafeAreaBounds(device)).toEqual({
      x: 0,
      y: 59,
      width: 393,
      height: 759,
    });
    expect(getDeviceFrameBounds(device, 12, true)).toEqual({
      x: -12,
      y: -12,
      width: 417,
      height: 876,
    });
    expect(getDeviceFrameBounds(device, 12, false)).toEqual({
      x: 0,
      y: 0,
      width: 393,
      height: 852,
    });
  });

  it("flags widgets outside the safe area, including rotated bounds", () => {
    const inside = createShapeWidget("rectangle", 20, 80, 60, 30);
    const underNotch = createShapeWidget("rectangle", 20, 20, 60, 30);
    const rotated = createShapeWidget("rectangle", 20, 61, 30, 30);
    rotated.rotation = 45;
    const hiddenOutside = createShapeWidget("rectangle", 20, 20, 60, 30);
    hiddenOutside.visible = false;

    expect(getWidgetsOutsideSafeArea([inside, underNotch, rotated, hiddenOutside], device).map((item) => item.id))
      .toEqual([underNotch.id, rotated.id]);
  });

  it("swaps viewport and safe-area axes when changing orientation", () => {
    expect(rotateDevice(device)).toEqual({
      ...device,
      width: 852,
      height: 393,
      insets: { top: 0, right: 59, bottom: 0, left: 34 },
      orientation: "landscape",
    });
    expect(rotateDevice(rotateDevice(device))).toEqual(device);
  });

  it("rotates widget coordinates clockwise and counterclockwise with the device", () => {
    const widget = createShapeWidget("rectangle", 20, 30, 40, 10);
    const landscape = rotateWidgetForDevice(widget, device, "landscape");
    expect(landscape).toMatchObject({
      x: 812,
      y: 20,
      width: 10,
      height: 40,
      rotation: 90,
    });
    expect(rotateWidgetForDevice(landscape, rotateDevice(device), "portrait")).toMatchObject({
      x: 20,
      y: 30,
      width: 40,
      height: 10,
      rotation: 0,
    });
  });

  it("detects geometry extending past the viewport", () => {
    expect(widgetOverflowsDevice({ x: 0, y: 0, width: 393, height: 852 }, device)).toBe(false);
    expect(widgetOverflowsDevice({ x: 370, y: 0, width: 40, height: 20 }, device)).toBe(true);
  });

  it("measures maximum viewport overflow in whole pixels, including rotated bounds", () => {
    expect(getWidgetViewportOverflow({ x: 0, y: 0, width: 393, height: 852 }, device)).toBe(0);
    expect(getWidgetViewportOverflow({ x: 370, y: 0, width: 40, height: 20 }, device)).toBe(17);
    expect(getWidgetViewportOverflow({ x: -8.2, y: 0, width: 40, height: 20 }, device)).toBe(9);

    const rotated = { x: 375, y: 0, width: 40, height: 20, rotation: 45 };
    expect(getWidgetViewportOverflow(rotated, device)).toBe(24);
  });

  it("keeps editor frame chrome out of persisted project data", () => {
    const serialized = JSON.stringify(createEmptyProject());
    expect(serialized).not.toContain("frameChrome");
    expect(serialized).not.toContain("showDeviceFrame");
    expect(serialized).not.toContain("showSafeArea");
  });
});
