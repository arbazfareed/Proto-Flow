import { invoke, isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { parseProject, serializeProject, type Project } from "./schema";

const projectFilter = [{ name: "Proto Flow project", extensions: ["pflow"] }];

function requireDesktopRuntime(): void {
  if (!isTauri()) {
    throw new Error("Project files can be opened and saved from the Proto Flow desktop app.");
  }
}

export async function openProjectFile(): Promise<{ project: Project; path: string } | null> {
  requireDesktopRuntime();
  const selected = await open({ filters: projectFilter, multiple: false, directory: false });
  if (!selected || Array.isArray(selected)) return null;

  const serialized = await invoke<string>("read_project_file", { path: selected });
  return { project: parseProject(serialized), path: selected };
}

export async function saveProjectFile(
  project: Project,
  currentPath: string | null,
): Promise<string | null> {
  requireDesktopRuntime();
  const selected =
    currentPath ??
    (await save({
      defaultPath: `${project.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")}.pflow`,
      filters: projectFilter,
    }));
  if (!selected) return null;

  const path = selected.toLowerCase().endsWith(".pflow") ? selected : `${selected}.pflow`;
  await invoke("write_project_file", {
    path,
    contents: serializeProject(project),
  });
  return path;
}
