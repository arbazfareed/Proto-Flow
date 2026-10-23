import { describe, expect, it } from "vitest";
import { createEmptyProject, parseProject } from "./schema";
import { inferScreenInputMode } from "./inputModes";
import { toScreenDevice, findDevicePreset } from "../devices/catalog";

describe("screen input modes", () => {
  it("infers touch, both, and mouse from the device preset category", () => {
    const phone = findDevicePreset("iphone-15-pro");
    const tablet = findDevicePreset("ipad-pro-12-9");
    const desktop = findDevicePreset("desktop-1440-900");
    expect(phone && inferScreenInputMode(toScreenDevice(phone))).toBe("touch");
    expect(tablet && inferScreenInputMode(toScreenDevice(tablet))).toBe("both");
    expect(desktop && inferScreenInputMode(toScreenDevice(desktop))).toBe("mouse");
  });

  it("infers an input mode for missing mode values but preserves explicit choices", () => {
    const project = createEmptyProject("Screen modes");
    const current = project.screens[0];
    const phone = findDevicePreset("iphone-15-pro");
    if (!phone) throw new Error("Expected the iPhone preset to exist.");
    const { inputMode: _currentMode, ...screenWithoutMode } = current;
    const parsed = parseProject({
      ...project,
      screens: [{
        ...screenWithoutMode,
        device: toScreenDevice(phone),
      }],
    });
    expect(parsed.screens[0].inputMode).toBe("touch");
    expect(parseProject(project).screens[0].inputMode).toBe("mouse");
  });
});
