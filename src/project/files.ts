import { invoke, isTauri } from "@tauri-apps/api/core";
import { parseProject, serializeProject, type Project } from "./schema";

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
): Promise<string | null> {
  requireDesktopRuntime();
  const content = serializeProject(project);
  if (saveAs) {
    return invoke<string | null>("save_project_as", {
      defaultFilename: project.name,
      content,
    });
  }
  return invoke<string | null>("save_project", {
    path: currentPath,
    content,
  });
}
