import { createShapeWidget } from "../canvas/shapes";
import type { ShapeTool } from "../canvas/shapeTools";
import type { Breakpoint, Widget, WidgetOverride } from "./schema";
import { extractImportedCode, parseImportedHtmlDocument } from "./importedCode";

const MAX_HTML_LENGTH = 200_000;
const MAX_CSS_LENGTH = 100_000;
const MAX_IMPORTED_WIDGETS = 200;
const MAX_AST_NODES = 2_000;
const SKIPPED_TAGS = new Set(["HEAD", "SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "SVG"]);
const SEMANTIC_TAGS = new Set([
  "H1", "H2", "H3", "H4", "H5", "H6", "P", "BUTTON", "A", "INPUT",
  "TEXTAREA", "SELECT", "LI", "BLOCKQUOTE", "PRE", "CODE", "IMG",
]);
const LAYOUT_TAGS = new Set([
  "BODY", "MAIN", "DIV", "SECTION", "ARTICLE", "HEADER", "FOOTER", "NAV",
  "FORM", "UL", "OL", "FIGURE", "ASIDE", "TABLE", "THEAD", "TBODY", "TFOOT", "TR",
]);
const INHERITED_STYLE_PROPERTIES = [
  "color",
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "text-align",
] as const;

type CssDeclarations = Record<string, string>;

export interface ImportedHtmlNode {
  id: string;
  tagName: string;
  computedStyles: CssDeclarations;
  parentId: string | null;
  suggestedIcon: string;
  textContent: string;
}

function cssLineHeightRatio(value: string | undefined, fontSize: number): number {
  if (!value) return 1.2;
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return cssLength(value, fontSize, fontSize * 1.2) / fontSize;
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
  "flex-direction",
  "gap",
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
  "justify-content",
  "align-items",
  "grid-template-columns",
  "object-fit",
  "box-shadow",
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

    if (className === "flex") declarations.display = "flex";
    if (className === "inline-flex") declarations.display = "inline-flex";
    if (className === "grid") declarations.display = "grid";
    if (className === "flex-row") declarations["flex-direction"] = "row";
    if (className === "flex-col") declarations["flex-direction"] = "column";
    const gap = className.match(/^gap-(\d+)$/)?.[1];
    if (gap && TAILWIND_SPACING[gap] !== undefined) {
      declarations.gap = `${TAILWIND_SPACING[gap]}px`;
    }
  }

  return declarations;
}

function isSafeStyleValue(property: string, value: string): boolean {
  if (
    property === "color" || property === "background-color" || property === "border-color" ||
    property === "fill" || property === "stroke"
  ) {
    if ((property === "fill" || property === "stroke") && value.toLowerCase() === "none") return true;
    return Boolean(colorToHex(value))
      || /^(?:transparent|currentcolor)$/i.test(value);
  }
  if (property === "font-family") return /^[\w\s,"'-]+$/.test(value);
  if (property === "font-weight") return /^(?:normal|bold|bolder|lighter|[1-9]00)$/i.test(value);
  if (property === "line-height") return /^(?:normal|(?:\d+(?:\.\d+)?)(?:px|rem|em|%)?)$/i.test(value);
  if (property === "text-align") return /^(?:left|right|center|justify|start|end)$/i.test(value);
  if (property === "justify-content") return /^(?:flex-start|flex-end|center|space-between|space-around|space-evenly)$/i.test(value);
  if (property === "align-items") return /^(?:stretch|flex-start|flex-end|center|baseline)$/i.test(value);
  if (property === "object-fit") return /^(?:fill|contain|cover|none|scale-down)$/i.test(value);
  if (LENGTH_STYLE_PROPERTIES.has(property)) {
    return value === "0" || /^(?:auto|none|-?\d+(?:\.\d+)?(?:px|rem|em|%))$/i.test(value);
  }
  if (property === "display") return /^(?:block|inline|inline-block|flex|inline-flex|grid|inline-grid|none|table|list-item)$/i.test(value);
  if (property === "position") return /^(?:static|relative|absolute|sticky|fixed)$/i.test(value);
  if (property === "flex-direction") return /^(?:row|row-reverse|column|column-reverse)$/i.test(value);
  if (property === "gap") return value === "0" || /^-?\d+(?:\.\d+)?(?:px|rem|em)$/i.test(value);
  if (property === "border-style") return /^(?:none|solid|dashed|dotted|double)$/i.test(value);
  if (property === "opacity") return /^(?:0|1|0?\.\d+)$/.test(value);
  if (property === "text-decoration") return /^(?:none|underline|overline|line-through)$/i.test(value);
  if (property === "grid-template-columns") {
    return /^(?:repeat\(\s*\d+\s*,\s*\d+(?:\.\d+)?fr\s*\)|[\d\s.,()%frpxrem]+)$/i.test(value);
  }
  if (property === "box-shadow") return /^[\w\s#(),.%+-]+$/.test(value) && value.length < 160;
  return property === "stroke-width" && (/^\d+(?:\.\d+)?(?:px)?$/i.test(value));
}

function splitCssTokens(value: string): string[] {
  const tokens: string[] = [];
  let token = "";
  let depth = 0;
  for (const character of value.trim()) {
    if (character === "(") depth += 1;
    if (character === ")") depth = Math.max(0, depth - 1);
    if (/\s/.test(character) && depth === 0) {
      if (token) tokens.push(token);
      token = "";
    } else {
      token += character;
    }
  }
  if (token) tokens.push(token);
  return tokens;
}

function expandCssDeclarations(declarations: CssDeclarations): CssDeclarations {
  const expanded = { ...declarations };
  for (const property of ["padding", "margin"]) {
    const values = splitCssTokens(expanded[property] ?? "");
    if (values.length < 1 || values.length > 4) continue;
    const [top, right = top, bottom = top, left = right] = values;
    expanded[`${property}-top`] ??= top;
    expanded[`${property}-right`] ??= right;
    expanded[`${property}-bottom`] ??= bottom;
    expanded[`${property}-left`] ??= left;
  }

  const border = splitCssTokens(expanded.border ?? "");
  if (border.length) {
    const width = border.find((part) => /^(?:\d+(?:\.\d+)?)(?:px|rem|em)?$/i.test(part));
    const style = border.find((part) => /^(?:none|solid|dashed|dotted|double)$/i.test(part));
    const color = border.find((part) => colorToHex(part) !== undefined);
    if (width) expanded["border-width"] ??= width;
    if (style) expanded["border-style"] ??= style;
    if (color) expanded["border-color"] ??= color;
    if (style === "none") expanded["border-width"] = "0";
  }

  const background = expanded.background;
  if (background && !expanded["background-color"]) {
    const gradientColors = background.match(/(?:#[\da-f]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\))/ig) ?? [];
    const namedColor = splitCssTokens(background).find((part) => colorToHex(part) !== undefined);
    const color = gradientColors[0] ?? namedColor;
    if (color) expanded["background-color"] = color;
  }

  return expanded;
}

function parseCssDeclarations(source: string): CssDeclarations {
  const declarations: CssDeclarations = {};
  for (const declaration of source.split(";")) {
    const separator = declaration.indexOf(":");
    if (separator < 0) continue;
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const value = declaration.slice(separator + 1).trim();
    if (property && value) declarations[property] = value;
  }
  return declarations;
}

function mediaQueryMatches(query: string, viewportWidth: number): boolean {
  const maxWidth = query.match(/\(\s*max-width\s*:\s*(\d+(?:\.\d+)?)(?:px)?\s*\)/i)?.[1];
  const minWidth = query.match(/\(\s*min-width\s*:\s*(\d+(?:\.\d+)?)(?:px)?\s*\)/i)?.[1];
  return (!maxWidth || viewportWidth <= Number(maxWidth)) &&
    (!minWidth || viewportWidth >= Number(minWidth));
}

function findClosingBrace(source: string, openIndex: number): number {
  let depth = 1;
  for (let index = openIndex + 1; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function parseCssRules(
  css: string,
  viewportWidth = 1440,
): Array<{ selector: string; declarations: CssDeclarations }> {
  const rules: Array<{ selector: string; declarations: CssDeclarations }> = [];
  const parseBlock = (source: string) => {
    let cursor = 0;
    while (cursor < source.length) {
      const openIndex = source.indexOf("{", cursor);
      if (openIndex < 0) break;
      const closeIndex = findClosingBrace(source, openIndex);
      if (closeIndex < 0) break;
      const selector = source.slice(cursor, openIndex).replace(/\/\*[\s\S]*?\*\//g, "").trim();
      const contents = source.slice(openIndex + 1, closeIndex);
      if (/^@media\b/i.test(selector)) {
        if (mediaQueryMatches(selector.slice(6), viewportWidth)) parseBlock(contents);
      } else if (selector && !selector.startsWith("@")) {
        const declarations = parseCssDeclarations(contents);
        for (const item of selector.split(",")) {
          const normalized = item.trim();
          if (normalized) rules.push({ selector: normalized, declarations });
        }
      }
      cursor = closeIndex + 1;
    }
  };
  parseBlock(css.replace(/\/\*[\s\S]*?\*\//g, ""));
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
  Object.assign(declarations, parseCssDeclarations(element.getAttribute("style") ?? ""));
  const expanded = expandCssDeclarations(declarations);
  return Object.fromEntries(
    Object.entries(expanded).filter(([property, value]) => isSafeStyleValue(property, value)),
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
  if (rgb) {
    const channels = rgb.slice(1).map(Number);
    if (channels.some((channel) => channel > 255)) return undefined;
    return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
  }
  if (
    !/^(?:transparent|currentcolor)$/i.test(value) &&
    typeof window !== "undefined" &&
    typeof window.getComputedStyle === "function" &&
    typeof document !== "undefined"
  ) {
    const probe = document.createElement("span");
    probe.style.color = value;
    const resolved = probe.style.color ? window.getComputedStyle(probe).color : "";
    if (resolved && resolved.toLowerCase() !== value.toLowerCase()) {
      return colorToHex(resolved);
    }
  }
  return undefined;
}

function normalizedText(element: Element): string {
  const tag = element.tagName.toUpperCase();
  const source = tag === "IMG"
    ? element.getAttribute("alt") ?? ""
    : tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT"
      ? element.getAttribute("aria-label") ?? element.getAttribute("placeholder") ?? element.getAttribute("value") ?? ""
      : element.textContent ?? "";
  return source.replace(/\s+/g, " ").trim().slice(0, 2_000);
}

function mapTagToTool(tagName: string): ShapeTool {
  tagName = tagName.toUpperCase();
  if (/^H[1-6]$/.test(tagName)) return "heading";
  if (tagName === "BUTTON") return "button";
  if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") return "input";
  if (tagName === "A") return "link";
  if (tagName === "IMG") return "image";
  if (tagName === "PATH") return "path";
  if (tagName === "VIDEO") return "video";
  if (tagName === "TABLE") return "rectangle";
  if (LAYOUT_TAGS.has(tagName)) return "rectangle";
  if (tagName === "LI" || tagName === "BLOCKQUOTE" || tagName === "PRE" || tagName === "CODE") return "paragraph";
  return "paragraph";
}

interface HtmlLayoutBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

function cssLength(value: string | undefined, basis: number, fallback: number): number {
  if (!value) return fallback;
  const match = value.match(/^(-?\d+(?:\.\d+)?)(px|rem|em|%)?$/i);
  if (!match) return fallback;
  const amount = Number(match[1]);
  const unit = match[2]?.toLowerCase();
  const result = unit === "%"
    ? basis * amount / 100
    : unit === "rem" || unit === "em"
      ? amount * 16
      : amount;
  return Number.isFinite(result) ? Math.max(0, Math.min(16_384, result)) : fallback;
}

function safeImageSource(element: Element): { src: string; mime: string } {
  const source = element.getAttribute("src")?.trim() ?? "";
  const match = source.match(/^data:(image\/(?:png|jpeg|gif|webp));base64,([a-z\d+/=]+)$/i);
  if (match && source.length <= 200_000) {
    return { src: source, mime: match[1].toLowerCase() };
  }
  try {
    const url = new URL(source);
    if (url.protocol === "https:" && !url.username && !url.password) {
      return { src: url.href, mime: "" };
    }
  } catch {
    return { src: "", mime: "" };
  }
  return { src: "", mime: "" };
}

function svgPathData(element: Element): string | undefined {
  const data = element.getAttribute("d")?.trim() ?? "";
  if (!data || data.length > 20_000 || !/^[MmZzLlHhVvCcSsQqTtAa0-9eE+.,\-\s]+$/.test(data)) return undefined;
  return data;
}

function getElementText(element: Element): string {
  if (["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName.toUpperCase())) {
    return normalizedText(element);
  }
  return Array.from(element.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent ?? "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2_000);
}

function getDirectText(element: Element): string {
  return Array.from(element.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent ?? "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2_000);
}

function setWidgetStyles(widget: Widget, styles: CssDeclarations, isContainer: boolean): void {
  const foreground = colorToHex(styles.color);
  const background = colorToHex(styles["background-color"]);
  const borderColor = colorToHex(styles["border-color"]);
  const borderWidth = cssLength(styles["border-width"], 0, 0);

  if (isContainer || widget.type === "button" || widget.type === "input") {
    widget.style.fill = background ?? null;
    widget.style.stroke = borderWidth > 0 ? borderColor ?? foreground ?? "#000000" : null;
    widget.style.strokeWidth = borderWidth;
  } else if (widget.type !== "image" && widget.type !== "path" && foreground) {
    widget.style.fill = foreground;
  }

  if (widget.type === "path") {
    widget.style.fill = styles.fill === "none" ? null : colorToHex(styles.fill) ?? "#000000";
    widget.style.stroke = colorToHex(styles.stroke) ?? null;
    widget.style.strokeWidth = cssLength(styles["stroke-width"], 0, 1);
  }

  const radius = cssLength(styles["border-radius"], 0, 0);
  if (radius) widget.style.cornerRadius = Math.min(64, radius);
  const shadow = styles["box-shadow"];
  if (shadow && shadow !== "none") {
    const tokens = splitCssTokens(shadow);
    const lengths = tokens.filter((token) => /^(?:-?\d+(?:\.\d+)?)(?:px|rem|em)?$/i.test(token))
      .slice(0, 3)
      .map((token) => cssLength(token, 0, 0));
    const color = tokens.find((token) => colorToHex(token));
    if (color && lengths.length >= 2) {
      widget.style.shadow = {
        color: colorToHex(color),
        offsetX: lengths[0],
        offsetY: lengths[1],
        blur: lengths[2] ?? 0,
        opacity: 0.22,
      };
    }
  }
  const opacity = Number(styles.opacity);
  if (Number.isFinite(opacity)) widget.opacity = Math.max(0, Math.min(1, opacity));
}

function createHtmlWidget(
  element: Element,
  styles: CssDeclarations,
  box: HtmlLayoutBox,
  zIndex: number,
  parentId: string | null,
  pathViewBox?: { x: number; y: number; width: number; height: number },
): Widget | undefined {
  const tag = element.tagName.toUpperCase();
  const tool = mapTagToTool(tag);
  if (tag === "SVG") return undefined;
  if (tag === "PATH" && !svgPathData(element)) return undefined;

  const isContainer = LAYOUT_TAGS.has(tag);
  const text = isContainer ? "" : normalizedText(element);
  const fontSize = Math.max(8, Math.min(96, cssLength(
    styles["font-size"],
    box.width,
    /^H[1-6]$/.test(tag) ? 30 - Number(tag[1]) * 2 : 16,
  )));
  const fontFamily = styles["font-family"]?.split(",")[0]?.replace(/["']/g, "").trim() ?? "Arial";
  let props: Record<string, unknown>;

  if (tool === "button") {
    props = {
      label: text,
      variant: "primary",
      state: "default",
      fontSize,
      fontFamily,
      textColor: colorToHex(styles.color),
    };
  } else if (tool === "input") {
    props = {
      label: element.getAttribute("aria-label") ?? element.getAttribute("name") ?? "",
      placeholder: element.getAttribute("placeholder") ?? text,
      value: element.getAttribute("value") ?? "",
      type: element.getAttribute("type") ?? "text",
      fontSize,
      fontFamily,
      textColor: colorToHex(styles.color),
    };
  } else if (tool === "image") {
    props = { ...safeImageSource(element), fileName: "", alt: element.getAttribute("alt") ?? "" };
  } else if (tool === "path") {
    props = {
      label: "SVG path",
      pathData: svgPathData(element) ?? "",
      pathViewBoxX: pathViewBox?.x ?? 0,
      pathViewBoxY: pathViewBox?.y ?? 0,
      pathViewBoxWidth: pathViewBox?.width ?? box.width,
      pathViewBoxHeight: pathViewBox?.height ?? box.height,
    };
  } else if (isContainer) {
    props = { label: tag.toLowerCase(), layout: "freeform", gap: 0, padding: 0 };
  } else {
    props = {
      text,
      fontFamily,
      fontSize,
      fontWeight: styles["font-weight"] ?? (/^H[1-6]$/.test(tag) ? "700" : "normal"),
      align: styles["text-align"] ?? "left",
      lineHeight: cssLineHeightRatio(styles["line-height"], fontSize),
      autoSize: true,
    };
  }

  const widget = createShapeWidget(tool, box.x, box.y, box.width, box.height, props);
  const classLabel = Array.from(element.classList).slice(0, 2).join(" ");
  widget.name = `${tag.toLowerCase()} ${text || classLabel}`.trim().slice(0, 120) || tag.toLowerCase();
  widget.zIndex = zIndex;
  if (parentId) widget.groupId = parentId;
  setWidgetStyles(widget, styles, isContainer);
  return widget;
}

function renderElementTree(
  element: Element,
  x: number,
  y: number,
  availableWidth: number,
  inheritedStyles: CssDeclarations,
  parentId: string | null,
  depth: number,
  rules: ReturnType<typeof parseCssRules>,
  state: { widgets: Widget[]; sourceKeys: string[]; nextZIndex: number },
  allocatedWidth?: number,
  sourceKey = "root",
): number {
  const tag = element.tagName.toUpperCase();
  if (
    state.widgets.length >= MAX_IMPORTED_WIDGETS ||
    depth > 32 ||
    (SKIPPED_TAGS.has(tag) && tag !== "SVG") ||
    element.hasAttribute("hidden")
  ) return y;

  const declarations = declarationsFor(element, rules);
  const styles = {
    ...Object.fromEntries(
      INHERITED_STYLE_PROPERTIES.flatMap((property) =>
        inheritedStyles[property] ? [[property, inheritedStyles[property]]] : [],
      ),
    ),
    ...declarations,
  };
  if (styles.display === "none") return y;

  if (tag === "SVG") {
    const viewBox = element.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number) ?? [];
    const validViewBox = viewBox.length === 4 && viewBox.every(Number.isFinite) &&
      viewBox[2] > 0 && viewBox[3] > 0;
    const viewBoxX = validViewBox ? viewBox[0] : 0;
    const viewBoxY = validViewBox ? viewBox[1] : 0;
    const viewBoxWidth = validViewBox
      ? viewBox[2]
      : 100;
    const viewBoxHeight = validViewBox
      ? viewBox[3]
      : 100;
    const svgWidth = cssLength(
      declarations.width ?? element.getAttribute("width") ?? undefined,
      availableWidth,
      Math.min(48, availableWidth),
    );
    const svgHeight = cssLength(
      declarations.height ?? element.getAttribute("height") ?? undefined,
      viewBoxWidth,
      svgWidth * viewBoxHeight / viewBoxWidth,
    );
    for (const [pathIndex, path] of Array.from(element.querySelectorAll("path")).slice(0, 20).entries()) {
      if (state.widgets.length >= MAX_IMPORTED_WIDGETS) break;
      const pathStyles = declarationsFor(path, rules);
      const pathWidget = createHtmlWidget(
        path,
        {
          ...styles,
          ...pathStyles,
          fill: path.getAttribute("fill") ?? pathStyles.fill ?? styles.fill,
          stroke: path.getAttribute("stroke") ?? pathStyles.stroke ?? styles.stroke,
          "stroke-width": path.getAttribute("stroke-width") ??
            pathStyles["stroke-width"] ?? styles["stroke-width"],
        },
        { x, y, width: svgWidth, height: svgHeight },
        state.nextZIndex++,
        parentId,
        { x: viewBoxX, y: viewBoxY, width: viewBoxWidth, height: viewBoxHeight },
      );
      if (pathWidget) {
        state.widgets.push(pathWidget);
        state.sourceKeys.push(`${sourceKey}.path.${pathIndex}`);
      }
    }
    return y + svgHeight;
  }

  const isContainer = LAYOUT_TAGS.has(tag);
  const marginTop = cssLength(styles["margin-top"], availableWidth, 0);
  const marginBottom = cssLength(styles["margin-bottom"], availableWidth, 8);
  const marginLeft = cssLength(styles["margin-left"], availableWidth, 0);
  const marginRight = cssLength(styles["margin-right"], availableWidth, 0);
  const text = getElementText(element);
  const fontSize = cssLength(
    styles["font-size"],
    availableWidth,
    /^H[1-6]$/.test(tag) ? 30 - Number(tag[1]) * 2 : 16,
  );
  const widthValue = styles.width ??
    (tag === "IMG" || tag === "VIDEO" ? element.getAttribute("width") ?? undefined : undefined);
  const heightValue = styles.height ??
    (tag === "IMG" || tag === "VIDEO" ? element.getAttribute("height") ?? undefined : undefined);
  const maxWidth = cssLength(styles["max-width"], availableWidth, availableWidth);
  const minWidth = cssLength(styles["min-width"], availableWidth, 0);
  const naturalWidth = allocatedWidth ?? cssLength(
    widthValue,
    availableWidth,
    tag === "BUTTON"
      ? Math.max(88, Math.ceil(text.length * fontSize * 0.62 + 28))
      : tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA"
        ? Math.min(240, availableWidth)
        : tag === "IMG" || tag === "VIDEO"
          ? Math.min(tag === "VIDEO" ? 320 : 200, availableWidth)
          : availableWidth - marginLeft - marginRight,
  );
  const width = Math.max(1, Math.min(
    availableWidth,
    Math.max(minWidth, Math.min(maxWidth, naturalWidth)),
  ));
  const left = x + marginLeft;
  const top = y + marginTop;
  const padding = cssLength(styles.padding, width, 0);
  const paddingLeft = cssLength(styles["padding-left"], width, padding);
  const paddingRight = cssLength(styles["padding-right"], width, padding);
  const paddingTop = cssLength(styles["padding-top"], width, padding);
  const paddingBottom = cssLength(styles["padding-bottom"], width, padding);
  const lineHeightRatio = cssLineHeightRatio(styles["line-height"], fontSize);
  const lineHeight = fontSize * lineHeightRatio;
  const explicitHeight = heightValue !== undefined;
  const minHeight = cssLength(styles["min-height"], width, 0);
  const maxHeight = cssLength(styles["max-height"], width, 16_384);
  const desiredHeight = explicitHeight
    ? Math.max(minHeight, Math.min(maxHeight, cssLength(heightValue, width, 1)))
    : isContainer
      ? minHeight || 1
      : tag === "IMG" || tag === "VIDEO"
        ? Math.max(minHeight, Math.min(maxHeight, tag === "VIDEO" ? 180 : 120))
        : ["BUTTON", "INPUT", "TEXTAREA", "SELECT"].includes(tag)
        ? Math.max(minHeight, Math.min(maxHeight, 40))
        : Math.max(minHeight, Math.min(
          maxHeight,
          Math.max(1, Math.ceil(Math.max(1, text.length) * fontSize * 0.55 / Math.max(1, width - paddingLeft - paddingRight))) * lineHeight + paddingTop + paddingBottom,
        ));

  const directText = getDirectText(element);
  const hasDirectText = Boolean(getElementText(element));
  const willRender = isContainer || SEMANTIC_TAGS.has(tag) || tag === "TABLE" || tag === "VIDEO" ||
    tag === "PATH" || hasDirectText;
  const widgetHeight = explicitHeight
    ? desiredHeight
    : isContainer
      ? 32
      : desiredHeight;
  const box = {
    x: left,
    y: top,
    width,
    height: Math.max(1, Math.min(16_384, widgetHeight)),
  };
  const widget = willRender && tag !== "BODY" && state.widgets.length < MAX_IMPORTED_WIDGETS
    ? createHtmlWidget(element, styles, box, state.nextZIndex++, parentId)
    : undefined;
  if (widget) {
    state.widgets.push(widget);
    state.sourceKeys.push(sourceKey);
  }
  const ownId = widget?.id ?? parentId;
  const childStartX = left + paddingLeft;
  const childStartY = top + paddingTop;
  const childWidth = Math.max(1, width - paddingLeft - paddingRight);
  const children = (isContainer || tag === "TABLE" || tag === "SVG")
    ? Array.from(element.children)
      .filter((child) => (
        !SKIPPED_TAGS.has(child.tagName.toUpperCase()) ||
        child.tagName.toUpperCase() === "SVG"
      ) && !child.hasAttribute("hidden"))
    : [];
  let childBottom = childStartY;
  const display = styles.display;
  const flexRow = (display === "flex" || display === "inline-flex") && styles["flex-direction"] !== "column";
  const gap = cssLength(styles.gap, childWidth, 0);
  const gridColumns = styles["grid-template-columns"]?.match(/^repeat\(\s*(\d+)\s*,/i)?.[1];
  const gridColumnCount = display === "grid"
    ? Math.max(1, Math.min(12, Number(gridColumns) || splitCssTokens(styles["grid-template-columns"] ?? "").length || 1))
    : 1;

  if (isContainer && directText && state.widgets.length < MAX_IMPORTED_WIDGETS) {
    const textElement = element.ownerDocument.createElement("p");
    textElement.textContent = directText;
    const textHeight = Math.max(1, Math.ceil(directText.length * fontSize * 0.55 / childWidth)) * lineHeight;
    const textWidget = createHtmlWidget(
      textElement,
      styles,
      { x: childStartX, y: childStartY, width: childWidth, height: textHeight },
      state.nextZIndex++,
      ownId,
    );
    if (textWidget) {
      state.widgets.push(textWidget);
      state.sourceKeys.push(`${sourceKey}.text`);
    }
    childBottom = childStartY + textHeight + gap;
  }

  const columnCount = flexRow ? Math.max(1, children.length) : gridColumnCount;
  const rowChildWidth = columnCount > 1
    ? Math.max(1, (childWidth - gap * (columnCount - 1)) / columnCount)
    : childWidth;
  if (flexRow && children.length) {
    const flexBaseWidths = children.map((child) => {
      const childStyles = declarationsFor(child, rules);
      if (childStyles.width) return cssLength(childStyles.width, childWidth, childWidth);
      if (childStyles["max-width"]) return cssLength(childStyles["max-width"], childWidth, childWidth);
      return 0;
    });
    const fixedWidth = flexBaseWidths.reduce((sum, item) => sum + item, 0);
    const autoCount = flexBaseWidths.filter((item) => item === 0).length;
    const freeWidth = Math.max(0, childWidth - gap * (children.length - 1) - fixedWidth);
    const autoWidth = autoCount ? freeWidth / autoCount : 0;
    const totalWidth = fixedWidth + autoWidth * autoCount;
    const shrink = totalWidth + gap * (children.length - 1) > childWidth
      ? Math.max(0, childWidth - gap * (children.length - 1)) / Math.max(1, totalWidth)
      : 1;
    const widths = flexBaseWidths.map((item) => (item || autoWidth) * shrink);
    const justifyGap = styles["justify-content"] === "space-between" && children.length > 1 && gap === 0
      ? Math.max(0, (childWidth - widths.reduce((sum, item) => sum + item, 0)) / (children.length - 1))
      : gap;
    let cursorX = childStartX;
    const rowChildren: Array<{ startIndex: number; endIndex: number; nextY: number }> = [];
    for (const [index, child] of children.entries()) {
      const startIndex = state.widgets.length;
      const nextY = renderElementTree(
        child,
        cursorX,
        childStartY,
        widths[index],
        styles,
        ownId,
        depth + 1,
        rules,
        state,
        widths[index],
        `${sourceKey}.${index}`,
      );
      rowChildren.push({ startIndex, endIndex: state.widgets.length, nextY });
      cursorX += widths[index] + justifyGap;
      childBottom = Math.max(childBottom, nextY);
    }
    if (styles["align-items"] === "center" || styles["align-items"] === "flex-end") {
      const rowBottom = Math.max(...rowChildren.map(({ nextY }) => nextY));
      for (const childLayout of rowChildren) {
        const remaining = rowBottom - childLayout.nextY;
        const shift = styles["align-items"] === "center" ? remaining / 2 : remaining;
        for (const widget of state.widgets.slice(childLayout.startIndex, childLayout.endIndex)) {
          widget.y += shift;
        }
      }
    }
  } else if (columnCount > 1) {
    let rowTop = childStartY;
    for (let offset = 0; offset < children.length; offset += columnCount) {
      if (state.widgets.length >= MAX_IMPORTED_WIDGETS) break;
      const rowChildren = children.slice(offset, offset + columnCount);
      let rowBottom = rowTop;
      for (const [column, child] of rowChildren.entries()) {
        const nextY = renderElementTree(
          child,
          childStartX + column * (rowChildWidth + gap),
          rowTop,
          rowChildWidth,
          styles,
          ownId,
          depth + 1,
          rules,
          state,
          undefined,
          `${sourceKey}.${offset + column}`,
        );
        rowBottom = Math.max(rowBottom, nextY);
      }
      rowTop = rowBottom + gap;
    }
    childBottom = Math.max(childBottom, rowTop);
  } else {
    for (const child of children) {
      if (state.widgets.length >= MAX_IMPORTED_WIDGETS) break;
      const nextY = renderElementTree(
        child,
        childStartX,
        childBottom,
        rowChildWidth,
        styles,
        ownId,
        depth + 1,
        rules,
        state,
        undefined,
        `${sourceKey}.${children.indexOf(child)}`,
      );
      childBottom = nextY + gap;
    }
  }

  const measuredHeight = explicitHeight
    ? desiredHeight
    : isContainer
      ? Math.max(minHeight, 32, childBottom - top + paddingBottom - (children.length ? gap : 0))
      : desiredHeight;
  if (widget) widget.height = Math.max(1, Math.min(16_384, measuredHeight));
  return top + measuredHeight + marginBottom;
}

export function parseHtmlToAst(html: string, css: string): ImportedHtmlAst {
  if (html.length > MAX_HTML_LENGTH) throw new Error("HTML import is limited to 200 KB.");
  if (css.length > MAX_CSS_LENGTH) throw new Error("CSS import is limited to 100 KB.");

  const extracted = extractImportedCode(html, css);
  if (extracted.css.length > MAX_CSS_LENGTH) throw new Error("CSS import is limited to 100 KB.");
  const { body } = parseImportedHtmlDocument(extracted.html);
  const rules = parseCssRules(extracted.css);
  const nodes: ImportedHtmlNode[] = [];
  const requiredIcons = new Set<string>();
  let truncated = false;

  const collect = (element: Element, parentId: string | null) => {
    if (SKIPPED_TAGS.has(element.tagName.toUpperCase()) || element.hasAttribute("hidden")) return;
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

  for (const child of Array.from(body.children)) collect(child, null);
  return { nodes, requiredIcons: [...requiredIcons], truncated };
}

export function findRequiredIcons(html: string): Pick<ImportedHtmlAst, "requiredIcons" | "truncated"> {
  if (html.length > MAX_HTML_LENGTH) throw new Error("HTML import is limited to 200 KB.");

  const { body } = parseImportedHtmlDocument(html);
  const requiredIcons = new Set<string>();
  let nodeCount = 0;
  let truncated = false;

  const collect = (element: Element) => {
    if (SKIPPED_TAGS.has(element.tagName.toUpperCase()) || element.hasAttribute("hidden")) return;
    if (nodeCount >= MAX_AST_NODES) {
      truncated = true;
      return;
    }
    nodeCount += 1;
    const icon = iconForElement(element);
    if (icon) requiredIcons.add(icon);
    for (const child of Array.from(element.children)) collect(child);
  };

  for (const child of Array.from(body.children)) collect(child);
  return { requiredIcons: [...requiredIcons], truncated };
}

export function importHtmlToWidgets(
  html: string,
  css: string,
  canvasWidth: number,
  firstZIndex = 0,
  responsiveBreakpoints: readonly Pick<Breakpoint, "id" | "width">[] = [],
): Widget[] {
  if (html.length > MAX_HTML_LENGTH) throw new Error("HTML import is limited to 200 KB.");
  if (css.length > MAX_CSS_LENGTH) throw new Error("CSS import is limited to 100 KB.");

  const extracted = extractImportedCode(html, css);
  if (extracted.css.length > MAX_CSS_LENGTH) throw new Error("CSS import is limited to 100 KB.");
  const renderAtWidth = (width: number) => {
    const { document, body } = parseImportedHtmlDocument(extracted.html);
    const rules = parseCssRules(extracted.css, width);
    const bodyStyles = declarationsFor(body, rules);
    const bodyPadding = cssLength(bodyStyles.padding, width, 0);
    const rootX = 24 + cssLength(bodyStyles["padding-left"], width, bodyPadding);
    const rootY = 24 + cssLength(bodyStyles["padding-top"], width, bodyPadding);
    const rootWidth = Math.max(
      160,
      Math.floor(width) - 48 -
        cssLength(bodyStyles["padding-left"], width, bodyPadding) -
        cssLength(bodyStyles["padding-right"], width, bodyPadding),
    );
    const state = {
      widgets: [] as Widget[],
      sourceKeys: [] as string[],
      nextZIndex: firstZIndex,
    };
    let cursorY = rootY;

    const bodyText = getDirectText(body);
    if (bodyText && state.widgets.length < MAX_IMPORTED_WIDGETS) {
      const textElement = document.createElement("p");
      textElement.textContent = bodyText;
      cursorY = renderElementTree(
        textElement,
        rootX,
        cursorY,
        rootWidth,
        bodyStyles,
        null,
        0,
        rules,
        state,
        undefined,
        "body.text",
      );
    }
    for (const [index, child] of Array.from(body.children).entries()) {
      if (state.widgets.length >= MAX_IMPORTED_WIDGETS) break;
      cursorY = renderElementTree(
        child,
        rootX,
        cursorY,
        rootWidth,
        bodyStyles,
        null,
        0,
        rules,
        state,
        undefined,
        `body.${index}`,
      );
    }
    return state;
  };

  const base = renderAtWidth(canvasWidth);
  if (base.widgets.length === 0) {
    throw new Error("No supported text or controls were found in the HTML.");
  }

  const baseIndex = new Map(base.sourceKeys.map((key, index) => [key, index]));
  const variants = new Map<string, { widgets: Widget[]; sourceKeys: string[] }>();
  for (const breakpoint of responsiveBreakpoints) {
    if (!breakpoint.id || !Number.isFinite(breakpoint.width) || breakpoint.width <= 0) continue;
    variants.set(breakpoint.id, renderAtWidth(breakpoint.width));
  }

  for (const variant of variants.values()) {
    const variantIdToSourceKey = new Map(
      variant.widgets.map((widget, index) => [widget.id, variant.sourceKeys[index]]),
    );
    for (const [index, sourceKey] of variant.sourceKeys.entries()) {
      if (baseIndex.has(sourceKey)) continue;
      const variantWidget = variant.widgets[index];
      const parentSourceKey = variantWidget.groupId
        ? variantIdToSourceKey.get(variantWidget.groupId)
        : undefined;
      const parentIndex = parentSourceKey ? baseIndex.get(parentSourceKey) : undefined;
      const widget: Widget = {
        ...variantWidget,
        id: crypto.randomUUID(),
        zIndex: firstZIndex + base.widgets.length,
        visible: false,
        groupId: parentIndex === undefined ? undefined : base.widgets[parentIndex].id,
        overrides: undefined,
      };
      baseIndex.set(sourceKey, base.widgets.length);
      base.widgets.push(widget);
      base.sourceKeys.push(sourceKey);
    }
  }

  for (const [breakpointId, variant] of variants) {
    const variantIndex = new Map(variant.sourceKeys.map((key, index) => [key, index]));
    for (const [sourceKey, widgetIndex] of baseIndex) {
      const widget = base.widgets[widgetIndex];
      const variantWidgetIndex = variantIndex.get(sourceKey);
      if (variantWidgetIndex === undefined) {
        widget.overrides = {
          ...widget.overrides,
          [breakpointId]: { visible: false },
        };
        continue;
      }
      const variantWidget = variant.widgets[variantWidgetIndex];
      const override: WidgetOverride = {};
      for (const property of ["x", "y", "width", "height", "rotation", "opacity"] as const) {
        if (widget[property] !== variantWidget[property]) override[property] = variantWidget[property];
      }
      if (JSON.stringify(widget.style) !== JSON.stringify(variantWidget.style)) {
        override.style = variantWidget.style;
      }
      if (JSON.stringify(widget.props) !== JSON.stringify(variantWidget.props)) {
        override.props = variantWidget.props;
      }
      if (widget.visible !== variantWidget.visible) override.visible = variantWidget.visible;
      if (Object.keys(override).length) {
        widget.overrides = { ...widget.overrides, [breakpointId]: override };
      }
    }
  }
  return base.widgets;
}
