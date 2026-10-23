import { describe, expect, it } from "vitest";
import { createEmptyProject, ProtoWidgetSchema, type Widget } from "./schema";
import {
  applyRichTextMark,
  ensureRichTextRuns,
  parseRichTextMarkdown,
  richTextContrastRatio,
  richTextRunsToHtml,
  richTextRunsToPlainText,
  sanitizeRichTextHref,
} from "./richText";

describe("rich text model", () => {
  it("parses the supported Markdown subset into bounded semantic runs", () => {
    const runs = parseRichTextMarkdown(
      "**bold** *italic* __underlined__ ~~struck~~ `code` ==highlight== [mail](mailto:help@example.com)\n- {{name}}\n2. [[price * 2]]",
    );

    expect(runs.map((run) => run.marks)).toEqual([
      { bold: true }, {}, { italic: true }, {}, { underline: true }, {},
      { strike: true }, {}, { code: true }, {}, { highlight: "#fff2a8" }, {},
      { link: "mailto:help@example.com" }, {}, { list: "bullet" }, {},
      { list: "number" },
    ]);
    expect(richTextRunsToPlainText(runs)).toBe(
      "bold italic underlined struck code highlight mail\n{{name}}\n[[price * 2]]",
    );
    expect(richTextRunsToHtml(runs)).toContain("<strong>bold</strong>");
    expect(richTextRunsToHtml(runs)).toContain('<a href="mailto:help@example.com">mail</a>');
    expect(richTextRunsToHtml(runs)).toContain("<ul><li>{{name}}</li></ul>");
    expect(richTextRunsToHtml(runs)).toContain("<ol><li>[[price * 2]]</li></ol>");
  });

  it("keeps unsafe links inert and escapes user content in generated HTML", () => {
    const runs = parseRichTextMarkdown("[unsafe](javascript:alert(1)) <img src=x>");
    expect(sanitizeRichTextHref("javascript:alert(1)")).toBeNull();
    expect(runs.some((run) => run.marks.link !== undefined)).toBe(false);
    expect(richTextRunsToHtml([{ text: "<img src=x>", marks: {} }])).toBe("&lt;img src=x&gt;");
  });

  it("checks inline text color contrast against the canvas background", () => {
    expect(richTextContrastRatio("#222222", "#ffffff")).toBeGreaterThan(4.5);
    expect(richTextContrastRatio("#777777", "#ffffff")).toBeLessThan(4.5);
    expect(richTextContrastRatio("red", "#ffffff")).toBeNull();
  });

  it("splits run marks by selection without changing surrounding formatting", () => {
    expect(applyRichTextMark(
      [{ text: "hello world", marks: { bold: true } }],
      6,
      11,
      { italic: true },
    )).toEqual([
      { text: "hello ", marks: { bold: true } },
      { text: "world", marks: { bold: true, italic: true } },
    ]);
  });

  it("validates rich run limits and converts existing Markdown only in rich mode exports", () => {
    const widget: Widget = {
      id: crypto.randomUUID(),
      type: "text",
      x: 0,
      y: 0,
      width: 120,
      height: 40,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      zIndex: 0,
      style: {},
      props: { richText: true, text: "**Hello** {{name}}" },
    };
    const project = createEmptyProject("Rich");
    project.screens[0].widgets.push(widget);

    const prepared = ensureRichTextRuns(project);
    const richRuns = prepared.screens[0].widgets[0].props.richTextRuns;
    expect(Array.isArray(richRuns)).toBe(true);
    expect((richRuns as Array<{ marks: { bold?: boolean } }>)[0].marks.bold).toBe(true);
    expect(widget.props.richTextRuns).toBeUndefined();
    expect(ProtoWidgetSchema.safeParse({
      ...widget,
      props: { richText: true, richTextRuns: [{ text: "bad", marks: { color: "red" } }] },
    }).success).toBe(false);
  });
});
