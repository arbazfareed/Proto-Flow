import { z } from "zod";

export const PROJECT_SCHEMA_VERSION = "1.0.0";

export const ProjectSchema = z.object({
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  pages: z
    .array(
      z.object({
        id: z.string().uuid(),
        name: z.string().trim().min(1).max(120),
        nodes: z.array(z.unknown()),
      }),
    )
    .min(1),
});

export type Project = z.infer<typeof ProjectSchema>;

export function createProject(name = "Untitled project"): Project {
  const now = new Date().toISOString();
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: crypto.randomUUID(),
    name,
    createdAt: now,
    updatedAt: now,
    pages: [{ id: crypto.randomUUID(), name: "Page 1", nodes: [] }],
  };
}

export function parseProject(serialized: string): Project {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch (error) {
    throw new Error("This file is not valid JSON.", { cause: error });
  }
  return ProjectSchema.parse(value);
}

export function serializeProject(project: Project): string {
  return `${JSON.stringify(ProjectSchema.parse(project), null, 2)}\n`;
}
