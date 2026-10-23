import { describe, expect, it } from "vitest";
import { createEmptyProject } from "../project/schema";
import { findDevicePreset } from "../devices/catalog";
import {
  DEFAULT_MULTI_DEVICE_IDS,
  getPreviewViewport,
  resolvePreviewWidgets,
} from "./deviceLayouts";

describe("multi-device preview layouts", () => {
  it("provides desktop, tablet, mobile, and additional phone defaults", () => {
    expect(DEFAULT_MULTI_DEVICE_IDS).toHaveLength(4);
    expect(DEFAULT_MULTI_DEVICE_IDS.every((id) => findDevicePreset(id))).toBe(true);
  });

  it("rotates device dimensions without mutating the preset", () => {
    const device = findDevicePreset("iphone-15-pro")!;

    expect(getPreviewViewport(device, true)).toEqual({
      width: device.viewport.height,
      height: device.viewport.width,
    });
    expect(device.viewport.width).toBe(393);
  });

  it("applies breakpoint constraints and per-breakpoint widget overrides", () => {
    const screen = createEmptyProject("Responsive preview").screens[0];
    screen.device = {
      presetId: "desktop-1440-900",
      width: 1440,
      height: 900,
      dpr: 1,
      orientation: "landscape",
      insets: { top: 0, bottom: 0, left: 0, right: 0 },
    };
    screen.widgets.push({
      id: crypto.randomUUID(),
      type: "button",
      x: 100,
      y: 40,
      width: 300,
      height: 40,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      zIndex: 0,
      cascadeMode: "fluid",
      style: {},
      props: {},
      overrides: { mobile: { x: 12, width: 200 } },
    });

    expect(resolvePreviewWidgets(screen, { width: 390, height: 844 })[0]).toMatchObject({
      x: 12,
      width: 200,
    });
  });
});
