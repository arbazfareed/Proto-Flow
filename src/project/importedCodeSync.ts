import { parseImportedHtmlDocument } from "./importedCode";
import { resolveActiveBreakpoint, resolveWidgetsForBreakpoint } from "./responsive";
import type { Screen } from "./schema";

export interface ImportedNodeGeometry {
  nodeId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

const SKIPPED_TAGS = new Set(["HEAD", "SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "SVG"]);
const MAX_NODES = 2_000;

export function getImportedHtmlGeometryUpdates(
  previousScreen: Screen,
  screen: Screen,
  importedCodeId: string,
  breakpointId: string | null,
): ImportedNodeGeometry[] {
  const breakpoint = resolveActiveBreakpoint(screen, breakpointId);
  const previousBreakpoint = resolveActiveBreakpoint(previousScreen, breakpointId);
  const baseWidth = screen.device?.width ?? 1440;
  const baseHeight = screen.device?.height ?? 900;
  const currentWidgets = resolveWidgetsForBreakpoint(
    screen.widgets,
    breakpoint,
    baseWidth,
    baseHeight,
    screen.compactLayout,
  );
  const previousWidgets = resolveWidgetsForBreakpoint(
    previousScreen.widgets,
    previousBreakpoint,
    previousScreen.device?.width ?? 1440,
    previousScreen.device?.height ?? 900,
    previousScreen.compactLayout,
  );
  const previousWidgetsById = new Map(previousWidgets.map((widget) => [widget.id, widget]));

  return currentWidgets.flatMap((widget) => {
    if (
      widget.props.importedCodeId !== importedCodeId ||
      typeof widget.props.importedNodeId !== "string"
    ) return [];
    const oldWidget = previousWidgetsById.get(widget.id);
    if (!oldWidget || (
      oldWidget.x === widget.x &&
      oldWidget.y === widget.y &&
      oldWidget.width === widget.width &&
      oldWidget.height === widget.height
    )) return [];
    return [{
      nodeId: widget.props.importedNodeId,
      x: widget.x,
      y: widget.y,
      width: widget.width,
      height: widget.height,
    }];
  });
}

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
