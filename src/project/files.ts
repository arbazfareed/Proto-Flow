import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  IMAGE_ASSET_THRESHOLD,
  MAX_INLINE_IMAGE_BYTES,
  imageDataToBytes,
} from "../canvas/images";
import { parseProject, serializeProject, type Project, type Widget } from "./schema";

export interface SavedProject {
  path: string;
  project: Project;
  /** Browser only: "file" wrote to the chosen file, "download" downloaded a new copy. */
  method?: "file" | "download";
}

/** Largest .pflow file the browser version reads into memory. */
const MAX_BROWSER_PROJECT_BYTES = 100 * 1024 * 1024;

/** Shows the browser's file picker. Resolves null when the person closes it without choosing (B45). */
function pickProjectFileInBrowser(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pflow,application/json";
    input.style.display = "none";
    let settled = false;
    const finish = (file: File | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(file);
    };
    input.addEventListener("change", () => finish(input.files?.[0] ?? null));
    input.addEventListener("cancel", () => finish(null));
    document.body.append(input);
    input.click();
  });
}

/** The parts of the browser's File System Access API that Proto Flow uses (Chrome, Edge). */
interface BrowserFileHandle {
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{
    write(data: string): Promise<void>;
    close(): Promise<void>;
    abort?(): Promise<void>;
  }>;
}

interface BrowserFileAccess {
  showSaveFilePicker?: (options: unknown) => Promise<BrowserFileHandle>;
  showOpenFilePicker?: (options: unknown) => Promise<BrowserFileHandle[]>;
}

const PROJECT_FILE_TYPES = [
  { description: "Proto Flow project", accept: { "application/json": [".pflow"] } },
];

function getBrowserFileAccess(): BrowserFileAccess | null {
  return typeof window === "undefined" ? null : (window as unknown as BrowserFileAccess);
}

function isPickerCancelled(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/**
 * The file the browser last saved to or opened, so Save writes into the same file instead of
 * downloading another copy each time (B62). It is only used while the project's file name still
 * matches, and it is forgotten whenever a file is opened without a handle.
 */
let browserSaveTarget: { handle: BrowserFileHandle; path: string } | null = null;

/** A copy of the project that can be written to one file, with a safe file name. */
function preparePortableProject(project: Project): { portableProject: Project; fileName: string } {
  const portableProject = structuredClone(project);
  for (const screen of portableProject.screens) {
    for (const widget of screen.widgets) {
      if (widget.type !== "image" || typeof widget.props.assetPath !== "string") continue;
      const source = widget.props.src;
      if (typeof source !== "string" || !source.startsWith("data:image/")) {
        throw new Error(
          "This project uses image files stored beside its desktop project. Open it in the desktop app to download a copy with those assets.",
        );
      }
      delete widget.props.assetPath;
    }
  }

  const safeName = project.name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .trim()
    .replace(/[. ]+$/g, "")
    .slice(0, 120) || "proto-flow-project";
  return { portableProject, fileName: `${safeName}.pflow` };
}

function downloadProjectInBrowser(project: Project): SavedProject {
  const { portableProject, fileName } = preparePortableProject(project);
  const blobUrl = URL.createObjectURL(
    new Blob([serializeProject(portableProject)], { type: "application/json;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = fileName;
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  return { path: fileName, project, method: "download" };
}

/**
 * Saves in the browser. Where the browser can write to a chosen file (Chrome, Edge) the first save
 * asks where, and later saves overwrite that file. Other browsers can only download a new copy.
 * Resolves null when the person closes the file picker.
 */
async function saveProjectInBrowser(
  project: Project,
  currentPath: string | null,
  saveAs: boolean,
): Promise<SavedProject | null> {
  const access = getBrowserFileAccess();
  if (!access?.showSaveFilePicker) return downloadProjectInBrowser(project);

  const { portableProject, fileName } = preparePortableProject(project);
  let target = !saveAs && currentPath && browserSaveTarget?.path === currentPath
    ? browserSaveTarget
    : null;
  if (!target) {
    try {
      const handle = await access.showSaveFilePicker({
        suggestedName: fileName,
        types: PROJECT_FILE_TYPES,
      });
      target = { handle, path: handle.name };
    } catch (error) {
      if (isPickerCancelled(error)) return null;
      throw error;
    }
  }

  try {
    const writable = await target.handle.createWritable();
    try {
      await writable.write(serializeProject(portableProject));
      await writable.close();
    } catch (error) {
      await writable.abort?.().catch(() => undefined);
      throw error;
    }
  } catch (error) {
    // The file may have been moved or the permission withdrawn: ask again on the next save.
    browserSaveTarget = null;
    throw error;
  }
  browserSaveTarget = target;
  return { path: target.path, project, method: "file" };
}

export async function openProjectFile(): Promise<{ project: Project; path: string } | null> {
  if (!isTauri()) {
    let handle: BrowserFileHandle | null = null;
    let file: File | null;
    const access = getBrowserFileAccess();
    if (access?.showOpenFilePicker) {
      try {
        [handle] = await access.showOpenFilePicker({ types: PROJECT_FILE_TYPES, multiple: false });
      } catch (error) {
        if (isPickerCancelled(error)) return null;
        throw error;
      }
      file = handle ? await handle.getFile() : null;
    } else {
      file = await pickProjectFileInBrowser();
    }
    if (!file) return null;
    if (file.size > MAX_BROWSER_PROJECT_BYTES) {
      throw new Error("This project file is too large to open in the browser (over 100 MB).");
    }
    const project = parseProject(await file.text());
    // With a handle, Save writes back into this same file (B62).
    browserSaveTarget = handle ? { handle, path: file.name } : null;
    return { project, path: file.name };
  }
  const opened = await invoke<{ path: string; content: string } | null>("open_project");
  if (!opened) return null;
  return { project: parseProject(opened.content), path: opened.path };
}

export async function saveProjectFile(
  project: Project,
  currentPath: string | null,
  saveAs = false,
): Promise<SavedProject | null> {
  if (!isTauri()) return saveProjectInBrowser(project, currentPath, saveAs);
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
        widget.type === "image" &&
        typeof assetPath === "string" &&
        currentPath &&
        currentPath !== path
      ) {
        const asset = await invoke<{ mime: string; base64: string }>("read_image_asset", {
          projectPath: currentPath,
          assetPath,
        });
        const copiedAssetPath = await invoke<string>("save_image_asset", {
          projectPath: path,
          mime: asset.mime,
          base64: asset.base64,
        });
        widgets.push({
          ...widget,
          props: { ...widget.props, assetPath: copiedAssetPath },
        });
        continue;
      }
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
