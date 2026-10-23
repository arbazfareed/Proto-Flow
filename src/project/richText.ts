import {
  RichTextMarksSchema,
  type RichTextMarks,
  type Project,
  type RichTextRun,
} from "./schema";
import { mapWidgetsDeep } from "./dynamicPanels";

const MAX_RUNS = 1_000;
const MAX_TEXT_LENGTH = 20_000;
const INLINE_MARKDOWN = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|__[^_\n]+__|~~[^~\n]+~~|==[^=\n]+==|`[^`\n]+`|\[[^\]\n]+\]\([^)]+\))/g;

export function normalizeRichTextRuns(value: unknown, fallbackText = ""): RichTextRun[] {
  if (!Array.isArray(value)) return fallbackText ? [{ text: fallbackText, marks: {} }] : [];
  const runs: RichTextRun[] = [];
  let remaining = MAX_TEXT_LENGTH;
  for (const candidate of value.slice(0, MAX_RUNS)) {
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      !("text" in candidate) ||
      typeof candidate.text !== "string" ||
      remaining <= 0
    ) continue;
    const parsedMarks = RichTextMarksSchema.safeParse(
      "marks" in candidate ? candidate.marks : {},
    );
    if (!parsedMarks.success) continue;
    const text = candidate.text.slice(0, remaining);
    remaining -= text.length;
    if (!text) continue;
    const previous = runs[runs.length - 1];
    if (previous && marksEqual(previous.marks, parsedMarks.data)) previous.text += text;
    else runs.push({ text, marks: parsedMarks.data });
  }
  return runs;
}

function marksEqual(left: RichTextMarks, right: RichTextMarks): boolean {
  return Object.keys({ ...left, ...right }).every((key) =>
    left[key as keyof RichTextMarks] === right[key as keyof RichTextMarks],
  );
}

export function richTextRunsToPlainText(runs: RichTextRun[]): string {
  return runs.map((run) => run.text).join("");
}

export function sanitizeRichTextHref(value: string): string | null {
  const href = value.trim();
  if (!href || /[\u0000-\u001f\u007f]/.test(href)) return null;
  try {
    const url = new URL(href, "https://protoflow.invalid");
    if (url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:") {
      return href;
    }
  } catch {
    return null;
  }
  return null;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function wrapInlineHtml(text: string, marks: RichTextMarks): string {
  let html = escapeHtml(text);
  if (marks.code) html = `<code>${html}</code>`;
  if (marks.bold) html = `<strong>${html}</strong>`;
  if (marks.italic) html = `<em>${html}</em>`;
  if (marks.underline) html = `<u>${html}</u>`;
  if (marks.strike) html = `<s>${html}</s>`;
  if (marks.highlight) html = `<mark style="background-color:${marks.highlight}">${html}</mark>`;
  const styles = [
    marks.color ? `color:${marks.color}` : "",
    marks.fontSize ? `font-size:${marks.fontSize}px` : "",
  ].filter(Boolean).join(";");
  if (styles) html = `<span style="${styles}">${html}</span>`;
  const href = marks.link ? sanitizeRichTextHref(marks.link) : null;
  if (href) html = `<a href="${escapeHtml(href)}">${html}</a>`;
  return html;
}

export function richTextRunsToHtml(runs: RichTextRun[]): string {
  const lines: Array<Array<{ text: string; marks: RichTextMarks }>> = [[]];
  for (const run of normalizeRichTextRuns(runs)) {
    const pieces = run.text.split("\n");
    pieces.forEach((piece, index) => {
      if (piece) lines[lines.length - 1].push({ text: piece, marks: run.marks });
      if (index < pieces.length - 1) lines.push([]);
    });
  }

  const html: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const list = line.find((part) => part.marks.list)?.marks.list;
    const content = line.map((part) => wrapInlineHtml(part.text, part.marks)).join("");
    if (list === "bullet") html.push(`<ul><li>${content}</li></ul>`);
    else if (list === "number") html.push(`<ol><li>${content}</li></ol>`);
    else {
      if (index > 0) html.push("<br>");
      html.push(content);
    }
  }
  return html.join("");
}

export function richTextHtmlToRuns(html: string): RichTextRun[] {
  if (typeof DOMParser === "undefined") {
    throw new Error("Rich text editing requires a browser DOM parser.");
  }
  const document = new DOMParser().parseFromString(html, "text/html");
  const runs: RichTextRun[] = [];
  const append = (text: string, marks: RichTextMarks) => {
    if (!text) return;
    const previous = runs[runs.length - 1];
    if (previous && marksEqual(previous.marks, marks)) previous.text += text;
    else runs.push({ text, marks: { ...marks } });
  };
  const newline = (marks: RichTextMarks) => {
    if (runs.length > 0 && !runs[runs.length - 1].text.endsWith("\n")) append("\n", marks);
  };
  const visit = (node: Node, inherited: RichTextMarks): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      append(node.textContent ?? "", inherited);
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    const marks: RichTextMarks = { ...inherited };
    const tag = node.tagName.toLowerCase();
    if (tag === "strong" || tag === "b") marks.bold = true;
    if (tag === "em" || tag === "i") marks.italic = true;
    if (tag === "u") marks.underline = true;
    if (tag === "s" || tag === "strike" || tag === "del") marks.strike = true;
    if (tag === "code") marks.code = true;
    if (tag === "a") {
      const href = sanitizeRichTextHref(node.getAttribute("href") ?? "");
      if (href) marks.link = href;
    }
    if (tag === "mark") marks.highlight = parseCssColor(node.style.backgroundColor) ?? "#fff2a8";
    if (tag === "span") {
      marks.color = parseCssColor(node.style.color) ?? marks.color;
      const size = Number.parseFloat(node.style.fontSize);
      if (Number.isFinite(size) && size >= 1 && size <= 500) marks.fontSize = size;
    }
    if (tag === "ul" || tag === "ol") {
      const listMarks = { ...marks, list: tag === "ul" ? "bullet" as const : "number" as const };
      Array.from(node.childNodes).forEach((child) => visit(child, listMarks));
      return;
    }
    const block = tag === "p" || tag === "div" || tag === "li";
    if (block) newline(marks);
    if (tag === "li") marks.list ??= "bullet";
    if (tag === "br") {
      newline(marks);
      return;
    }
    Array.from(node.childNodes).forEach((child) => visit(child, marks));
    if (block) newline(marks);
  };
  Array.from(document.body.childNodes).forEach((node) => visit(node, {}));
  while (runs[runs.length - 1]?.text === "\n") runs.pop();
  return normalizeRichTextRuns(runs);
}

function parseCssColor(value: string): string | undefined {
  const normalized = value.trim();
  const hex = normalized.match(/^#[\da-f]{3,8}$/i);
  if (hex) return hex[0];
  const rgb = normalized.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*[\d.]+)?\s*\)$/i);
  if (!rgb) return undefined;
  const channels = rgb.slice(1, 4).map(Number);
  if (channels.some((channel) => channel > 255)) return undefined;
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

export function richTextContrastRatio(foreground: string, background: string): number | null {
  const luminance = (value: string): number | null => {
    const hex = value.trim().match(/^#(?:([\da-f])([\da-f])([\da-f])|([\da-f]{2})([\da-f]{2})([\da-f]{2}))$/i);
    if (!hex) return null;
    const channels = hex[4]
      ? [hex[4], hex[5], hex[6]].map((channel) => Number.parseInt(channel, 16))
      : [hex[1], hex[2], hex[3]].map((channel) => Number.parseInt(`${channel}${channel}`, 16));
    const linear = channels.map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    });
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  };
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  if (foregroundLuminance === null || backgroundLuminance === null) return null;
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

export function parseRichTextMarkdown(markdown: string): RichTextRun[] {
  const lines = markdown.slice(0, MAX_TEXT_LENGTH).split("\n");
  const runs: RichTextRun[] = [];
  lines.forEach((line, index) => {
    const listPrefix = /^\s*(?:([-*+])|(\d+)\.)\s+/.exec(line);
    const list: RichTextMarks["list"] = listPrefix
      ? listPrefix[2] ? "number" : "bullet"
      : undefined;
    const source = listPrefix ? line.slice(listPrefix[0].length) : line;
    for (const token of source.split(INLINE_MARKDOWN)) {
      if (!token) continue;
      let text = token;
      const marks: RichTextMarks = list ? { list } : {};
      if (token.startsWith("**") && token.endsWith("**")) {
        text = token.slice(2, -2);
        marks.bold = true;
      } else if (token.startsWith("__") && token.endsWith("__")) {
        text = token.slice(2, -2);
        marks.underline = true;
      } else if (token.startsWith("~~") && token.endsWith("~~")) {
        text = token.slice(2, -2);
        marks.strike = true;
      } else if (token.startsWith("==") && token.endsWith("==")) {
        text = token.slice(2, -2);
        marks.highlight = "#fff2a8";
      } else if (token.startsWith("`") && token.endsWith("`")) {
        text = token.slice(1, -1);
        marks.code = true;
      } else if (token.startsWith("[") && token.includes("](") && token.endsWith(")")) {
        const divider = token.indexOf("](");
        text = token.slice(1, divider);
        const href = sanitizeRichTextHref(token.slice(divider + 2, -1));
        if (href) marks.link = href;
      } else if (token.startsWith("*") && token.endsWith("*")) {
        text = token.slice(1, -1);
        marks.italic = true;
      }
      runs.push({ text, marks });
    }
    if (index < lines.length - 1) runs.push({ text: "\n", marks: {} });
  });
  return normalizeRichTextRuns(runs);
}

export function ensureRichTextRuns(project: Project): Project {
  return {
    ...project,
    screens: project.screens.map((screen) => ({
      ...screen,
      widgets: mapWidgetsDeep(screen.widgets, (widget) => {
        if (
          widget.type !== "text" ||
          widget.props.richText !== true ||
          Array.isArray(widget.props.richTextRuns)
        ) return widget;
        const source = typeof widget.props.text === "string" ? widget.props.text : "";
        return {
          ...widget,
          props: { ...widget.props, richTextRuns: parseRichTextMarkdown(source) },
        };
      }),
    })),
  };
}

export function applyRichTextMark(
  runs: RichTextRun[],
  start: number,
  end: number,
  update: Partial<RichTextMarks>,
): RichTextRun[] {
  if (start >= end) return runs;
  let offset = 0;
  const updated = runs.flatMap((run) => {
    const runStart = offset;
    const runEnd = offset + run.text.length;
    offset = runEnd;
    const selectionStart = Math.max(start, runStart);
    const selectionEnd = Math.min(end, runEnd);
    if (selectionStart >= selectionEnd) return [run];
    const before = run.text.slice(0, selectionStart - runStart);
    const selected = run.text.slice(selectionStart - runStart, selectionEnd - runStart);
    const after = run.text.slice(selectionEnd - runStart);
    return [
      ...(before ? [{ text: before, marks: run.marks }] : []),
      { text: selected, marks: { ...run.marks, ...update } },
      ...(after ? [{ text: after, marks: run.marks }] : []),
    ];
  });
  return normalizeRichTextRuns(updated);
}
