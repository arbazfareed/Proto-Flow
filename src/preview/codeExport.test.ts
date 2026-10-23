import { describe, expect, it } from "vitest";
import ts from "typescript";
import { createEmptyProject } from "../project/schema";
import {
  generateSingleFileJsx,
  prepareExportProject,
  type CodeExportOptions,
} from "./codeExport";

function options(overrides: Partial<CodeExportOptions> = {}): CodeExportOptions {
  return {
    scope: "all",
    includeInteractions: true,
    includeVariables: true,
    includeAssets: true,
    tailwindVersion: "4",
    ...overrides,
  };
}

describe("React code export preparation", () => {
  it("keeps the selected screen, typed variables, and only compatible interactions", () => {
    const project = createEmptyProject("Export");
    const first = project.screens[0];
    project.variables.push({
      id: crypto.randomUUID(),
      name: "status",
      type: "string",
      initial: "ready",
      scope: "project",
    });
    const second = { ...first, id: crypto.randomUUID(), name: "Details", widgets: [], interactionRules: [] };
    project.screens.push(second);
    const single = prepareExportProject(project, options({ scope: "current", screenId: second.id }));

    expect(single.screens.map((screen) => screen.id)).toEqual([second.id]);
    expect(single.startScreenId).toBe(second.id);
    expect(single.variables.map((variable) => variable.name)).toEqual(["status"]);
  });

  it("honors the feature toggles while retaining non-embedded image URLs", () => {
    const project = createEmptyProject("Asset options");
    project.screens[0].widgets.push({
      id: crypto.randomUUID(),
      type: "image",
      x: 0,
      y: 0,
      width: 100,
      height: 80,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      zIndex: 0,
      style: {},
      props: { src: "https://assets.example/image.png", url: "data:image/png;base64,AAAA" },
    });
    const result = prepareExportProject(project, options({
      includeInteractions: false,
      includeVariables: false,
      includeAssets: false,
    }));

    expect(result.variables).toEqual([]);
    expect(result.screens[0].interactionRules).toEqual([]);
    expect(result.screens[0].widgets[0].props).toMatchObject({ src: "https://assets.example/image.png", url: "" });
  });

  it("generates a safe single-file TSX fallback with screen navigation", () => {
    const project = createEmptyProject("</script><script>notMarkup()</script>");
    const source = generateSingleFileJsx(project);

    expect(source).toContain("export default function App()");
    expect(source).toContain("project.screens.map");
    expect(source).not.toContain("</script><script>notMarkup()");
    expect(source).toContain("\\u003c/script\\u003e");
  });

  it("includes widget notes as safe source comments", () => {
    const project = createEmptyProject("Annotated export");
    project.screens[0].widgets.push({
      id: crypto.randomUUID(),
      type: "button",
      name: "Confirm",
      x: 0,
      y: 0,
      width: 100,
      height: 40,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      zIndex: 0,
      style: {},
      props: {},
      notes: {
        description: "Never emit */ as executable markup",
        requirementId: "REQ-12",
        priority: "high",
        status: "approved",
        tags: ["checkout"],
        custom: {},
      },
    });

    const source = generateSingleFileJsx(project);

    expect(source).toContain('// Widget note for "Screen 1" / "Confirm"');
    expect(source).toContain('"description Never emit */ as executable markup"');
  });

  it("exports repeater datasets through a bounded map with item-bound template widgets", () => {
    const project = createEmptyProject("Repeater export");
    const panel = {
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
        layout: "vertical",
        gap: 8,
        rowTemplate: { widgets: [{
          id: crypto.randomUUID(),
          type: "text",
          x: 8,
          y: 8,
          width: 120,
          height: 24,
          rotation: 0,
          opacity: 1,
          visible: true,
          locked: false,
          zIndex: 0,
          style: {},
          props: {
            text: "Hello {{item.name}} · [[ count * 2 ]]",
            visibleWhen: { field: "active", operator: "equals", value: true },
          },
        }] },
      },
    };
    project.screens[0].widgets.push(panel);
    const source = generateSingleFileJsx(project);
    expect(source).toContain("rows.slice(0, 1000).map");
    expect(source).toContain("widget.props.rowTemplate");
    expect(source).toContain("item?.[field]");
    expect(source).toContain("Hello {{item.name}}");
    expect(source).toContain("repeaterItemVisible(child, row)");
    expect(source).toContain("function evaluateExpression(source, context = {})");
    expect(source).toContain("evaluateExpression(source.trim(), { variables, widgets, item, thisWidget: widget })");
    expect(source).not.toMatch(/\beval\s*\(/);
    const transpiled = ts.transpileModule(source, {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
      reportDiagnostics: true,
    });
    expect(transpiled.diagnostics?.filter((diagnostic) =>
      diagnostic.category === ts.DiagnosticCategory.Error,
    )).toEqual([]);
  });

  it("retains local-variable rules and emits invocation-scoped bindings in the React export", () => {
    const project = createEmptyProject("Local variable export");
    const trigger = {
      id: crypto.randomUUID(),
      type: "button",
      x: 0,
      y: 0,
      width: 100,
      height: 40,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      zIndex: 0,
      style: {},
      props: { label: "Increment" },
    };
    project.screens[0].widgets.push(trigger);
    project.variables.push({
      id: crypto.randomUUID(),
      name: "total",
      type: "number",
      initial: 0,
      scope: "project",
    });
    project.screens[0].interactionRules = [{
      id: crypto.randomUUID(),
      widgetId: trigger.id,
      event: "onClick",
      conditions: [{ variable: "[[ item.score >= amount ]]", operator: "equals", value: true }],
      actions: [
        { type: "setVariable", target: "amount", value: "[[ amount + 1 ]]" },
        { type: "setVariable", target: "total", value: "[[ item.score + amount ]]" },
      ],
      localVariables: [{ name: "amount", type: "number", initial: 2 }],
    }];

    const prepared = prepareExportProject(project, options());
    expect(prepared.screens[0].interactionRules).toHaveLength(1);
    const source = generateSingleFileJsx(prepared);
    expect(source).toContain("let localValue = definition.initial");
    expect(source).toContain("localVariables[definition.name] = localValue");
    expect(source).toContain('onClick={() => runInteractions(widget, "onClick", item)}');
    const transpiled = ts.transpileModule(source, {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
      reportDiagnostics: true,
    });
    expect(transpiled.diagnostics?.filter((diagnostic) =>
      diagnostic.category === ts.DiagnosticCategory.Error,
    )).toEqual([]);
  });
});
