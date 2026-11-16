import { extractImportedCode, parseImportedHtmlDocument } from "./importedCode";

export interface MeasuredBox {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Rendered line height in px of the element's own text, when it has any. */
  lineHeight?: number;
}

/** Element boxes keyed like htmlImport's source keys ("body.0", "body.1.2.text", …). */
export type MeasuredLayout = ReadonlyMap<string, MeasuredBox>;

const MEASURE_TIMEOUT_MS = 4_000;
const MAX_MEASURED_ELEMENTS = 2_000;

function boxOf(rect: DOMRect, view: Window): MeasuredBox {
  return {
    x: Math.round(rect.left + view.scrollX),
    y: Math.round(rect.top + view.scrollY),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

function directTextBox(element: Element, view: Window): MeasuredBox | undefined {
  const textNodes = Array.from(element.childNodes).filter(
    (node) => node.nodeType === 3 && node.textContent?.trim(),
  );
  if (!textNodes.length) return undefined;
  const range = element.ownerDocument.createRange();
  range.setStartBefore(textNodes[0]);
  range.setEndAfter(textNodes[textNodes.length - 1]);
  const rect = range.getBoundingClientRect();
  if (!rect.width && !rect.height) return undefined;
  const box = boxOf(rect, view);
  const lineTops = new Set(
    Array.from(range.getClientRects())
      .filter((line) => line.width > 0 && line.height > 0)
      .map((line) => Math.round(line.top)),
  );
  const declared = Number.parseFloat(view.getComputedStyle(element).lineHeight);
  const lineHeight = Number.isFinite(declared) && declared > 0
    ? declared
    : rect.height / Math.max(1, lineTops.size);
  if (Number.isFinite(lineHeight) && lineHeight > 0) box.lineHeight = lineHeight;
  return box;
}

function collectBoxes(body: HTMLElement, view: Window): Map<string, MeasuredBox> {
  const boxes = new Map<string, MeasuredBox>();
  const bodyText = directTextBox(body, view);
  if (bodyText) boxes.set("body.text", bodyText);
  const visit = (element: Element, key: string) => {
    if (boxes.size >= MAX_MEASURED_ELEMENTS) return;
    const box = boxOf(element.getBoundingClientRect(), view);
    boxes.set(key, box);
    const text = directTextBox(element, view);
    if (text) {
      boxes.set(`${key}.text`, text);
      if (text.lineHeight) box.lineHeight = text.lineHeight;
    }
    if (element.tagName.toUpperCase() === "SVG") {
      Array.from(element.querySelectorAll("path")).slice(0, 20).forEach((path, index) => {
        boxes.set(`${key}.path.${index}`, boxOf(path.getBoundingClientRect(), view));
      });
      return;
    }
    Array.from(element.children).forEach((child, index) => visit(child, `${key}.${index}`));
  };
  Array.from(body.children).forEach((child, index) => visit(child, `body.${index}`));
  return boxes;
}

function measureAtWidth(bodyHtml: string, css: string, width: number): Promise<Map<string, MeasuredBox>> {
  return new Promise((resolve) => {
    const frame = document.createElement("iframe");
    // No allow-scripts: imported JavaScript never runs here; we only need the browser's layout.
    frame.setAttribute("sandbox", "allow-same-origin");
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.style.cssText =
      `position:fixed;left:-100000px;top:0;width:${Math.round(width)}px;height:2000px;` +
      "border:0;visibility:hidden;pointer-events:none;";
    let settled = false;
    const finish = (boxes: Map<string, MeasuredBox>) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      frame.remove();
      resolve(boxes);
    };
    const timer = window.setTimeout(() => finish(new Map()), MEASURE_TIMEOUT_MS);
    frame.addEventListener("load", () => {
      const view = frame.contentWindow;
      const frameDocument = frame.contentDocument;
      if (!view || !frameDocument?.body) {
        finish(new Map());
        return;
      }
      const fontsReady = frameDocument.fonts?.ready ?? Promise.resolve();
      void fontsReady.then(() => {
        try {
          finish(collectBoxes(frameDocument.body, view));
        } catch {
          finish(new Map());
        }
      });
    });
    const safeCss = css.replace(/<\/style/gi, "<\\/style");
    frame.srcdoc =
      `<!doctype html><html><head><meta charset="utf-8"><style>${safeCss}</style></head>` +
      `<body>${bodyHtml}</body></html>`;
    document.body.append(frame);
  });
}

/**
 * Lays the imported HTML and CSS out in the real browser engine at each width and measures
 * every element, so imported widgets land exactly where the page puts them (flexbox, grid,
 * centring and media queries included). Returns an empty map where no DOM layout exists.
 */
export async function measureImportedLayout(
  html: string,
  css: string,
  widths: readonly number[],
): Promise<Map<number, MeasuredLayout>> {
  const layouts = new Map<number, MeasuredLayout>();
  if (typeof document === "undefined" || typeof window === "undefined" || !document.body) return layouts;
  const extracted = extractImportedCode(html, css);
  const bodyHtml = parseImportedHtmlDocument(extracted.html).body.innerHTML;
  for (const width of new Set(widths.filter((value) => Number.isFinite(value) && value > 0))) {
    const boxes = await measureAtWidth(bodyHtml, extracted.css, width);
    // jsdom and other layout-less environments report all-zero boxes: treat as unmeasured.
    if ([...boxes.values()].some((box) => box.width > 0 || box.height > 0)) layouts.set(width, boxes);
  }
  return layouts;
}
