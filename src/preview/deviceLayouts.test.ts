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

  it("stretches the widest breakpoint across a wider window instead of leaving a blank strip (B91)", () => {
    const screen = createEmptyProject("Phone app with a desktop layout").screens[0];
    screen.device = {
      presetId: "iphone-15-pro", width: 393, height: 852, dpr: 3, orientation: "portrait",
      insets: { top: 0, bottom: 0, left: 0, right: 0 },
    };
    screen.breakpoints = [
      { id: "mobile", name: "Mobile", minWidth: 0, maxWidth: 767, width: 393, height: 852 },
      { id: "desktop", name: "Desktop", minWidth: 768, width: 1024, height: 852 },
    ];
    const widget = (overrides: Record<string, unknown>) => ({
      id: crypto.randomUUID(), type: "rectangle", x: 0, y: 0, width: 100, height: 40, rotation: 0,
      opacity: 1, visible: true, locked: false, zIndex: 0, style: {}, props: {}, ...overrides,
    });
    // Designed for 1024 px on desktop: a side panel and a chat area that ends at 1024.
    const panel = widget({ overrides: { desktop: { x: 0, width: 320 } } });
    const chat = widget({ overrides: { desktop: { x: 320, width: 704 } } });
    const avatar = widget({ type: "avatar", width: 40, height: 40, overrides: { desktop: { x: 340, y: 10 } } });
    screen.widgets.push(panel as never, chat as never, avatar as never);

    const [wide, , face] = resolvePreviewWidgets(screen, { width: 1440, height: 900 });
    const chatWide = resolvePreviewWidgets(screen, { width: 1440, height: 900 })[1];
    expect(wide).toMatchObject({ x: 0, width: 450 });
    // The chat area now reaches the right edge: no blank strip.
    expect(chatWide.x + chatWide.width).toBe(1440);
    // An avatar keeps its round shape and moves along.
    expect(face).toMatchObject({ width: 40, height: 40 });
    expect(face.x).toBeGreaterThan(340);

    // At exactly 1024 px nothing changes.
    expect(resolvePreviewWidgets(screen, { width: 1024, height: 852 })[1]).toMatchObject({ x: 320, width: 704 });
  });
});
