import { isTauri } from "@tauri-apps/api/core";
import { check, type Update } from "@tauri-apps/plugin-updater";

export async function checkForUpdate(): Promise<Update | null> {
  if (!import.meta.env.PROD || !isTauri()) return null;

  return check();
}
