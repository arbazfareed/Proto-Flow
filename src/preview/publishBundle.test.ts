import { describe, expect, it } from "vitest";
import { createEmptyProject, type Widget } from "../project/schema";
import {
  generatePublishedPreviewHtml,
  getPublishedProjectData,
  publishedBundleSize,
  PREVIEW_RUNTIME_SCRIPT,
} from "./publishBundle";

describe("standalone published preview bundle", () => {
  it("keeps text fills as foreground colors and renders shape and icon widgets cleanly", () => {
    const project = createEmptyProject("Messaging visual runtime");
    const html = generatePublishedPreviewHtml(project);

    expect(html).toContain('const textWidget = ["text", "heading", "label", "paragraph", "link", "code"].includes(widget.type)');
    expect(html).toContain('element.style.backgroundColor = textWidget || !widget.style.fill');
    expect(html).toContain('input.className = "preview-control"');
    expect(html).toContain("const shapeOrText = [");
    expect(html).toContain('element.textContent = shownText || (shapeOrText ? "" : widget.type.replaceAll("-", " "))');
    expect(html).toContain('const glyphs = {');
    expect(html).toContain('element.textContent = glyphs[iconName] || "•"');
    expect(html).toContain("function widgetVisible(widget, activeScreen)");
    expect(html).toContain("if (!widgetVisible(widget, activeScreen)) continue;");
    expect(html).toContain("if (matchedRule && renderAfter) render();");
    expect(() => new Function(PREVIEW_RUNTIME_SCRIPT)).not.toThrow();
  });

  it("applies fill and stroke opacity to colours like the canvas does", () => {
    const source = PREVIEW_RUNTIME_SCRIPT.match(/function withOpacity\(color, opacity\) \{[\s\S]*?\n\}/)?.[0];
    expect(source).toBeDefined();
    const withOpacity = new Function(`${source}; return withOpacity;`)() as (color: string, opacity?: number) => string;
    expect(withOpacity("#f59e0b", 0.1)).toBe("color-mix(in srgb, #f59e0b 10%, transparent)");
    expect(withOpacity("#f59e0b", 1)).toBe("#f59e0b");
    expect(withOpacity("#f59e0b", undefined)).toBe("#f59e0b");
    expect(PREVIEW_RUNTIME_SCRIPT).toContain("withOpacity(widget.style.fill, widget.style.fillOpacity)");
    expect(PREVIEW_RUNTIME_SCRIPT).toContain("withOpacity(widget.style.stroke, widget.style.strokeOpacity)");
  });

  it("picks a readable button label colour like the canvas does", () => {
    const source = PREVIEW_RUNTIME_SCRIPT.match(/function readableOn\(color, opacity\) \{[\s\S]*?\n\}/)?.[0];
    expect(source).toBeDefined();
    const readableOn = new Function(`${source}; return readableOn;`)() as (color: string, opacity?: number) => string;
    expect(readableOn("#694ac3")).toBe("#ffffff");
    expect(readableOn("#fff")).toBe("#24212b");
    expect(readableOn("#694ac3", 0.1)).toBe("#24212b");
    expect(readableOn("not-a-colour")).toBe("#24212b");
  });

  it("renders semantic cards, charts, and flex-layout elements", () => {
    const project = createEmptyProject("Learning widget runtime");
    project.screens[0].widgets.push(
      {
        id: crypto.randomUUID(), type: "card", x: 10, y: 20, width: 260, height: 196,
        rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 1, style: {},
        props: { title: "Card title", subtitle: "Description", imageSrc: "", actionLabel: "Open" },
      },
      {
        id: crypto.randomUUID(), type: "chart", x: 20, y: 30, width: 240, height: 160,
        rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 2, style: {},
        props: { label: "Activity", chartType: "pie", values: [10, 40, 25] },
      },
      {
        id: crypto.randomUUID(), type: "flex-row", x: 30, y: 40, width: 300, height: 120,
        rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 3, style: {},
        props: { label: "Actions", gap: 12, padding: 12 },
      },
    );
    const html = generatePublishedPreviewHtml(project);

    expect(html).toContain('element.classList.add("card-widget")');
    expect(html).toContain('element.classList.add("chart-widget")');
    expect(html).toContain('element.classList.add("layout-widget"');
    expect(html).toContain("autoLayoutPosition(widget, activeScreen)");
  });

  it("embeds the project data and runtime without external requests or browser storage", () => {
    const project = createEmptyProject("Published prototype");
    const widget: Widget = {
      id: crypto.randomUUID(),
      type: "button",
      x: 24,
      y: 32,
      width: 160,
      height: 48,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      zIndex: 0,
      style: {},
      props: { label: "Open {{status}}" },
    };
    project.screens[0].widgets.push(widget);
    project.variables.push({
      id: crypto.randomUUID(),
      name: "status",
      type: "string",
      initial: "ready",
      scope: "project",
    });

    const html = generatePublishedPreviewHtml(project);
    const serialized = getPublishedProjectData(html);

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("@font-face{font-family:Inter");
    expect(html).toContain('<template id="inter-font-license">');
    expect(html).toContain("SIL OPEN FONT LICENSE");
    expect(serialized).not.toBeNull();
    expect(JSON.parse(serialized!)).toEqual(project);
    expect(html).toContain("{{status}}");
    expect(html).not.toMatch(/<script\s+src=/i);
    expect(html).not.toMatch(/(?:src|href)\s*=\s*["']https?:\/\//i);
    expect(html).not.toMatch(/\b(?:fetch|XMLHttpRequest|localStorage|sessionStorage)\b/);
    expect(publishedBundleSize(html)).toBe(new TextEncoder().encode(html).byteLength);
  });

  it("escapes script terminators and project titles before embedding user data", () => {
    const project = createEmptyProject("</title><script>attack()</script>");
    project.screens[0].widgets.push({
      id: crypto.randomUUID(),
      type: "text",
      x: 0,
      y: 0,
      width: 100,
      height: 30,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      zIndex: 0,
      style: {},
      props: { text: "</script><script>attack()</script>" },
    });

    const html = generatePublishedPreviewHtml(project);
    const serialized = getPublishedProjectData(html);

    expect(html).not.toContain("</title><script>attack()");
    expect(html).not.toContain("</script><script>attack()");
    expect(JSON.parse(serialized!).screens[0].widgets[0].props.text).toBe("</script><script>attack()</script>");
  });

  it("fires touch-tap rules and evaluates each screen load rule only once", () => {
    const html = generatePublishedPreviewHtml(createEmptyProject("Runtime checks"));

    expect(html).toContain('fire(widget, "onTap", item)');
    expect(html).toContain('for (const rule of activeScreen.interactionRules.filter((item) => item.event === "onLoad"))');
    expect(html).not.toContain("for (const widget of activeScreen.widgets)");
  });

  it("includes dynamic-panel state switching and transition rendering in the standalone runtime", () => {
    const html = generatePublishedPreviewHtml(createEmptyProject("Panel export"));
    expect(html).toContain("function activeWidgets(widgets, depth = 0)");
    expect(html).toContain('panelStates.set(action.target, state?.id || action.stateId || stateValue)');
    expect(html).toContain("@keyframes protoflow-panel-slide-left");
  });

  it("renders repeater templates per record and includes bounded data actions", () => {
    const project = createEmptyProject("Repeater export");
    project.screens[0].widgets.push({
      id: crypto.randomUUID(),
      type: "repeater",
      x: 0,
      y: 0,
      width: 240,
      height: 80,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      zIndex: 0,
      style: {},
      props: {
        dataset: [{ name: "Ada" }],
        rowTemplate: { widgets: [] },
        layout: "vertical",
        gap: 8,
        itemBinding: {},
      },
    });
    const html = generatePublishedPreviewHtml(project);
    expect(html).toContain("function repeaterRows(value)");
    expect(html).toContain("case");
    expect(html).toContain('action.type === "sortRepeater"');
    expect(html).toContain("renderWidget(child, activeScreen, rowData, localVariables)");
    expect(html).toContain("item?.[name.slice(5)]");
    expect(html).toContain("function repeaterItemVisible(widget, item)");
    expect(html).toContain("function evaluateExpression(source, context = {})");
    expect(html).toContain("evaluateExpression(source.trim(), { variables: variablesByName");
    expect(html).not.toMatch(/\beval\s*\(/);
    expect(html).toContain("bindWidgetEvents(row, widget, rowData)");
    expect(html).toContain('element.addEventListener("dblclick", () => fire(widget, "onDoubleClick", item))');
    expect(html).toContain('"onPinchIn" : "onPinchOut"');
    expect(html).toContain('fire(widget, "onPan", item, false)');
    expect(() => new Function(PREVIEW_RUNTIME_SCRIPT)).not.toThrow();
  });

  it("initializes and discards per-rule locals while preserving local-over-screen-over-project precedence", () => {
    const html = generatePublishedPreviewHtml(createEmptyProject("Local scope export"));
    expect(html).toContain("Object.fromEntries((rule.localVariables || []).map((entry) => [entry.name, entry.initial]))");
    expect(html).toContain("if (localVariables && Object.prototype.hasOwnProperty.call(localVariables, name))");
    expect(html).toContain("return { ...globals, ...screenVariables, ...localVariables }");
    expect(html).toContain("actions(rule, activeScreen.id, undefined, undefined, localVariables)");
    expect(() => new Function(PREVIEW_RUNTIME_SCRIPT)).not.toThrow();
  });
});
