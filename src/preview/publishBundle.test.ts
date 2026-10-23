import { describe, expect, it } from "vitest";
import { createEmptyProject, type Widget } from "../project/schema";
import {
  generatePublishedPreviewHtml,
  getPublishedProjectData,
  publishedBundleSize,
  PREVIEW_RUNTIME_SCRIPT,
} from "./publishBundle";

describe("standalone published preview bundle", () => {
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
    expect(serialized).not.toBeNull();
    expect(JSON.parse(serialized!)).toEqual(project);
    expect(html).toContain("{{status}}");
    expect(html).not.toMatch(/<script\s+src=/i);
    expect(html).not.toMatch(/https?:\/\//i);
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
    expect(html).toContain("renderWidget(child, activeScreen, rowData)");
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
