import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Project } from "../project/schema";

export async function embedProjectAssets(
  project: Project,
  projectPath: string | null,
  includeAssets: boolean,
): Promise<Project> {
  const embedded = structuredClone(project);
  if (!includeAssets) return embedded;
  for (const screen of embedded.screens) {
    for (const widget of screen.widgets) {
      const assetPath = widget.props.assetPath;
      const source = widget.props.src;
      if (
        widget.type !== "image" ||
        typeof assetPath !== "string" ||
        (typeof source === "string" && source.startsWith("data:image/"))
      ) continue;
      if (!isTauri() || !projectPath) {
        throw new Error("This project uses saved image assets. Open it in the desktop app and save it before exporting with assets.");
      }
      const asset = await invoke<{ mime: string; base64: string }>("read_image_asset", {
        projectPath,
        assetPath,
      });
      widget.props.src = `data:${asset.mime};base64,${asset.base64}`;
    }
  }
  return embedded;
}
