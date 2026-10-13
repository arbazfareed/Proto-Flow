import { z } from "zod";

export const DeviceInsetsSchema = z
  .object({
    top: z.number().finite().nonnegative().max(16_384),
    bottom: z.number().finite().nonnegative().max(16_384),
    left: z.number().finite().nonnegative().max(16_384),
    right: z.number().finite().nonnegative().max(16_384),
  })
  .strict();

export const ScreenDeviceSchema = z
  .object({
    presetId: z.string().trim().min(1).max(120),
    width: z.number().int().min(1).max(16_384),
    height: z.number().int().min(1).max(16_384),
    dpr: z.number().finite().min(0.25).max(8),
    insets: DeviceInsetsSchema,
  })
  .strict()
  .superRefine((device, context) => {
    if (device.insets.left + device.insets.right >= device.width) {
      context.addIssue({
        code: "custom",
        path: ["insets"],
        message: "Horizontal safe-area insets must be smaller than the viewport width.",
      });
    }
    if (device.insets.top + device.insets.bottom >= device.height) {
      context.addIssue({
        code: "custom",
        path: ["insets"],
        message: "Vertical safe-area insets must be smaller than the viewport height.",
      });
    }
  });
