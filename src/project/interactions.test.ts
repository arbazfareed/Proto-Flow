import { describe, expect, it } from "vitest";
import { createEmptyProject, type InteractionRule, type Widget } from "./schema";
import {
  createInteractionRule,
  testInteractionRule,
  validateInteractionRules,
} from "./interactions";

function createWidget(): Widget {
  return {
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
    props: { label: "Button" },
  };
}

function createRule(widgetId: string, overrides: Partial<InteractionRule> = {}): InteractionRule {
  return {
    id: crypto.randomUUID(),
    widgetId,
    event: "onClick",
    conditionMode: "all",
    conditions: [],
    actions: [{ type: "navigate", target: "" }],
    ...overrides,
  };
}

describe("interaction rules", () => {
  it("creates a widget-bound rule with default event and action", () => {
    const rule = createInteractionRule(createWidget());
    expect(rule.widgetId).toBeDefined();
    expect(rule.event).toBe("onClick");
    expect(rule.conditionMode).toBe("all");
    expect(rule.actions[0].type).toBe("navigate");
  });

  it("tests all and any conditions against initial variable values", () => {
    const project = createEmptyProject();
    const screen = project.screens[0];
    project.variables.push({
      id: crypto.randomUUID(),
      name: "attempts",
      type: "number",
      initial: 2,
      scope: "project",
    });

    project.variables.push({
      id: crypto.randomUUID(),
      name: "enabled",
      type: "boolean",
      initial: false,
      scope: "project",
    });
    const conditions = [
      { variable: "attempts", operator: "greaterThan" as const, value: 1 },
      { variable: "enabled", operator: "equals" as const, value: true },
    ];

    const all = testInteractionRule(project, screen, createRule("trigger", { conditions }));
    expect(all).toMatchObject({ matched: false, conditionResults: [true, false] });
    const any = testInteractionRule(project, screen, createRule("trigger", {
      conditionMode: "any",
      conditions,
    }));
    expect(any).toMatchObject({ matched: true, conditionResults: [true, false] });
  });

  it("evaluates every comparison operator and safely rejects missing or mismatched values", () => {
    const project = createEmptyProject();
    const screen = project.screens[0];
    project.variables.push(
      { id: crypto.randomUUID(), name: "attempts", type: "number", initial: 3, scope: "project" },
      { id: crypto.randomUUID(), name: "name", type: "string", initial: "Grace", scope: "project" },
    );
    const result = testInteractionRule(project, screen, createRule("trigger", {
      conditions: [
        { variable: "attempts", operator: "equals", value: 3 },
        { variable: "attempts", operator: "notEquals", value: 4 },
        { variable: "attempts", operator: "greaterThan", value: 2 },
        { variable: "attempts", operator: "greaterThanOrEqual", value: 3 },
        { variable: "attempts", operator: "lessThan", value: 4 },
        { variable: "attempts", operator: "lessThanOrEqual", value: 3 },
        { variable: "name", operator: "contains", value: "rac" },
        { variable: "missing", operator: "equals", value: true },
        { variable: "name", operator: "greaterThan", value: 1 },
      ],
    }));

    expect(result.conditionResults).toEqual([
      true, true, true, true, true, true, true, false, false,
    ]);
    expect(result.matched).toBe(false);
  });

  it("tests expression conditions and typed expression actions", () => {
    const project = createEmptyProject();
    const screen = project.screens[0];
    project.variables.push({
      id: crypto.randomUUID(),
      name: "count",
      type: "number",
      initial: 3,
      scope: "project",
    });
    const trigger = createWidget();
    screen.widgets.push(trigger);
    const rule = createRule(trigger.id, {
      conditions: [{
        variable: "[[ count * 2 > 5 ]]",
        operator: "equals",
        value: true,
      }],
      actions: [{ type: "setVariable", target: "count", value: "[[ count + 4 ]]" }],
    });

    expect(testInteractionRule(project, screen, rule)).toMatchObject({
      matched: true,
      conditionResults: [true],
      actions: ["Set count to 7"],
    });
    screen.interactionRules = [rule];
    expect(validateInteractionRules(project, screen)).toEqual([]);
  });

  it("describes ordered navigation, visibility, panel, repeater, and variable actions", () => {
    const project = createEmptyProject();
    const screen = project.screens[0];
    const trigger = createWidget();
    const target = createWidget();
    const panel = {
      ...createWidget(),
      type: "dynamic-panel",
      props: { states: [{ id: crypto.randomUUID(), name: "Open", widgets: [] }] },
    };
    const repeater = { ...createWidget(), type: "repeater" };
    const destination = { ...screen, id: crypto.randomUUID(), name: "Checkout" };
    project.screens.push(destination);
    screen.widgets.push(trigger, target, panel, repeater);
    project.variables.push({
      id: crypto.randomUUID(),
      name: "attempts",
      type: "number",
      initial: 1,
      scope: "project",
    });
    const panelStateId = panel.props.states[0].id;
    const actions: InteractionRule["actions"] = [
      { type: "navigate", target: destination.id },
      { type: "navigateTo", target: "missing-screen" },
      { type: "show", target: target.id },
      { type: "hide", target: "missing-widget" },
      { type: "setPanelState", target: panel.id, stateId: panelStateId },
      { type: "setRepeaterData", target: repeater.id },
      { type: "addRepeaterRow", target: repeater.id },
      { type: "removeRepeaterRow", target: repeater.id },
      { type: "sortRepeater", target: repeater.id },
      { type: "filterRepeater", target: repeater.id },
      { type: "setVariable", target: "attempts", value: 4 },
      { type: "setVariable", target: "attempts", value: "invalid" },
      { type: "setVariable", target: "missing", value: 1 },
    ];

    expect(testInteractionRule(project, screen, createRule(trigger.id, { actions })).actions)
      .toEqual([
        "Navigate to Checkout",
        "Unknown screen: missing-screen",
        `Show ${target.type}`,
        "Unknown widget: missing-widget",
        `setPanelState for ${panel.id}`,
        `setRepeaterData for ${repeater.id}`,
        `addRepeaterRow for ${repeater.id}`,
        `removeRepeaterRow for ${repeater.id}`,
        `sortRepeater for ${repeater.id}`,
        `filterRepeater for ${repeater.id}`,
        "Set attempts to 4",
        "Invalid number value for attempts",
        "Unknown variable: missing",
      ]);
  });

  it("warns about type-mismatched shadowing and unread interaction variables", () => {
    const project = createEmptyProject();
    const screen = project.screens[0];
    project.variables.push({
      id: crypto.randomUUID(),
      name: "score",
      type: "string",
      initial: "project",
      scope: "project",
    });
    const rule = createRule("trigger", {
      localVariables: [
        { name: "score", type: "number", initial: 3 },
        { name: "unused", type: "boolean", initial: false },
      ],
      conditions: [{ variable: "score", operator: "greaterThan", value: 1 }],
      actions: [{ type: "setVariable", target: "score", value: "[[ score + 1 ]]" }],
    });
    screen.interactionRules = [rule];

    expect(validateInteractionRules(project, screen)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: "warning",
        code: "type-mismatch",
        message: expect.stringContaining('shadows a string variable with type number'),
      }),
      expect.objectContaining({
        severity: "warning",
        code: "unused-local",
        message: expect.stringContaining('Local variable "unused"'),
      }),
    ]));
    expect(testInteractionRule(project, screen, rule).actions).toEqual(["Set local score to 4"]);
  });

  it("reports missing targets, self-visibility, and navigation cycles", () => {
    const project = createEmptyProject();
    const first = project.screens[0];
    const firstWidget = createWidget();
    first.widgets.push(firstWidget);
    const second = {
      ...first,
      id: crypto.randomUUID(),
      name: "Second",
      widgets: [createWidget()],
      interactionRules: [] as InteractionRule[],
    };
    project.screens.push(second);
    const toSecond = createRule(firstWidget.id, {
      actions: [{ type: "navigate", target: second.id }],
    });
    const backToFirst = createRule(second.widgets[0].id, {
      actions: [{ type: "navigate", target: first.id }],
    });
    const selfHide = createRule(firstWidget.id, {
      actions: [{ type: "hide", target: firstWidget.id }],
    });
    const invalidTarget = createRule(firstWidget.id, {
      actions: [{ type: "show", target: crypto.randomUUID() }],
    });
    first.interactionRules = [toSecond, selfHide, invalidTarget];
    second.interactionRules = [backToFirst];

    const issues = validateInteractionRules(project, first);
    expect(issues.some((issue) => issue.code === "self-visibility")).toBe(true);
    expect(issues.some((issue) => issue.code === "unknown-target")).toBe(true);
    expect(issues.some((issue) => issue.code === "navigation-cycle")).toBe(true);
  });

  it("validates nested panel targets and rejects state IDs not owned by that panel", () => {
    const project = createEmptyProject();
    const screen = project.screens[0];
    const trigger = createWidget();
    const panel = {
      ...createWidget(),
      type: "dynamic-panel",
      props: {
        states: [{ id: crypto.randomUUID(), name: "Open", widgets: [] }],
      },
    };
    screen.widgets.push(trigger, panel);
    const rule = createRule(trigger.id, {
      actions: [{
        type: "setPanelState",
        target: panel.id,
        stateId: crypto.randomUUID(),
        transition: "fade",
        duration: 200,
      }],
    });
    screen.interactionRules = [rule];

    expect(validateInteractionRules(project, screen)).toEqual([
      expect.objectContaining({
        severity: "error",
        message: "Panel-state action must choose a state belonging to its target panel.",
      }),
    ]);
  });
});
