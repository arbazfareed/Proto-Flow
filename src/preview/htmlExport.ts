import JSZip from "jszip";
import type { Project } from "../project/schema";
import {
  generatePublishedPreviewHtml,
  PREVIEW_RUNTIME_SCRIPT,
  PREVIEW_RUNTIME_STYLES,
} from "./publishBundle";
import { widgetNotesHtmlComments } from "../project/widgetNotes";
import { ensureRichTextRuns } from "../project/richText";
import { getScreenBreakpoints, resolveWidgetsForBreakpoint } from "../project/responsive";
import { DEVICE_PRESETS, findDevicePreset } from "../devices/catalog";
import { toPng } from "html-to-image";

export const MAX_LOCAL_HTML_EXPORT_BYTES = 100 * 1024 * 1024;
const MAX_IMAGE_ASSET_BYTES = 25 * 1024 * 1024;
const MAX_DERIVATIVE_PIXELS = 16_000_000;

export type LocalHtmlExportMode = "responsive" | "device-variants" | "device-images";

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
  return JSON.stringify(ensureRichTextRuns(project))
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
      delete widget.props.srcset;
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

function mediaQuery(minWidth: number, maxWidth?: number): string {
  if (maxWidth === undefined) return `@media (min-width:${minWidth}px)`;
  if (minWidth === 0) return `@media (max-width:${maxWidth}px)`;
  return `@media (min-width:${minWidth}px) and (max-width:${maxWidth}px)`;
}

export function responsiveLayoutStyles(project: Project): string {
  return project.screens.flatMap((screen) => {
    const baseWidth = screen.device?.width ?? 1440;
    const baseHeight = screen.device?.height ?? 900;
    return getScreenBreakpoints(screen).map((breakpoint) => {
      const widgets = resolveWidgetsForBreakpoint(
        screen.widgets,
        breakpoint,
        baseWidth,
        baseHeight,
        screen.compactLayout,
      );
      const screenSelector = `#stage[data-screen-id=${JSON.stringify(screen.id)}]`;
      const stageRule = `${screenSelector}{width:${breakpoint.width}px!important;height:${breakpoint.height}px!important}`;
      const widgetRules = widgets.map((widget) => {
        const selector = `${screenSelector} [data-widget-id=${JSON.stringify(widget.id)}]`;
        const geometry = [
          `left:${widget.x}px!important`,
          `top:${widget.y}px!important`,
          `width:${widget.width}px!important`,
          `height:${widget.height}px!important`,
          `transform:rotate(${widget.rotation}deg)!important`,
        ];
        if (!widget.visible) geometry.push("display:none!important");
        return `${selector}{${geometry.join(";")}}`;
      }).join("\n");
      return `${mediaQuery(breakpoint.minWidth, breakpoint.maxWidth)}{${stageRule}${widgetRules}}`;
    });
  }).join("\n");
}

async function addDprImageAssets(
  value: string,
  assetIndex: number,
  assets: JSZip,
): Promise<{ source: string; srcset: string }> {
  const { mime, bytes } = imageData(value);
  const extension = IMAGE_EXTENSIONS[mime];
  const source = `assets/image-${assetIndex}.${extension}`;
  assets.file(source.slice("assets/".length), bytes);
  const candidates = [`${source} 1x`];

  if (mime === "image/svg+xml" || typeof createImageBitmap !== "function") {
    return { source, srcset: candidates.join(", ") };
  }

  const bitmap = await createImageBitmap(new Blob([Uint8Array.from(bytes).buffer], { type: mime }));
  try {
    for (const ratio of [2, 3]) {
      const width = bitmap.width * ratio;
      const height = bitmap.height * ratio;
      if (width * height > MAX_DERIVATIVE_PIXELS) continue;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not prepare 2×/3× image variants for HTML export.");
      context.drawImage(bitmap, 0, 0, width, height);
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((result) => {
          if (result) resolve(result);
          else reject(new Error("Could not encode a high-DPI image variant."));
        }, "image/png");
      });
      const path = `assets/image-${assetIndex}-${ratio}x.png`;
      assets.file(path.slice("assets/".length), new Uint8Array(await blob.arrayBuffer()));
      candidates.push(`${path} ${ratio}x`);
    }
  } finally {
    bitmap.close();
  }
  return { source, srcset: candidates.join(", ") };
}

function htmlPage(project: Project, titleSuffix = "ProtoFlow"): string {
  const title = escapeHtml(project.name);
  const notesComments = widgetNotesHtmlComments(project);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${title} — ${escapeHtml(titleSuffix)}</title>
<link rel="stylesheet" href="./style.css">
</head>
<body>
${notesComments}
<header class="toolbar"><button id="back" type="button" aria-label="Back">Back</button><select id="screen-picker" aria-label="Preview screen"></select><button id="restart" type="button">Restart</button><span>Exported with ProtoFlow · ${escapeHtml(titleSuffix)}</span></header>
<main class="stage-wrap"><section id="stage" class="stage" aria-label="Prototype preview"></section></main>
<script id="project-data" type="application/json">${serializeProject(project)}</script>
<script src="./runtime.js" defer></script>
</body>
</html>`;
}

export async function generateLocalHtmlArchive(
  project: Project,
  options: {
    includeInteractions: boolean;
    includeAssets: boolean;
    mode?: Exclude<LocalHtmlExportMode, "device-images">;
  },
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
        const variants = await addDprImageAssets(source, ++assetIndex, assets);
        widget.props.src = variants.source;
        widget.props.srcset = variants.srcset;
      }
    }
  } else {
    for (const screen of prepared.screens) {
      for (const widget of screen.widgets) {
        if (widget.type === "image") widget.props.src = "";
      }
    }
  }

  const mode = options.mode ?? "responsive";
  zip.file("index.html", htmlPage(prepared, mode === "responsive" ? "Responsive export" : "Multi-device export"));
  if (mode === "device-variants") {
    for (const category of ["desktop", "tablet", "phone"] as const) {
      const preset = DEVICE_PRESETS.find((item) => item.category === category);
      if (!preset) continue;
      const screen = prepared.screens.find((item) =>
        findDevicePreset(item.device?.presetId ?? "")?.category === category,
      ) ?? prepared.screens.reduce((closest, item) => {
        const width = item.device?.width ?? 1440;
        const closestWidth = closest.device?.width ?? 1440;
        return Math.abs(width - preset.viewport.width) < Math.abs(closestWidth - preset.viewport.width)
          ? item
          : closest;
      }, prepared.screens[0]);
      const variant = structuredClone(prepared);
      variant.startScreenId = screen.id;
      zip.file(`index-${category === "phone" ? "mobile" : category}.html`, htmlPage(variant, `${preset.name} variant`));
    }
  }
  zip.file("runtime.js", PREVIEW_RUNTIME_SCRIPT);
  zip.file("style.css", `${PREVIEW_RUNTIME_STYLES}\n${responsiveLayoutStyles(prepared)}`);
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

export async function generateDeviceImageArchive(
  project: Project,
  options: { includeInteractions: boolean; includeAssets: boolean },
): Promise<Uint8Array> {
  const prepared = prepareHtmlProject(project, options.includeInteractions, options.includeAssets);
  if (!options.includeAssets) {
    for (const screen of prepared.screens) {
      for (const widget of screen.widgets) {
        if (widget.type === "image") widget.props.src = "";
      }
    }
  }
  const zip = new JSZip();
  const variants: Array<{ preset: typeof DEVICE_PRESETS[number]; screen: Project["screens"][number] }> = [];
  for (const category of ["desktop", "tablet", "phone"] as const) {
    const preset = DEVICE_PRESETS.find((item) => item.category === category);
    if (!preset) continue;
    const screen = prepared.screens.find((item) =>
      findDevicePreset(item.device?.presetId ?? "")?.category === category,
    ) ?? prepared.screens.reduce((closest, item) => {
      const width = item.device?.width ?? 1440;
      const closestWidth = closest.device?.width ?? 1440;
      return Math.abs(width - preset.viewport.width) < Math.abs(closestWidth - preset.viewport.width)
        ? item
        : closest;
    }, prepared.screens[0]);
    variants.push({ preset, screen });
  }
  if (variants.length === 0) throw new Error("Add at least one screen before exporting device images.");

  for (const { preset, screen } of variants) {
    const variant = structuredClone(prepared);
    variant.startScreenId = screen.id;
    const iframe = document.createElement("iframe");
    iframe.title = `${preset.name} image export renderer`;
    iframe.style.position = "fixed";
    iframe.style.left = "-10000px";
    iframe.style.top = "0";
    iframe.style.width = `${preset.viewport.width + 80}px`;
    iframe.style.height = `${preset.viewport.height + 100}px`;
    document.body.append(iframe);
    try {
      await new Promise<void>((resolve, reject) => {
        iframe.onload = () => resolve();
        iframe.onerror = () => reject(new Error(`Could not render the ${preset.name} image export.`));
        iframe.srcdoc = generatePublishedPreviewHtml(variant).replace(
          "</style>",
          `${responsiveLayoutStyles(variant)}</style>`,
        );
      });
      const frameDocument = iframe.contentDocument;
      if (!frameDocument) throw new Error(`Could not access the ${preset.name} image renderer.`);
      await Promise.all(Array.from(frameDocument.images, (image) => image.decode().catch(() => undefined)));
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const stage = frameDocument.querySelector<HTMLElement>("#stage");
      if (!stage) throw new Error(`The ${preset.name} image renderer did not create a preview stage.`);
      const dataUrl = await toPng(stage, { pixelRatio: 2, cacheBust: true });
      const binary = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
      zip.file(
        `images/${preset.category === "phone" ? "mobile" : preset.category}-2x.png`,
        Uint8Array.from(binary, (character) => character.charCodeAt(0)),
      );
    } finally {
      iframe.remove();
    }
  }

  const output = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  if (output.byteLength > MAX_LOCAL_HTML_EXPORT_BYTES) {
    throw new Error("The generated device images exceed the 100 MiB export limit.");
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
