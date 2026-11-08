import { createShapeWidget } from "../canvas/shapes";
import type { ShapeTool } from "../canvas/shapeTools";
import type { Widget } from "./schema";

const MAX_HTML_LENGTH = 200_000;
const MAX_CSS_LENGTH = 100_000;
const MAX_IMPORTED_WIDGETS = 200;
const MAX_AST_NODES = 2_000;
const SKIPPED_TAGS = new Set(["HEAD", "SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "SVG"]);
const SEMANTIC_TAGS = new Set([
  "H1", "H2", "H3", "H4", "H5", "H6", "P", "BUTTON", "A", "INPUT",
  "TEXTAREA", "SELECT", "LI", "BLOCKQUOTE", "PRE", "CODE", "IMG",
]);

type CssDeclarations = Record<string, string>;

export interface ImportedHtmlNode {
  id: string;
  tagName: string;
  computedStyles: CssDeclarations;
  parentId: string | null;
  suggestedIcon: string;
  textContent: string;
}

export interface ImportedHtmlAst {
  nodes: ImportedHtmlNode[];
  requiredIcons: string[];
  truncated: boolean;
}

const TAILWIND_COLORS: Record<string, string> = {
  "gray-100": "#f3f4f6",
  "gray-200": "#e5e7eb",
  "gray-500": "#6b7280",
  "gray-700": "#374151",
  "gray-900": "#111827",
  "gray-50": "#f9fafb",
  "gray-300": "#d1d5db",
  "slate-100": "#f1f5f9",
  "slate-500": "#64748b",
  "slate-900": "#0f172a",
  "slate-50": "#f8fafc",
  "slate-300": "#cbd5e1",
  "blue-50": "#eff6ff",
  "blue-100": "#dbeafe",
  "blue-500": "#3b82f6",
  "blue-600": "#2563eb",
  "blue-700": "#1d4ed8",
  "blue-300": "#93c5fd",
  "green-100": "#dcfce7",
  "green-500": "#22c55e",
  "green-600": "#16a34a",
  "red-100": "#fee2e2",
  "red-500": "#ef4444",
  "red-600": "#dc2626",
  "yellow-100": "#fef9c3",
  "yellow-500": "#eab308",
  "purple-100": "#f3e8ff",
  "purple-500": "#a855f7",
  "purple-600": "#9333ea",
  "white": "#ffffff",
  "black": "#000000",
};

const BOOTSTRAP_COLORS: Record<string, string> = {
  primary: "#0d6efd",
  secondary: "#6c757d",
  success: "#198754",
  danger: "#dc3545",
  warning: "#ffc107",
  info: "#0dcaf0",
  light: "#f8f9fa",
  dark: "#212529",
  white: "#ffffff",
  black: "#000000",
  muted: "#6c757d",
  body: "#212529",
};

const TAILWIND_SPACING: Record<string, number> = {
  "0": 0,
  "1": 4,
  "2": 8,
  "3": 12,
  "4": 16,
  "5": 20,
  "6": 24,
  "8": 32,
  "10": 40,
  "12": 48,
};

const FONT_WEIGHTS: Record<string, string> = {
  normal: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
  black: "900",
};

const TAILWIND_FONT_SIZES: Record<string, string> = {
  xs: "12px",
  sm: "14px",
  base: "16px",
  lg: "18px",
  xl: "20px",
  "2xl": "24px",
  "3xl": "30px",
};

const BOOTSTRAP_FONT_SIZES: Record<string, string> = {
  "1": "40px",
  "2": "32px",
  "3": "28px",
  "4": "24px",
  "5": "20px",
  "6": "16px",
};

const BORDER_RADII: Record<string, string> = {
  sm: "2px",
  md: "6px",
  lg: "8px",
  xl: "12px",
  "2xl": "16px",
  "1": "4px",
  "2": "8px",
  "3": "16px",
  pill: "9999px",
  circle: "50%",
};

const COMPUTED_STYLE_PROPERTIES = [
  "color",
  "background-color",
  "font-family",
  "font-size",
  "font-weight",
  "text-align",
  "display",
  "width",
  "height",
  "min-width",
  "max-width",
  "min-height",
  "max-height",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "border-radius",
  "border-width",
  "border-style",
  "border-color",
  "line-height",
  "opacity",
  "text-decoration",
  "padding",
  "padding-left",
  "padding-right",
  "padding-top",
  "padding-bottom",
];

const LENGTH_STYLE_PROPERTIES = new Set([
  "width",
  "height",
  "min-width",
  "max-width",
  "min-height",
  "max-height",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "font-size",
  "border-radius",
  "border-width",
  "padding",
  "padding-left",
  "padding-right",
  "padding-top",
  "padding-bottom",
  "line-height",
]);

const SEMANTIC_ICONS: Record<string, string> = {
  A: "Link",
  AUDIO: "Music",
  BLOCKQUOTE: "FileText",
  BUTTON: "MousePointer2",
  CODE: "Code2",
  DETAILS: "ChevronDown",
  H1: "Type",
  H2: "Type",
  H3: "Type",
  H4: "Type",
  H5: "Type",
  H6: "Type",
  IMG: "Image",
  LABEL: "Type",
  MAIN: "Layout",
  NAV: "Compass",
  OL: "ListOrdered",
  P: "FileText",
  PRE: "Code2",
  FORM: "FileText",
  FIGURE: "Image",
  LI: "List",
  SELECT: "List",
  TABLE: "Table",
  TEXTAREA: "Type",
  UL: "List",
  VIDEO: "Video",
};

function iconForElement(element: Element): string | undefined {
  if (element.tagName === "INPUT") {
    switch (element.getAttribute("type")?.toLowerCase()) {
      case "date":
      case "datetime-local":
        return "Calendar";
      case "email":
        return "Mail";
      case "search":
        return "Search";
      case "checkbox":
        return "Check";
      default:
        return "FileText";
    }
  }
  return SEMANTIC_ICONS[element.tagName];
}

function utilityDeclarations(element: Element): CssDeclarations {
  const declarations: CssDeclarations = {};
  const spacingProperties: Record<string, string[]> = {
    p: ["padding"],
    px: ["padding-left", "padding-right"],
    py: ["padding-top", "padding-bottom"],
    pt: ["padding-top"],
    pb: ["padding-bottom"],
    pl: ["padding-left"],
    pr: ["padding-right"],
    mb: ["margin-bottom"],
  };

  for (const className of element.classList) {
    const textColor = className.match(/^text-(.+)$/)?.[1];
    if (textColor && TAILWIND_COLORS[textColor]) {
      declarations.color = TAILWIND_COLORS[textColor];
    } else if (textColor && BOOTSTRAP_COLORS[textColor]) {
      declarations.color = BOOTSTRAP_COLORS[textColor];
    } else if (textColor === "center" || textColor === "left" || textColor === "right" || textColor === "justify") {
      declarations["text-align"] = textColor;
    } else if (textColor === "start" || textColor === "end") {
      declarations["text-align"] = textColor === "start" ? "left" : "right";
    }

    const backgroundColor = className.match(/^bg-(.+)$/)?.[1];
    if (backgroundColor && TAILWIND_COLORS[backgroundColor]) {
      declarations["background-color"] = TAILWIND_COLORS[backgroundColor];
    } else if (backgroundColor && BOOTSTRAP_COLORS[backgroundColor]) {
      declarations["background-color"] = BOOTSTRAP_COLORS[backgroundColor];
    }
    const buttonColor = className.match(/^btn-(primary|secondary|success|danger|warning|info|light|dark)$/)?.[1];
    if (["BUTTON", "A", "INPUT"].includes(element.tagName) && buttonColor) {
      declarations["background-color"] = BOOTSTRAP_COLORS[buttonColor];
      declarations.color = buttonColor === "warning" || buttonColor === "light"
        ? "#212529"
        : "#ffffff";
    }

    const weight = className.match(/^(?:font-|fw-)(normal|medium|semibold|bold|black)$/)?.[1];
    if (weight) {
      declarations["font-weight"] = FONT_WEIGHTS[weight];
    }
    const tailwindSize = TAILWIND_FONT_SIZES[className.match(/^text-(xs|sm|base|lg|xl|2xl|3xl)$/)?.[1] ?? ""];
    if (tailwindSize) declarations["font-size"] = tailwindSize;
    const bootstrapSize = className.match(/^fs-([1-6])$/)?.[1];
    if (bootstrapSize) declarations["font-size"] = BOOTSTRAP_FONT_SIZES[bootstrapSize];

    const radius = className.match(/^rounded(?:-(sm|md|lg|xl|2xl|[1-3]))?$/)?.[1];
    if (className === "rounded") declarations["border-radius"] = "4px";
    else if (radius) declarations["border-radius"] = BORDER_RADII[radius];
    else if (className === "rounded-pill" || className === "rounded-full") declarations["border-radius"] = BORDER_RADII.pill;
    else if (className === "rounded-circle") declarations["border-radius"] = BORDER_RADII.circle;

    const spacing = className.match(/^(p|px|py|pt|pb|pl|pr|mb)-(\d+)$/);
    if (spacing && TAILWIND_SPACING[spacing[2]] !== undefined) {
      for (const property of spacingProperties[spacing[1]]) {
        declarations[property] = `${TAILWIND_SPACING[spacing[2]]}px`;
      }
    }
  }

  return declarations;
}

function isSafeStyleValue(property: string, value: string): boolean {
  if (property === "color" || property === "background-color" || property === "border-color") {
    return Boolean(colorToHex(value))
      || /^(?:transparent|currentcolor)$/i.test(value)
      || /^[a-z]+$/i.test(value)
      || /^rgba?\([^)]+\)$/i.test(value)
      || /^hsla?\([^)]+\)$/i.test(value);
  }
  if (property === "font-family") return /^[\w\s,"'-]+$/.test(value);
  if (property === "font-weight") return /^(?:normal|bold|bolder|lighter|[1-9]00)$/i.test(value);
  if (property === "text-align") return /^(?:left|right|center|justify|start|end)$/i.test(value);
  if (LENGTH_STYLE_PROPERTIES.has(property)) {
    return value === "0" || /^(?:auto|none|-?\d+(?:\.\d+)?(?:px|rem|em|%))$/i.test(value);
  }
  if (property === "display") return /^(?:block|inline|inline-block|flex|inline-flex|grid|inline-grid|none|table|list-item)$/i.test(value);
  if (property === "border-style") return /^(?:none|solid|dashed|dotted|double)$/i.test(value);
  if (property === "opacity") return /^(?:0|1|0?\.\d+)$/.test(value);
  if (property === "text-decoration") return /^(?:none|underline|overline|line-through)$/i.test(value);
  return false;
}

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
  const declarations: CssDeclarations = utilityDeclarations(element);
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
  return Object.fromEntries(
    Object.entries(declarations).filter(([property, value]) => isSafeStyleValue(property, value)),
  );
}

function computedStylesFor(element: Element, rules: ReturnType<typeof parseCssRules>): CssDeclarations {
  const declarations = declarationsFor(element, rules);
  if (Object.keys(declarations).length === 0) return declarations;
  if (typeof window === "undefined" || typeof window.getComputedStyle !== "function") return declarations;

  const probe = element.ownerDocument.createElement(element.tagName.toLowerCase());
  for (const [property, value] of Object.entries(declarations)) probe.style.setProperty(property, value);
  const computed = window.getComputedStyle(probe);
  return Object.fromEntries(
    COMPUTED_STYLE_PROPERTIES.flatMap((property) => {
    const value = computed.getPropertyValue(property) || declarations[property];
    return value ? [[property, value]] : [];
    }),
  );
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
  const match = value.match(/^(\d+(?:\.\d+)?)(px|rem|em)$/i);
  if (!match) return value === "0" ? 0 : undefined;
  return Number(match[1]) * (match[2].toLowerCase() === "px" ? 1 : 16);
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

export function parseHtmlToAst(html: string, css: string): ImportedHtmlAst {
  if (html.length > MAX_HTML_LENGTH) throw new Error("HTML import is limited to 200 KB.");
  if (css.length > MAX_CSS_LENGTH) throw new Error("CSS import is limited to 100 KB.");

  const document = new DOMParser().parseFromString(html, "text/html");
  const rules = parseCssRules(css);
  const nodes: ImportedHtmlNode[] = [];
  const requiredIcons = new Set<string>();
  let truncated = false;

  const collect = (element: Element, parentId: string | null) => {
    if (SKIPPED_TAGS.has(element.tagName) || element.hasAttribute("hidden")) return;
    if (nodes.length >= MAX_AST_NODES) {
      truncated = true;
      return;
    }

    const id = `node-${nodes.length + 1}`;
    const icon = iconForElement(element);
    nodes.push({
      id,
      tagName: element.tagName.toLowerCase(),
      computedStyles: computedStylesFor(element, rules),
      parentId,
      suggestedIcon: icon ?? "Layout",
      textContent: normalizedText(element),
    });
    if (icon) requiredIcons.add(icon);
    for (const child of Array.from(element.children)) collect(child, id);
  };

  for (const child of Array.from(document.body.children)) collect(child, null);
  return { nodes, requiredIcons: [...requiredIcons], truncated };
}

export function findRequiredIcons(html: string): Pick<ImportedHtmlAst, "requiredIcons" | "truncated"> {
  if (html.length > MAX_HTML_LENGTH) throw new Error("HTML import is limited to 200 KB.");

  const document = new DOMParser().parseFromString(html, "text/html");
  const requiredIcons = new Set<string>();
  let nodeCount = 0;
  let truncated = false;

  const collect = (element: Element) => {
    if (SKIPPED_TAGS.has(element.tagName) || element.hasAttribute("hidden")) return;
    if (nodeCount >= MAX_AST_NODES) {
      truncated = true;
      return;
    }
    nodeCount += 1;
    const icon = iconForElement(element);
    if (icon) requiredIcons.add(icon);
    for (const child of Array.from(element.children)) collect(child);
  };

  for (const child of Array.from(document.body.children)) collect(child);
  return { requiredIcons: [...requiredIcons], truncated };
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
    const declarations = computedStylesFor(element, rules);
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
