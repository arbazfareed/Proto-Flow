import { findDevicePreset } from "../devices/catalog";
import type { ScreenDevice } from "../devices/types";

export const SCREEN_INPUT_MODES = ["touch", "mouse", "both"] as const;
export type ScreenInputMode = typeof SCREEN_INPUT_MODES[number];

export function inferScreenInputMode(device: ScreenDevice | undefined): ScreenInputMode {
  if (!device) return "mouse";
  const category = findDevicePreset(device.presetId)?.category;
  if (category === "phone" || category === "watch") return "touch";
  if (category === "tablet") return "both";
  if (category) return "mouse";
  if (device.width < 768) return "touch";
  if (device.width < 1024) return "both";
  return "mouse";
}
