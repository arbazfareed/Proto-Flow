import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { createEmptyProject, type Widget, type InteractionRule } from "../project/schema";
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
    // Real icons, not text symbols (B77).
    expect(html).not.toContain('const glyphs = {');
    expect(html).toContain("function drawIcon(element, name, strokeWidth, size)");
    expect(html).toContain('<script id="icon-data" type="application/json">');
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

  it("runs a Key down rule only for its chosen key (B9)", () => {
    const source = PREVIEW_RUNTIME_SCRIPT.match(/function keyMatches\(ruleKey, pressedKey\) \{[\s\S]*?\n\}/)?.[0];
    expect(source).toBeDefined();
    const keyMatches = new Function(`${source}; return keyMatches;`)() as (ruleKey: string | undefined, pressed: string) => boolean;
    expect(keyMatches(undefined, "Tab")).toBe(true);
    expect(keyMatches("", "a")).toBe(true);
    expect(keyMatches("Enter", "Enter")).toBe(true);
    expect(keyMatches("Enter", "Tab")).toBe(false);
    expect(keyMatches("a", "A")).toBe(true);
    expect(keyMatches(" ", " ")).toBe(true);
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

    expect(html).toContain('firePointer(widget, ["onTap", "onClick"], item');
    expect(html).toContain('for (const rule of activeScreen.interactionRules.filter((item) => item.event === "onLoad"))');
    expect(html).not.toContain("for (const widget of activeScreen.widgets)");
  });

  it("redraws the exported page after a screen On load rule changes a variable (B38)", () => {
    const project = createEmptyProject("On load redraw");
    const screen = project.screens[0];
    screen.widgets = [{
      id: crypto.randomUUID(),
      type: "text",
      x: 20,
      y: 20,
      width: 200,
      height: 40,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      zIndex: 0,
      style: {},
      props: { text: "Count: {{count}}" },
    }];
    project.variables.push({ id: crypto.randomUUID(), name: "count", type: "number", initial: 0, scope: "project" });
    screen.interactionRules = [{
      id: crypto.randomUUID(),
      event: "onLoad",
      conditionMode: "all",
      conditions: [],
      actions: [{ type: "setVariable", target: "count", value: "[[ count + 1 ]]" }],
    }];

    const dom = new JSDOM(generatePublishedPreviewHtml(project), { runScripts: "dangerously", pretendToBeVisual: true });
    const stage = dom.window.document.querySelector("[data-screen-id]");
    expect(stage?.textContent).toContain("Count: 1");
    expect(stage?.textContent).not.toContain("Count: 0");
    dom.window.close();
  });

  it("stops two screens that send each other on load and shows a Loop detected notice (B39)", () => {
    const project = createEmptyProject("Loop export");
    const first = project.screens[0];
    const second = { ...first, id: crypto.randomUUID(), name: "Other", widgets: [] as Widget[], interactionRules: [] as InteractionRule[] };
    project.screens.push(second);
    const goTo = (target: string) => ({
      id: crypto.randomUUID(), event: "onLoad" as const, conditionMode: "all" as const, conditions: [],
      actions: [{ type: "navigate" as const, target }],
    });
    first.interactionRules = [goTo(second.id)];
    second.interactionRules = [goTo(first.id)];

    const started = Date.now();
    const dom = new JSDOM(generatePublishedPreviewHtml(project), { runScripts: "dangerously", pretendToBeVisual: true });
    expect(Date.now() - started).toBeLessThan(3000);
    const notice = dom.window.document.getElementById("loop-notice");
    expect(notice?.getAttribute("role")).toBe("alert");
    expect(notice?.textContent).toContain("Loop detected");
    dom.window.close();
  });

  it("treats a pen or stylus click like a mouse click on Both screens (B12)", () => {
    const project = createEmptyProject("Pen export");
    const screen = project.screens[0];
    screen.inputMode = "both";
    const base = { rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 0, style: {}, width: 120, height: 40 };
    const button = { ...base, id: crypto.randomUUID(), type: "button", x: 10, y: 10, props: { label: "Go" } } as Widget;
    const label = { ...base, id: crypto.randomUUID(), type: "text", x: 10, y: 80, props: { text: "Count: {{count}}" } } as Widget;
    screen.widgets.push(button, label);
    project.variables.push({ id: crypto.randomUUID(), name: "count", type: "number", initial: 0, scope: "project" });
    screen.interactionRules = [{
      id: crypto.randomUUID(), widgetId: button.id, event: "onClick", conditionMode: "all", conditions: [],
      actions: [{ type: "setVariable", target: "count", value: "[[ count + 1 ]]" }],
    }];
    const dom = new JSDOM(generatePublishedPreviewHtml(project), { runScripts: "dangerously", pretendToBeVisual: true });
    const press = (pointerType: string) => {
      const target = Array.from(dom.window.document.querySelectorAll("[data-screen-id] *")).find((node) => node.textContent === "Go");
      const event = new dom.window.Event("pointerup", { bubbles: true });
      Object.defineProperty(event, "pointerType", { value: pointerType });
      target?.dispatchEvent(event);
      return dom.window.document.querySelector("[data-screen-id]")?.textContent ?? "";
    };
    expect(press("pen")).toContain("Count: 1");
    expect(press("mouse")).toContain("Count: 2");
    expect(press("touch")).toContain("Count: 2");
    dom.window.close();
  });

  it("runs Hover once on mouse enter and Mouse leave on leave, on Mouse and Both screens (B50)", () => {
    for (const mode of ["mouse", "both"] as const) {
      const project = createEmptyProject(`Hover export ${mode}`);
      const screen = project.screens[0];
      screen.inputMode = mode;
      const base = { rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 0, style: {}, width: 120, height: 40 };
      const button = { ...base, id: crypto.randomUUID(), type: "button", x: 10, y: 10, props: { label: "Over me" } } as Widget;
      const label = { ...base, id: crypto.randomUUID(), type: "text", x: 10, y: 80, props: { text: "In {{entered}} out {{left}}" } } as Widget;
      screen.widgets.push(button, label);
      for (const name of ["entered", "left"]) {
        project.variables.push({ id: crypto.randomUUID(), name, type: "number", initial: 0, scope: "project" });
      }
      const counter = (event: InteractionRule["event"], target: string): InteractionRule => ({
        id: crypto.randomUUID(), widgetId: button.id, event, conditionMode: "all", conditions: [],
        actions: [{ type: "setVariable", target, value: `[[ ${target} + 1 ]]` }],
      });
      screen.interactionRules = [counter("onHover", "entered"), counter("onMouseLeave", "left")];

      const dom = new JSDOM(generatePublishedPreviewHtml(project), { runScripts: "dangerously", pretendToBeVisual: true });
      const send = (type: string, pointerType?: string) => {
        const target = Array.from(dom.window.document.querySelectorAll("[data-screen-id] *")).find((node) => node.textContent === "Over me");
        const event = new dom.window.Event(type, { bubbles: false });
        if (pointerType) Object.defineProperty(event, "pointerType", { value: pointerType });
        target?.dispatchEvent(event);
        return dom.window.document.querySelector("[data-screen-id]")?.textContent ?? "";
      };
      const [enter, leave] = mode === "mouse" ? ["mouseenter", "mouseleave"] : ["pointerenter", "pointerleave"];
      const pointer = mode === "both" ? "mouse" : undefined;

      expect(send(enter, pointer)).toContain("In 1 out 0");
      expect(send(leave, pointer)).toContain("In 1 out 1");
      expect(send(enter, pointer)).toContain("In 2 out 1");
      if (mode === "both") expect(send("pointerleave", "touch")).toContain("In 2 out 1");
      dom.window.close();
    }
  });

  it("shows no loop notice when screens do not loop (B39)", () => {
    const dom = new JSDOM(generatePublishedPreviewHtml(createEmptyProject("No loop")), { runScripts: "dangerously", pretendToBeVisual: true });
    expect(dom.window.document.getElementById("loop-notice")).toBeNull();
    dom.window.close();
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

describe("published pages run the editor's expression engine (B20)", () => {
  function pageText(text: string): string {
    const project = createEmptyProject("Expressions");
    project.screens[0].widgets = [{
      id: crypto.randomUUID(), type: "text", x: 20, y: 20, width: 400, height: 40,
      rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 0, style: {},
      props: { text },
    }];
    const dom = new JSDOM(generatePublishedPreviewHtml(project), { runScripts: "dangerously", pretendToBeVisual: true });
    const shown = dom.window.document.querySelector("[data-screen-id]")?.textContent ?? "";
    dom.window.close();
    return shown;
  }

  it("shows the answers the editor shows, including the ones the old hand-written copy got wrong", () => {
    // The old copy threw on replace() with "+" in it, so an exported page showed an error instead.
    expect(pageText("[[ replace('a-a', '-', '+') ]]")).toContain("a+a");
    expect(pageText("[[ 2 ** 3 ** 2 ]]")).toContain("512");
    expect(pageText("[[ formatDate('2024-03-10', 'dd/MM/yyyy') ]]")).toContain("10/03/2024");
    expect(pageText("[[ concat('Total: ', max(2, 7)) ]]")).toContain("Total: 7");
  });

  it("carries the generated engine and no second copy of it", () => {
    const html = generatePublishedPreviewHtml(createEmptyProject("Engine"));
    expect(html).toContain("const { evaluateExpression, clearExpressionCache } = (() => {");
    expect(html).not.toContain("tokenCache");
    expect(html.match(/function evaluateExpression\(/g)).toHaveLength(1);
  });
});
