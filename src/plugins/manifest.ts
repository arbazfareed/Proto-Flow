import { z } from "zod";

export const PLUGIN_PERMISSIONS = [
  "canvas:write",
  "export:write",
  "ai:generate",
  "commands:run",
  "project:read",
] as const;
export type PluginPermission = (typeof PLUGIN_PERMISSIONS)[number];

export const PluginManifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9.-]{2,79}$/),
  name: z.string().trim().min(1).max(80),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
  author: z.string().trim().min(1).max(80),
  main: z.literal("plugin.js"),
  permissions: z.array(z.enum(PLUGIN_PERMISSIONS)).max(PLUGIN_PERMISSIONS.length)
    .refine((permissions) => new Set(permissions).size === permissions.length, {
      message: "Plugin permissions must not contain duplicates.",
    }),
}).strict();

export type PluginManifest = z.infer<typeof PluginManifestSchema>;

export interface InstalledPlugin {
  manifest: PluginManifest;
  source: string;
  enabled: boolean;
  installedAt: string;
}

export function parsePluginManifest(raw: unknown): PluginManifest {
  const result = PluginManifestSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid plugin manifest: ${result.error.issues.map((issue) => issue.message).join("; ")}`);
  }
  return result.data;
}
