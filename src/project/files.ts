import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  IMAGE_ASSET_THRESHOLD,
  MAX_INLINE_IMAGE_BYTES,
  imageDataToBytes,
} from "../canvas/images";
import { parseProject, serializeProject, type Project, type Widget } from "./schema";

function requireDesktopRuntime(): void {
  if (!isTauri()) {
    throw new Error("Project files can be opened and saved from the Proto Flow desktop app.");
  }
}

export async function openProjectFile(): Promise<{ project: Project; path: string } | null> {
  requireDesktopRuntime();
  const opened = await invoke<{ path: string; content: string } | null>("open_project");
  if (!opened) return null;
  return { project: parseProject(opened.content), path: opened.path };
}

export async function saveProjectFile(
  project: Project,
  currentPath: string | null,
  saveAs = false,
): Promise<{ path: string; project: Project } | null> {
  requireDesktopRuntime();
  let path = currentPath;
  if (saveAs || !path) {
    path = await invoke<string | null>("pick_project_save_path", {
      defaultFilename: project.name,
    });
  }
  if (!path) return null;

  let inlineImageBytes = 0;
  const updatedScreens = [];
  for (const screen of project.screens) {
    const widgets: Widget[] = [];
    for (const widget of screen.widgets) {
      const src = widget.props.src;
      const assetPath = widget.props.assetPath;
      const mime = widget.props.mime;
      if (
        widget.type !== "image" ||
        typeof src !== "string" ||
        !src.startsWith("data:image/") ||
        typeof mime !== "string" ||
        typeof assetPath === "string"
      ) {
        widgets.push(widget);
        continue;
      }
      const bytes = imageDataToBytes(src);
      const exceedsInlineBudget =
        inlineImageBytes + bytes.byteLength > MAX_INLINE_IMAGE_BYTES;
      if (bytes.byteLength < IMAGE_ASSET_THRESHOLD && !exceedsInlineBudget) {
        inlineImageBytes += bytes.byteLength;
        widgets.push(widget);
        continue;
      }
      const savedAssetPath = await invoke<string>("save_image_asset", {
        projectPath: path,
        mime,
        base64: src.slice(src.indexOf(",") + 1),
      });
      const { src: _embeddedSource, ...props } = widget.props;
      widgets.push({
        ...widget,
        props: { ...props, assetPath: savedAssetPath },
      });
    }
    updatedScreens.push({ ...screen, widgets });
  }
  const projectWithAssets = { ...project, screens: updatedScreens };
  const savedPath = await invoke<string | null>("save_project", {
    path,
    content: serializeProject(projectWithAssets),
  });
  return savedPath ? { path: savedPath, project: projectWithAssets } : null;
}
