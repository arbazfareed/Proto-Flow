import { z } from "zod";
import { ProjectSchema, type Project } from "./schema";

export const RECOVERY_KEY = "proto-flow:crash-recovery:v1";

const RecoverySchema = z.object({
  project: ProjectSchema,
  filePath: z.string().nullable(),
  recoveredAt: z.string().datetime(),
});

export type RecoverySnapshot = z.infer<typeof RecoverySchema>;

export function readRecoverySnapshot(): RecoverySnapshot | null {
  const serialized = localStorage.getItem(RECOVERY_KEY);
  if (!serialized) return null;
  try {
    return RecoverySchema.parse(JSON.parse(serialized));
  } catch (error) {
    localStorage.removeItem(RECOVERY_KEY);
    console.error("Discarding invalid Proto Flow recovery data.", error);
    return null;
  }
}

export function writeRecoverySnapshot(project: Project, filePath: string | null): void {
  const snapshot: RecoverySnapshot = {
    project,
    filePath,
    recoveredAt: new Date().toISOString(),
  };
  localStorage.setItem(RECOVERY_KEY, JSON.stringify(snapshot));
}

export function clearRecoverySnapshot(): void {
  localStorage.removeItem(RECOVERY_KEY);
}
