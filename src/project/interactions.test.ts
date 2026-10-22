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
