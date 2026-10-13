import { invoke, isTauri } from "@tauri-apps/api/core";
import { IMAGE_ASSET_THRESHOLD, imageDataToBytes } from "../canvas/images";
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

  const updatedScreens = await Promise.all(
    project.screens.map(async (screen) => ({
      ...screen,
      widgets: await Promise.all(
        screen.widgets.map(async (widget): Promise<Widget> => {
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
            return widget;
          }
          const bytes = imageDataToBytes(src);
          if (bytes.byteLength < IMAGE_ASSET_THRESHOLD) return widget;
          const savedAssetPath = await invoke<string>("save_image_asset", {
            projectPath: path,
            mime,
            base64: src.slice(src.indexOf(",") + 1),
          });
          return {
            ...widget,
            props: { ...widget.props, assetPath: savedAssetPath },
          };
        }),
      ),
    })),
  );
  const projectWithAssets = { ...project, screens: updatedScreens };
  const savedPath = await invoke<string | null>("save_project", {
    path,
    content: serializeProject(projectWithAssets),
  });
  return savedPath ? { path: savedPath, project: projectWithAssets } : null;
}
