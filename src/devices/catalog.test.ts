import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  DEVICE_CATALOG_VERSION,
  DEVICE_CATEGORIES,
  DEVICE_PRESETS,
  findDevicePreset,
  toScreenDevice,
} from "./catalog";
import { ScreenDeviceSchema } from "./schema";
import { getSafeAreaBounds, rotateDevice } from "./frame";
import { createEmptyProject, parseProject, serializeProject } from "../project/schema";

describe("device preset catalog", () => {
  it("ships at least 20 unique presets across every supported category", () => {
    expect(DEVICE_CATALOG_VERSION).toBeGreaterThan(0);
    expect(DEVICE_PRESETS.length).toBeGreaterThanOrEqual(20);
    expect(new Set(DEVICE_PRESETS.map((device) => device.id)).size).toBe(DEVICE_PRESETS.length);
    for (const category of DEVICE_CATEGORIES) {
      expect(DEVICE_PRESETS.some((device) => device.category === category)).toBe(true);
    }
  });

  it("defines the requested named devices and positive viewport metadata", () => {
    const requested = [
      "iPhone 15 Pro",
      "iPhone 15",
      "iPhone SE",
      "Pixel 8",
      "Pixel 8 Pro",
      "Samsung Galaxy S24",
      "Samsung Galaxy A54",
      "iPad Pro 12.9″",
      "iPad Air",
      "iPad Mini",
      "Galaxy Tab S9",
      "MacBook Pro 14″",
      "MacBook Air 13″",
      "Dell XPS 13",
      "Desktop 1440 × 900",
      "Desktop 1920 × 1080",
      "Desktop 2560 × 1440",
      "Desktop 4K 3840 × 2160",
      "Apple Watch Series 9",
    ];
    const names = new Set(DEVICE_PRESETS.map((device) => device.name));

    for (const name of requested) expect(names.has(name)).toBe(true);
    for (const device of DEVICE_PRESETS) {
      expect(device.viewport.width).toBeGreaterThan(0);
      expect(device.viewport.height).toBeGreaterThan(0);
      expect(device.dpr).toBeGreaterThan(0);
      expect(device.insets.top + device.insets.bottom).toBeLessThan(device.viewport.height);
      expect(device.insets.left + device.insets.right).toBeLessThan(device.viewport.width);
      expect(["portrait", "landscape"]).toContain(device.orientation);
    }
  });

  it("converts presets to persistable screen device settings", () => {
    const preset = findDevicePreset("iphone-15-pro");
    expect(preset).toBeDefined();
    if (!preset) throw new Error("Expected the iPhone 15 Pro device preset.");
    expect(toScreenDevice(preset)).toEqual({
      presetId: "iphone-15-pro",
      width: 393,
      height: 852,
      dpr: 3,
      insets: { top: 59, bottom: 34, left: 0, right: 0 },
      orientation: "portrait",
    });
  });

  it("keeps every preset valid at all documented display scales and orientations", () => {
    for (const preset of DEVICE_PRESETS) {
      for (const displayScale of [1, 1.25, 1.5, 2]) {
        const device = ScreenDeviceSchema.parse({
          ...toScreenDevice(preset),
          dpr: displayScale,
        });
        const safeArea = getSafeAreaBounds(device);
        expect(safeArea.x + safeArea.width).toBe(device.width - device.insets.right);
        expect(safeArea.y + safeArea.height).toBe(device.height - device.insets.bottom);
        expect(rotateDevice(rotateDevice(device))).toEqual(device);
      }
    }
  });
});

describe("screen device project schema", () => {
  it("ships an example project with a responsive screen for every device preset", () => {
    const example = parseProject(
      JSON.parse(readFileSync(new URL("../../examples/device-presets.pflow", import.meta.url), "utf8")),
    );

    expect(example.screens).toHaveLength(DEVICE_PRESETS.length);
    for (const preset of DEVICE_PRESETS) {
      const screen = example.screens.find((item) => item.device?.presetId === preset.id);
      expect(screen, `missing example screen for ${preset.name}`).toBeDefined();
      expect(screen?.breakpoints?.length).toBeGreaterThanOrEqual(3);
      expect(screen?.widgets).toHaveLength(1);
    }
  });

  it("accepts projects with no device metadata for backward compatibility", () => {
    const project = createEmptyProject();
    const legacy = parseProject({
      ...project,
      screens: project.screens.map((screen) => ({ ...screen, device: undefined })),
    });
    expect(legacy.screens[0].device).toBeUndefined();
  });

  it("persists preset and custom viewport settings through project serialization", () => {
    const project = createEmptyProject();
    const custom = {
      presetId: "custom",
      width: 640,
      height: 960,
      dpr: 1.5,
      insets: { top: 30, bottom: 24, left: 8, right: 8 },
    };
    const parsed = parseProject({
      ...project,
      screens: project.screens.map((screen) => ({ ...screen, device: custom })),
    });
    expect(JSON.parse(serializeProject(parsed)).screens[0].device).toEqual(custom);
  });

  it("rejects dimensions and safe-area insets that cannot fit the viewport", () => {
    expect(ScreenDeviceSchema.safeParse({
      presetId: "custom",
      width: 320,
      height: 640,
      dpr: 1,
      insets: { top: 12, bottom: 628, left: 0, right: 0 },
    }).success).toBe(false);
    expect(ScreenDeviceSchema.safeParse({
      presetId: "custom",
      width: 16_385,
      height: 640,
      dpr: 1,
      insets: { top: 0, bottom: 0, left: 0, right: 0 },
    }).success).toBe(false);
  });
});
