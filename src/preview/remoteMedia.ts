import type { Project, Widget } from "../project/schema";

/**
 * Pictures and videos that point at a web address (B23). A shared cloud preview may only load files that are
 * inside the page itself (data: and blob:), so a web address would show as a missing picture. When a preview
 * is published the pictures are fetched and embedded where the other site allows it; whatever cannot be
 * embedded is listed so the person is told before they share.
 */
export type RemoteMediaKind = "image" | "card image" | "video" | "video poster";

export interface RemoteMediaRef {
  screenName: string;
  widgetName: string;
  kind: RemoteMediaKind;
  url: string;
}

/** Largest picture embedded into a preview. The whole page is limited to 10 MiB. */
export const MAX_EMBEDDED_IMAGE_BYTES = 4 * 1024 * 1024;

export function isRemoteUrl(value: unknown): value is string {
  return typeof value === "string" && /^(?:https?:)?\/\//i.test(value.trim());
}

/** The picture and video sources of a widget that the published page reads. */
function mediaSlots(widget: Widget): Array<{ prop: string; kind: RemoteMediaKind; embeddable: boolean }> {
  switch (widget.type) {
    case "image":
      return [{ prop: "src", kind: "image", embeddable: true }];
    case "card":
      // The published page draws imageSrc, or src when there is no imageSrc.
      return [{ prop: typeof widget.props.imageSrc === "string" && widget.props.imageSrc ? "imageSrc" : "src", kind: "card image", embeddable: true }];
    case "video":
      return [
        { prop: "src", kind: "video", embeddable: false },
        { prop: "poster", kind: "video poster", embeddable: true },
      ];
    default:
      return [];
  }
}

function widgetLabel(widget: Widget): string {
  const named = widget.props.label ?? widget.props.title ?? widget.props.alt ?? widget.props.text;
  return typeof named === "string" && named.trim() ? named.trim().slice(0, 40) : widget.type;
}

export function findRemoteMedia(project: Project): RemoteMediaRef[] {
  const found: RemoteMediaRef[] = [];
  for (const screen of project.screens) {
    for (const widget of screen.widgets) {
      for (const slot of mediaSlots(widget)) {
        const value = widget.props[slot.prop];
        if (isRemoteUrl(value)) {
          found.push({ screenName: screen.name, widgetName: widgetLabel(widget), kind: slot.kind, url: value.trim() });
        }
      }
    }
  }
  return found;
}

export type ImageFetcher = (url: string) => Promise<string | null>;

/** Downloads a picture and returns it as a data: URL, or null when the other site does not allow it. */
export async function fetchImageAsDataUrl(url: string): Promise<string | null> {
  try {
    const response = await fetch(url.startsWith("//") ? `https:${url}` : url, {
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    if (!response.ok) return null;
    const blob = await response.blob();
    if (!blob.type.startsWith("image/") || blob.size > MAX_EMBEDDED_IMAGE_BYTES) return null;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    return `data:${blob.type};base64,${btoa(binary)}`;
  } catch {
    return null;
  }
}

export interface PreparedPreview {
  /** The project to publish: the same object when nothing needed embedding. */
  project: Project;
  /** Pictures and videos that are still web addresses and will not show in the shared preview. */
  remaining: RemoteMediaRef[];
  /** How many picture sources were embedded. */
  embedded: number;
}

export async function embedRemoteImages(
  project: Project,
  fetchImage: ImageFetcher = fetchImageAsDataUrl,
): Promise<PreparedPreview> {
  if (findRemoteMedia(project).length === 0) return { project, remaining: [], embedded: 0 };

  const prepared = structuredClone(project);
  const cache = new Map<string, Promise<string | null>>();
  const download = (url: string) => {
    let pending = cache.get(url);
    if (!pending) {
      pending = fetchImage(url);
      cache.set(url, pending);
    }
    return pending;
  };

  let embedded = 0;
  const jobs: Array<Promise<void>> = [];
  for (const screen of prepared.screens) {
    for (const widget of screen.widgets) {
      for (const slot of mediaSlots(widget)) {
        const value = widget.props[slot.prop];
        if (!slot.embeddable || !isRemoteUrl(value)) continue;
        jobs.push(
          download(value.trim()).then((dataUrl) => {
            if (!dataUrl) return;
            widget.props[slot.prop] = dataUrl;
            embedded += 1;
          }),
        );
      }
    }
  }
  await Promise.all(jobs);
  return { project: prepared, remaining: findRemoteMedia(prepared), embedded };
}
