import { describe, expect, it } from "vitest";
import { createEmptyProject, type Project } from "./schema";
import {
  getVariableCompletions,
  renameVariableReferences,
  validateVariableReferences,
  VariableRuntimeStore,
} from "./variables";

function withWidgetText(text: string): Project {
  const project = createEmptyProject();
  const screen = project.screens[0];
  return {
    ...project,
    variables: [{
      id: crypto.randomUUID(),
      name: "customerName",
      type: "string" as const,
      initial: "Ada",
      scope: "project" as const,
    }],
    screens: [{
      ...screen,
      widgets: [{
        id: crypto.randomUUID(),
        type: "text",
        x: 0,
        y: 0,
        width: 120,
        height: 30,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        zIndex: 0,
        style: {},
        props: { text },
      }],
    }],
  };
}

describe("variable references and runtime values", () => {
  it("reports unknown, unused, and type-mismatched references", () => {
    const project = withWidgetText("Hello {{customerName}} {{missing}}");
    const screen = project.screens[0];
    project.screens[0] = {
      ...screen,
      interactionRules: [{
        id: crypto.randomUUID(),
        event: "onClick",
        conditions: [{
          variable: "customerName",
          operator: "greaterThan",
          value: "Grace",
        }],
        actions: [{ type: "setVariable", target: "missing", value: 2 }],
      }],
    };

    const issues = validateVariableReferences(project);
    expect(issues.map((issue) => issue.code)).toEqual([
      "unknown-reference",
      "type-mismatch",
      "unknown-reference",
    ]);
    expect(issues.map((issue) => issue.severity)).toEqual(["error", "warning", "error"]);
  });

  it("warns when a variable is unused", () => {
    const project = withWidgetText("Static text");
    expect(validateVariableReferences(project)).toContainEqual(expect.objectContaining({
      code: "unused-variable",
      severity: "warning",
    }));
  });

  it("renames text and interaction references without changing other values", () => {
    const project = withWidgetText("Hello {{customerName}}!");
    const screen = project.screens[0];
    const variable = project.variables[0];
    project.screens[0] = {
      ...screen,
      interactionRules: [{
        id: crypto.randomUUID(),
        event: "onClick",
        conditions: [{ variable: "customerName", operator: "equals", value: "Ada" }],
        actions: [{ type: "setVariable", target: "customerName", value: "Grace" }],
      }],
    };

    const renamed = renameVariableReferences(project, variable, "personName");
    expect(renamed.variables[0].name).toBe("personName");
    expect(renamed.screens[0].widgets[0].props.text).toBe("Hello {{personName}}!");
    expect(renamed.screens[0].interactionRules[0]).toMatchObject({
      conditions: [{ variable: "personName" }],
      actions: [{ target: "personName" }],
    });
  });

  it("provides matching project and active-screen suggestions", () => {
    const project = withWidgetText("");
    const screenId = project.screens[0].id;
    project.variables.push({
      id: crypto.randomUUID(),
      name: "customerEmail",
      type: "string",
      initial: "",
      scope: "project",
    });
    project.variables.push({
      id: crypto.randomUUID(),
      name: "customerId",
      type: "number",
      initial: 0,
      scope: "screen",
      screenId,
    });
    expect(getVariableCompletions(project, screenId, "Hello {{customer", 18)?.variables.map((item) => item.name))
      .toEqual(["customerId", "customerEmail", "customerName"]);
    expect(getVariableCompletions(project, screenId, "Hello {", 7)).toBeNull();
  });

  it("initializes, scopes, interpolates, validates, and resets runtime values", () => {
    const project = withWidgetText("");
    const screenId = project.screens[0].id;
    project.variables.push({
      id: crypto.randomUUID(),
      name: "customerName",
      type: "string",
      initial: "screen value",
      scope: "screen",
      screenId,
    });
    project.variables.push({
      id: crypto.randomUUID(),
      name: "visits",
      type: "number",
      initial: 1,
      scope: "project",
    });
    const runtime = new VariableRuntimeStore(project.variables);
    const designVariable = project.variables.find((variable) => variable.name === "customerName");
    if (!designVariable || designVariable.type !== "string") {
      throw new Error("Expected the customerName test variable.");
    }
    project.variables[0] = {
      ...designVariable,
      name: "designTimeName",
      initial: "design-time edit",
    };

    expect(runtime.get("customerName", screenId)).toBe("screen value");
    expect(runtime.interpolate("{{customerName}} has {{visits}} visits.", screenId))
      .toBe("screen value has 1 visits.");
    runtime.set("customerName", "Lin", screenId);
    runtime.set("visits", 3);
    expect(runtime.interpolate("{{customerName}}: {{visits}}", screenId)).toBe("Lin: 3");
    expect(() => runtime.set("visits", "three")).toThrow(/must be number/);
    expect(() => runtime.set("unknown", 1)).toThrow(/Unknown variable/);
    runtime.reset();
    expect(runtime.get("customerName", screenId)).toBe("screen value");
    expect(runtime.get("visits")).toBe(1);
  });
});
