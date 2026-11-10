import { parseImportedHtmlDocument } from "./importedCode";

export interface ImportedNodeGeometry {
  nodeId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

const SKIPPED_TAGS = new Set(["HEAD", "SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "SVG"]);
const MAX_NODES = 2_000;

export function updateImportedHtmlGeometry(
  html: string,
  updates: readonly ImportedNodeGeometry[],
): string {
  if (updates.length === 0) return html;
  const { document, body } = parseImportedHtmlDocument(html);
  const geometryByNodeId = new Map(updates.map((item) => [item.nodeId, item]));
  let nodeIndex = 0;
  const apply = (element: Element) => {
    if (
      nodeIndex >= MAX_NODES ||
      SKIPPED_TAGS.has(element.tagName) ||
      element.hasAttribute("hidden")
    ) return;
    const nodeId = `node-${++nodeIndex}`;
    const geometry = geometryByNodeId.get(nodeId);
    if (geometry && element instanceof HTMLElement) {
      element.style.setProperty("position", "absolute", "important");
      element.style.setProperty("left", `${Math.round(geometry.x)}px`, "important");
      element.style.setProperty("top", `${Math.round(geometry.y)}px`, "important");
      element.style.setProperty("width", `${Math.round(geometry.width)}px`, "important");
      element.style.setProperty("height", `${Math.round(geometry.height)}px`, "important");
    }
    for (const child of Array.from(element.children)) apply(child);
  };
  for (const child of Array.from(body.children)) apply(child);

  if (/<html(?:\s|>)/i.test(html) || /<!doctype\b/i.test(html)) {
    const doctype = document.doctype ? `<!doctype ${document.doctype.name}>` : "";
    return `${doctype}${document.documentElement.outerHTML}`;
  }
  return body.innerHTML;
}
