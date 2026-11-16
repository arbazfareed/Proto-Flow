import { findDevicePreset } from "../devices/catalog";
import type { ScreenDevice } from "../devices/types";

export const SCREEN_INPUT_MODES = ["touch", "mouse", "both"] as const;
export type ScreenInputMode = typeof SCREEN_INPUT_MODES[number];

export function inferScreenInputMode(device: ScreenDevice | undefined): ScreenInputMode {
  if (!device) return "mouse";
  const category = findDevicePreset(device.presetId)?.category;
  // Phones and tablets accept both, so a prototype also works when clicked with a mouse.
  if (category === "watch") return "touch";
  if (category === "phone" || category === "tablet") return "both";
  if (category) return "mouse";
  if (device.width < 300) return "touch";
  if (device.width < 1024) return "both";
  return "mouse";
}
