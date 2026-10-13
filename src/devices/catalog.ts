import { z } from "zod";
import catalog from "../../devices/catalog.json";
import { DeviceInsetsSchema } from "./schema";
import type { DevicePreset, ScreenDevice } from "./types";

const DevicePresetSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    category: z.enum(["phone", "tablet", "laptop", "desktop", "watch"]),
    viewport: z.object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    }).strict(),
    dpr: z.number().finite().positive(),
    insets: DeviceInsetsSchema,
    orientation: z.enum(["portrait", "landscape"]),
    frameChrome: z.object({
      bezel: z.number().finite().nonnegative(),
      cornerRadius: z.number().finite().nonnegative(),
      notch: z.enum(["none", "notch", "dynamic-island", "punch-hole", "watch", "browser"]),
    }).strict().optional(),
  })
  .strict()
  .superRefine((device, context) => {
    if (device.insets.left + device.insets.right >= device.viewport.width) {
      context.addIssue({
        code: "custom",
        path: ["insets"],
        message: "Horizontal safe-area insets must fit inside the device viewport.",
      });
    }
    if (device.insets.top + device.insets.bottom >= device.viewport.height) {
      context.addIssue({
        code: "custom",
        path: ["insets"],
        message: "Vertical safe-area insets must fit inside the device viewport.",
      });
    }
  });

const DeviceCatalogSchema = z.object({
  version: z.number().int().positive(),
  devices: z.array(DevicePresetSchema).min(20),
}).strict().superRefine((value, context) => {
  const ids = new Set<string>();
  value.devices.forEach((device, index) => {
    if (ids.has(device.id)) {
      context.addIssue({
        code: "custom",
        path: ["devices", index, "id"],
        message: `Duplicate device preset ID: ${device.id}.`,
      });
    }
    ids.add(device.id);
  });
});

const parsedCatalog = DeviceCatalogSchema.parse(catalog);
export const DEVICE_CATALOG_VERSION = parsedCatalog.version;
export const DEVICE_PRESETS: readonly DevicePreset[] = parsedCatalog.devices;
export const DEVICE_CATEGORIES = [
  "phone",
  "tablet",
  "laptop",
  "desktop",
  "watch",
] as const;
export const DEFAULT_DEVICE_PRESET =
  DEVICE_PRESETS.find((device) => device.id === "desktop-1440-900") ??
  DEVICE_PRESETS[0];

export function toScreenDevice(device: DevicePreset): ScreenDevice {
  return {
    presetId: device.id,
    width: device.viewport.width,
    height: device.viewport.height,
    dpr: device.dpr,
    insets: { ...device.insets },
  };
}

export function findDevicePreset(presetId: string): DevicePreset | undefined {
  return DEVICE_PRESETS.find((device) => device.id === presetId);
}
