import { relaunch } from "@tauri-apps/plugin-process";
import type { Update } from "@tauri-apps/plugin-updater";

export async function installAvailableUpdate(
  update: Pick<Update, "downloadAndInstall">,
): Promise<void> {
  await update.downloadAndInstall();
  await relaunch();
}
