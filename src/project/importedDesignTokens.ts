import { parseStyleColor } from "../canvas/styleInspector";

export type ImportedColorUsage = "background" | "text" | "border";

export interface ImportedColorToken {
  color: string;
  opacity: number;
  usages: ImportedColorUsage[];
}

export interface ImportedTextStyleToken {
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  count: number;
}

export interface ImportedDesignTokens {
  colors: ImportedColorToken[];
  textStyles: ImportedTextStyleToken[];
}

export const EMPTY_IMPORTED_DESIGN_TOKENS: ImportedDesignTokens = {
  colors: [],
  textStyles: [],
};

const TOKEN_USAGES = new Set<ImportedColorUsage>(["background", "text", "border"]);

export function parseImportedDesignTokenMessage(
  value: unknown,
  expectedNonce: string,
): ImportedDesignTokens | null {
  if (typeof value !== "object" || value === null) return null;
  const message = value as Record<string, unknown>;
  if (
    message.type !== "protoflow-design-tokens" ||
    message.nonce !== expectedNonce ||
    !Array.isArray(message.colors) ||
    !Array.isArray(message.textStyles)
  ) return null;

  const colorMap = new Map<string, ImportedColorToken>();
  for (const candidate of message.colors.slice(0, 200)) {
    if (typeof candidate !== "object" || candidate === null) continue;
    const colorCandidate = candidate as Record<string, unknown>;
    if (
      typeof colorCandidate.color !== "string" ||
      colorCandidate.color.length > 80 ||
      !Array.isArray(colorCandidate.usages)
    ) continue;
    const parsedColor = parseStyleColor(colorCandidate.color);
    if (!parsedColor || parsedColor.opacity <= 0) continue;
    const key = `${parsedColor.hex}:${parsedColor.opacity}`;
    const existing = colorMap.get(key) ?? {
      color: parsedColor.hex,
      opacity: parsedColor.opacity,
      usages: [],
    };
    for (const usage of colorCandidate.usages.slice(0, 3)) {
      if (
        typeof usage === "string" &&
        TOKEN_USAGES.has(usage as ImportedColorUsage) &&
        !existing.usages.includes(usage as ImportedColorUsage)
      ) existing.usages.push(usage as ImportedColorUsage);
    }
    if (existing.usages.length > 0) colorMap.set(key, existing);
  }

  const textStyles = new Map<string, ImportedTextStyleToken>();
  for (const candidate of message.textStyles.slice(0, 200)) {
    if (typeof candidate !== "object" || candidate === null) continue;
    const styleCandidate = candidate as Record<string, unknown>;
    const { fontFamily, fontSize, fontWeight, count } = styleCandidate;
    if (
      typeof fontFamily !== "string" ||
      fontFamily.trim().length === 0 ||
      fontFamily.length > 120 ||
      typeof fontSize !== "number" ||
      !Number.isFinite(fontSize) ||
      fontSize < 1 ||
      fontSize > 500 ||
      typeof fontWeight !== "string" ||
      fontWeight.length > 40 ||
      typeof count !== "number" ||
      !Number.isFinite(count)
    ) continue;
    const key = `${fontFamily}\u0000${fontSize}\u0000${fontWeight}`;
    const current = textStyles.get(key);
    textStyles.set(key, {
      fontFamily,
      fontSize,
      fontWeight,
      count: Math.min(2000, (current?.count ?? 0) + Math.max(1, Math.floor(count))),
    });
  }

  return {
    colors: [...colorMap.values()],
    textStyles: [...textStyles.values()],
  };
}

export function createDesignTokenCollectorScript(nonce: string): string {
  return `(() => {
  const colors = new Map();
  const textStyles = new Map();
  const addColor = (value, usage) => {
    if (!value || value === "transparent" || /rgba?\\([^)]*[,/]\\s*0(?:\\.0*)?\\s*\\)$/.test(value)) return;
    const token = colors.get(value) || { color: value, usages: [] };
    if (!token.usages.includes(usage)) token.usages.push(usage);
    colors.set(value, token);
  };
  for (const element of Array.from(document.querySelectorAll("*")).slice(0, 2000)) {
    if (["SCRIPT", "STYLE"].includes(element.tagName)) continue;
    const style = getComputedStyle(element);
    addColor(style.backgroundColor, "background");
    addColor(style.color, "text");
    for (const side of ["Top", "Right", "Bottom", "Left"]) {
      addColor(style["border" + side + "Color"], "border");
    }
    const textNodeCount = Array.from(element.childNodes).filter(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim(),
    ).length;
    if (textNodeCount === 0) continue;
    const fontSize = Number.parseFloat(style.fontSize);
    if (!Number.isFinite(fontSize) || fontSize < 1 || fontSize > 500) continue;
    const key = [style.fontFamily, fontSize, style.fontWeight].join("|");
    const token = textStyles.get(key) || {
      fontFamily: style.fontFamily.slice(0, 120),
      fontSize: Math.round(fontSize * 10) / 10,
      fontWeight: style.fontWeight.slice(0, 40),
      count: 0,
    };
    token.count += textNodeCount;
    textStyles.set(key, token);
  }
  parent.postMessage({
    type: "protoflow-design-tokens",
    nonce: ${JSON.stringify(nonce)},
    colors: Array.from(colors.values()).slice(0, 200),
    textStyles: Array.from(textStyles.values()).slice(0, 200),
  }, "*");
})();`;
}
