import { createShapeWidget } from "../canvas/shapes";
import type { ShapeTool } from "../canvas/shapeTools";
import type { Widget } from "./schema";

const MAX_HTML_LENGTH = 200_000;
const MAX_CSS_LENGTH = 100_000;
const MAX_IMPORTED_WIDGETS = 200;
const SKIPPED_TAGS = new Set(["HEAD", "SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "SVG"]);
const SEMANTIC_TAGS = new Set([
  "H1", "H2", "H3", "H4", "H5", "H6", "P", "BUTTON", "A", "INPUT",
  "TEXTAREA", "SELECT", "LI", "BLOCKQUOTE", "PRE", "CODE", "IMG",
]);

type CssDeclarations = Record<string, string>;

function parseCssRules(css: string): Array<{ selector: string; declarations: CssDeclarations }> {
  const rules: Array<{ selector: string; declarations: CssDeclarations }> = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const declarations = Object.fromEntries(
      match[2].split(";").flatMap((declaration) => {
        const separator = declaration.indexOf(":");
        if (separator < 0) return [];
        return [[
          declaration.slice(0, separator).trim().toLowerCase(),
          declaration.slice(separator + 1).trim(),
        ]];
      }),
    );
    for (const selector of match[1].split(",")) {
      const normalized = selector.trim();
      if (normalized && !normalized.startsWith("@")) rules.push({ selector: normalized, declarations });
    }
  }
  return rules;
}

function declarationsFor(element: Element, rules: ReturnType<typeof parseCssRules>): CssDeclarations {
  const declarations: CssDeclarations = {};
  for (const rule of rules) {
    try {
      if (element.matches(rule.selector)) Object.assign(declarations, rule.declarations);
    } catch {
      continue;
    }
  }
  for (const property of element.getAttribute("style")?.split(";") ?? []) {
    const separator = property.indexOf(":");
    if (separator >= 0) {
      declarations[property.slice(0, separator).trim().toLowerCase()] = property.slice(separator + 1).trim();
    }
  }
  return declarations;
}

function colorToHex(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const hex = value.match(/^#([\da-f]{3}|[\da-f]{6})$/i);
  if (hex) {
    return hex[1].length === 3
      ? `#${[...hex[1]].map((digit) => `${digit}${digit}`).join("")}`.toLowerCase()
      : `#${hex[1].toLowerCase()}`;
  }
  const rgb = value.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i);
  if (!rgb) return undefined;
  const channels = rgb.slice(1).map(Number);
  if (channels.some((channel) => channel > 255)) return undefined;
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function parsePixels(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = value.match(/^(\d+(?:\.\d+)?)px$/i);
  return match ? Number(match[1]) : undefined;
}

function normalizedText(element: Element): string {
  const source = element.tagName === "IMG"
    ? element.getAttribute("alt") ?? ""
    : element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.tagName === "SELECT"
      ? element.getAttribute("aria-label") ?? element.getAttribute("placeholder") ?? element.getAttribute("value") ?? ""
      : element.textContent ?? "";
  return source.replace(/\s+/g, " ").trim().slice(0, 2_000);
}

function mapTagToTool(tagName: string): ShapeTool {
  if (/^H[1-6]$/.test(tagName)) return "heading";
  if (tagName === "BUTTON") return "button";
  if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") return "input";
  if (tagName === "A") return "link";
  if (tagName === "LI" || tagName === "BLOCKQUOTE" || tagName === "PRE" || tagName === "CODE") return "paragraph";
  return "paragraph";
}

export function importHtmlToWidgets(html: string, css: string, canvasWidth: number, firstZIndex = 0): Widget[] {
  if (html.length > MAX_HTML_LENGTH) throw new Error("HTML import is limited to 200 KB.");
  if (css.length > MAX_CSS_LENGTH) throw new Error("CSS import is limited to 100 KB.");

  const document = new DOMParser().parseFromString(html, "text/html");
  const rules = parseCssRules(css);
  const elements: Element[] = [];

  const collect = (element: Element) => {
    if (SKIPPED_TAGS.has(element.tagName) || element.hasAttribute("hidden")) return;
    if (SEMANTIC_TAGS.has(element.tagName)) {
      if (normalizedText(element)) elements.push(element);
      return;
    }
    const directText = Array.from(element.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent ?? "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (directText) elements.push(document.createElement("p"));
    if (directText) elements[elements.length - 1].textContent = directText;
    for (const child of Array.from(element.children)) collect(child);
  };
  for (const child of Array.from(document.body.children)) collect(child);
  const bodyText = Array.from(document.body.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent ?? "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (bodyText) {
    const textNode = document.createElement("p");
    textNode.textContent = bodyText;
    elements.unshift(textNode);
  }
  if (elements.length === 0) throw new Error("No supported text or controls were found in the HTML.");

  const width = Math.max(160, Math.floor(canvasWidth) - 48);
  let y = 24;
  return elements.slice(0, MAX_IMPORTED_WIDGETS).map((element, index) => {
    const tag = element.tagName;
    const text = normalizedText(element);
    const tool = mapTagToTool(tag);
    const declarations = declarationsFor(element, rules);
    const fontSize = Math.max(10, Math.min(72,
      parsePixels(declarations["font-size"]) ?? (/^H[1-6]$/.test(tag) ? 30 - Number(tag[1]) * 2 : 16),
    ));
    const height = tag === "BUTTON" || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT"
      ? 42
      : Math.max(28, Math.ceil(fontSize * 1.5));
    const measuredWidth = tag === "BUTTON"
      ? Math.min(width, Math.max(120, Math.ceil(text.length * fontSize * 0.65 + 32)))
      : width;
    const props = tool === "button"
      ? { label: text, variant: "primary", state: "default", fontSize }
      : tool === "input"
        ? {
            label: element.getAttribute("aria-label") ?? element.getAttribute("name") ?? "",
            placeholder: element.getAttribute("placeholder") ?? text,
            value: element.getAttribute("value") ?? "",
            type: element.getAttribute("type") ?? "text",
          }
        : {
            text,
            fontFamily: declarations["font-family"]?.split(",")[0]?.replace(/["']/g, "").trim() ?? "Arial",
            fontSize,
            fontWeight: declarations["font-weight"] ?? (/^H[1-6]$/.test(tag) ? "700" : "normal"),
            align: declarations["text-align"] ?? "left",
            lineHeight: 1.2,
            autoSize: true,
          };
    const widget = createShapeWidget(tool, 24, y, measuredWidth, height, props);
    widget.name = `${tag.toLowerCase()} ${text.slice(0, 72)}`.trim().slice(0, 120);
    widget.zIndex = firstZIndex + index;
    const foreground = colorToHex(declarations.color);
    const background = colorToHex(declarations["background-color"]);
    if (tool === "button") {
      if (background) widget.style.fill = background;
      if (background) widget.style.stroke = background;
    } else if (foreground) {
      widget.style.fill = foreground;
    }
    const radius = parsePixels(declarations["border-radius"]);
    if (radius !== undefined) widget.style.cornerRadius = Math.min(64, radius);
    y += height + Math.max(8, Math.min(48, parsePixels(declarations["margin-bottom"]) ?? 12));
    return widget;
  });
}
