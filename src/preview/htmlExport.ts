import JSZip from "jszip";
import type { Project } from "../project/schema";
import {
  PREVIEW_RUNTIME_SCRIPT,
  PREVIEW_RUNTIME_STYLES,
} from "./publishBundle";
import { widgetNotesHtmlComments } from "../project/widgetNotes";

export const MAX_LOCAL_HTML_EXPORT_BYTES = 100 * 1024 * 1024;
const MAX_IMAGE_ASSET_BYTES = 25 * 1024 * 1024;

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/webp": "webp",
  "image/x-icon": "ico",
  "image/tiff": "tiff",
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function serializeProject(project: Project): string {
  return JSON.stringify(project)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function imageData(value: string): { mime: string; bytes: Uint8Array } {
  const match = value.match(/^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/i);
  if (!match) {
    throw new Error("An image is not embedded in the project. Add local image files before exporting an offline bundle.");
  }
  const extension = IMAGE_EXTENSIONS[match[1].toLowerCase()];
  if (!extension) throw new Error(`The image format "${match[1]}" is not supported in an offline bundle.`);
  let binary: string;
  try {
    binary = atob(match[2]);
  } catch {
    throw new Error("An embedded image contains invalid base64 data.");
  }
  if (binary.length === 0 || binary.length > MAX_IMAGE_ASSET_BYTES) {
    throw new Error("Each image in a local HTML bundle must be 25 MiB or smaller.");
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return { mime: match[1].toLowerCase(), bytes };
}

function prepareHtmlProject(
  project: Project,
  includeInteractions: boolean,
  includeAssets: boolean,
): Project {
  const prepared = structuredClone(project);
  for (const screen of prepared.screens) {
    if (!includeInteractions) screen.interactionRules = [];
    for (const widget of screen.widgets) {
      if (widget.type !== "image") continue;
      const source = widget.props.src ?? widget.props.url;
      delete widget.props.assetPath;
      delete widget.props.url;
      if (
        includeAssets &&
        typeof source === "string" &&
        /^(?:https?:)?\/\//i.test(source)
      ) {
        throw new Error("Offline HTML export cannot fetch remote images. Replace them with local image assets or turn off image assets.");
      }
      if (typeof source === "string" && source.startsWith("data:image/")) {
        widget.props.src = source;
      } else {
        widget.props.src = "";
      }
    }
  }
  return prepared;
}

export async function generateLocalHtmlArchive(
  project: Project,
  options: { includeInteractions: boolean; includeAssets: boolean },
): Promise<Uint8Array> {
  const prepared = prepareHtmlProject(project, options.includeInteractions, options.includeAssets);
  const zip = new JSZip();
  const assets = zip.folder("assets");
  if (!assets) throw new Error("Could not create the assets folder in the HTML bundle.");

  if (options.includeAssets) {
    let assetIndex = 0;
    for (const screen of prepared.screens) {
      for (const widget of screen.widgets) {
        if (widget.type !== "image") continue;
        const source = widget.props.src;
        if (typeof source !== "string" || source.length === 0) continue;
        const { mime, bytes } = imageData(source);
        const extension = IMAGE_EXTENSIONS[mime];
        const assetPath = `assets/image-${++assetIndex}.${extension}`;
        assets.file(assetPath.slice("assets/".length), bytes);
        widget.props.src = assetPath;
      }
    }
  } else {
    for (const screen of prepared.screens) {
      for (const widget of screen.widgets) {
        if (widget.type === "image") widget.props.src = "";
      }
    }
  }

  const title = escapeHtml(prepared.name);
  const notesComments = widgetNotesHtmlComments(prepared);
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${title} — ProtoFlow</title>
<link rel="stylesheet" href="./style.css">
</head>
<body>
${notesComments}
<header class="toolbar"><button id="back" type="button" aria-label="Back">Back</button><select id="screen-picker" aria-label="Preview screen"></select><button id="restart" type="button">Restart</button><span>Exported with ProtoFlow</span></header>
<main class="stage-wrap"><section id="stage" class="stage" aria-label="Prototype preview"></section></main>
<script id="project-data" type="application/json">${serializeProject(prepared)}</script>
<script src="./runtime.js" defer></script>
</body>
</html>`;

  zip.file("index.html", html);
  zip.file("runtime.js", PREVIEW_RUNTIME_SCRIPT);
  zip.file("style.css", PREVIEW_RUNTIME_STYLES);
  const output = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  if (output.byteLength > MAX_LOCAL_HTML_EXPORT_BYTES) {
    throw new Error("The generated HTML bundle exceeds the 100 MiB export limit.");
  }
  return output;
}

export function localHtmlExportFileName(projectName: string): string {
  const safeName = projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${safeName || "prototype"}-html-export.zip`;
}

export function localHtmlArchiveBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}
