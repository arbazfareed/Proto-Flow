import { describe, expect, it } from "vitest";
import { createEmptyProject, type InteractionRule, type Project, type Widget } from "../project/schema";
import { PreviewRuntime } from "./runtime";
import { evaluateExpression } from "../project/expressions";

function makeWidget(type = "button"): Widget {
  return {
    id: crypto.randomUUID(),
    type,
    x: 20,
    y: 30,
    width: 120,
    height: 40,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    zIndex: 0,
    style: {},
    props: { label: type },
  };
}

function createProject(): Project {
  const project = createEmptyProject("Runtime tests");
  const first = project.screens[0];
  first.name = "Start";
  const second = {
    ...first,
    id: crypto.randomUUID(),
    name: "Next",
    widgets: [] as Widget[],
    interactionRules: [] as InteractionRule[],
  };
  const trigger = makeWidget();
  const target = makeWidget("rectangle");
  const panel = makeWidget("dynamic-panel");
  const repeater = makeWidget("repeater");
  first.widgets.push(trigger, target, panel, repeater);
  project.screens.push(second);
  project.variables.push({
    id: crypto.randomUUID(),
    name: "count",
    type: "number",
    initial: 0,
    scope: "project",
  });
  return project;
}

describe("PreviewRuntime", () => {
  it("evaluates ordered event rules and executes navigation, visibility, and variable actions", () => {
    const project = createProject();
    const screen = project.screens[0];
    const [trigger, target] = screen.widgets;
    screen.interactionRules = [{
      id: crypto.randomUUID(),
      widgetId: trigger.id,
      event: "onClick",
      conditionMode: "all",
      conditions: [{ variable: "count", operator: "equals", value: 0 }],
      actions: [
        { type: "setVariable", target: "count", value: 1 },
        { type: "hide", target: target.id },
        { type: "navigate", target: project.screens[1].id },
      ],
    }];

    const runtime = new PreviewRuntime(project);
    expect(runtime.runEvent(trigger, "onClick")).toEqual([]);
    expect(runtime.currentScreenId).toBe(project.screens[1].id);
    expect(runtime.snapshot().visibility[target.id]).toBe(false);
    expect(runtime.getVariable("count")).toBe(1);
    runtime.back();
    expect(runtime.currentScreenId).toBe(screen.id);
  });

  it("evaluates any-condition matching and reports invalid actions without throwing", () => {
    const project = createProject();
    const screen = project.screens[0];
    const trigger = screen.widgets[0];
    screen.interactionRules = [{
      id: crypto.randomUUID(),
      widgetId: trigger.id,
      event: "onTap",
      conditionMode: "any",
      conditions: [
        { variable: "count", operator: "greaterThan", value: 4 },
        { variable: "count", operator: "equals", value: 0 },
      ],
      actions: [{ type: "unsupported-action", target: "unknown" }],
    }];
    const runtime = new PreviewRuntime(project);
    expect(runtime.runEvent(trigger, "onTap")).toEqual([
      'Unsupported interaction action "unsupported-action".',
    ]);
    expect(runtime.currentScreenId).toBe(screen.id);
  });

  it("resets runtime state and preserves same-typed values through hot reload", () => {
    const project = createProject();
    const runtime = new PreviewRuntime(project);
    runtime.setVariable("count", 12);
    runtime.navigate(project.screens[1].id);

    const updated = structuredClone(project);
    updated.screens[0].widgets.push(makeWidget("text"));
    runtime.updateProject(updated);
    expect(runtime.getVariable("count")).toBe(12);
    expect(runtime.currentScreenId).toBe(project.screens[1].id);

    runtime.restart();
    expect(runtime.currentScreenId).toBe(project.startScreenId);
    expect(runtime.getVariable("count")).toBe(0);
    expect(runtime.snapshot().backStack).toEqual([]);
  });

  it("evaluates expressions in text, conditions, and typed interaction action values", () => {
    const project = createProject();
    const screen = project.screens[0];
    const trigger = screen.widgets[0];
    const card = { ...makeWidget("rectangle"), name: "Card", x: 17, width: 80 };
    screen.widgets.push(card);
    project.variables.push({
      id: crypto.randomUUID(),
      name: "total",
      type: "number",
      initial: 0,
      scope: "project",
    });
    screen.interactionRules = [{
      id: crypto.randomUUID(),
      widgetId: trigger.id,
      event: "onClick",
      conditions: [{
        variable: "[[count >= 0 && item.score > 2]]",
        operator: "equals",
        value: true,
      }],
      actions: [{
        type: "setVariable",
        target: "total",
        value: "[[count + item.score + Card.width + this.x]]",
      }],
    }];
    const runtime = new PreviewRuntime(project);
    expect(evaluateExpression("count + item.score + Card.width + this.x", runtime.expressionContext(trigger, { score: 4 }))).toBe(104);
    expect(runtime.interpolate("Total [[count * 3]], x [[Card.x]], row [[item.score]]", screen.id, {
      score: 4,
    }, trigger)).toBe("Total 0, x 17, row 4");
    expect(runtime.runEvent(trigger, "onClick", { score: 4 })).toEqual([]);
    expect(runtime.getVariable("total")).toBe(104);
  });

  it("reports invalid expressions as interaction errors without changing runtime state", () => {
    const project = createProject();
    const screen = project.screens[0];
    const trigger = screen.widgets[0];
    screen.interactionRules = [{
      id: crypto.randomUUID(),
      widgetId: trigger.id,
      event: "onClick",
      conditions: [],
      actions: [{
        type: "setVariable",
        target: "count",
        value: "[[unknownFunction()]]",
      }],
    }];
    const runtime = new PreviewRuntime(project);
    expect(runtime.runEvent(trigger, "onClick")).toEqual([
      'Unknown expression function "unknownFunction".',
    ]);
    expect(runtime.getVariable("count")).toBe(0);
  });

  it("applies panel-state and repeater-data actions to compatible targets", () => {
    const project = createProject();
    const screen = project.screens[0];
    const trigger = screen.widgets[0];
    const panel = screen.widgets.find((widget) => widget.type === "dynamic-panel");
    const repeater = screen.widgets.find((widget) => widget.type === "repeater");
    if (!panel || !repeater) throw new Error("Test fixture is missing advanced widgets.");
    screen.interactionRules = [{
      id: crypto.randomUUID(),
      widgetId: trigger.id,
      event: "onClick",
      conditions: [],
      actions: [
        { type: "setPanelState", target: panel.id, value: "expanded" },
        { type: "setRepeaterData", target: repeater.id, value: '[{"name":"A"}]' },
      ],
    }];
    const runtime = new PreviewRuntime(project);
    expect(runtime.runEvent(trigger, "onClick")).toEqual([]);
    expect(runtime.snapshot().panelStates[panel.id]).toBe("expanded");
    expect(runtime.snapshot().repeaterData[repeater.id]).toEqual([{ name: "A" }]);
  });

  it("supports repeater add, remove, sort, filter, and item-context interpolation", () => {
    const project = createProject();
    const screen = project.screens[0];
    const trigger = screen.widgets[0];
    const repeater = screen.widgets.find((widget) => widget.type === "repeater");
    if (!repeater) throw new Error("Test fixture is missing a repeater.");
    repeater.props.dataset = [{ name: "B", active: true }, { name: "A", active: false }];
    screen.interactionRules = [
      {
        id: crypto.randomUUID(),
        widgetId: trigger.id,
        event: "onClick",
        conditions: [],
        actions: [
          { type: "sortRepeater", target: repeater.id, value: '{"field":"name","direction":"asc"}' },
          { type: "addRepeaterRow", target: repeater.id, value: '{"name":"{{item.name}}"}' },
        ],
      },
      {
        id: crypto.randomUUID(),
        widgetId: trigger.id,
        event: "onTap",
        conditions: [],
        actions: [
          { type: "filterRepeater", target: repeater.id, value: '{"field":"active","operator":"equals","value":true}' },
          { type: "removeRepeaterRow", target: repeater.id, value: 0 },
        ],
      },
    ];
    const runtime = new PreviewRuntime(project);
    expect(runtime.runEvent(trigger, "onClick", { name: "C" })).toEqual([]);
    expect(runtime.snapshot().repeaterData[repeater.id]).toEqual([
      { name: "A", active: false },
      { name: "B", active: true },
      { name: "C" },
    ]);

    expect(runtime.runEvent(trigger, "onTap")).toEqual([]);
    expect(runtime.snapshot().repeaterData[repeater.id]).toEqual([]);
  });

  it("switches a nested dynamic panel to a validated state with transition metadata", () => {
    const project = createProject();
    const screen = project.screens[0];
    const trigger = screen.widgets[0];
    const panel = screen.widgets.find((widget) => widget.type === "dynamic-panel");
    if (!panel) throw new Error("Test fixture is missing a dynamic panel.");
    const initial = { id: crypto.randomUUID(), name: "Closed", widgets: [] as Widget[] };
    const expanded = {
      id: crypto.randomUUID(),
      name: "Expanded",
      widgets: [makeWidget("text")],
    };
    panel.props = { states: [initial, expanded], activeStateId: initial.id };
    const nestedTrigger = expanded.widgets[0];
    screen.interactionRules = [{
      id: crypto.randomUUID(),
      widgetId: trigger.id,
      event: "onClick",
      conditions: [],
      actions: [{
        type: "setPanelState",
        target: panel.id,
        stateId: expanded.id,
        transition: "slide-left",
        duration: 250,
      }],
    }];

    const runtime = new PreviewRuntime(project);
    expect(runtime.snapshot().visibility[nestedTrigger.id]).toBe(true);
    expect(runtime.runEvent(trigger, "onClick")).toEqual([]);
    expect(runtime.snapshot().panelStates[panel.id]).toBe(expanded.id);
    expect(runtime.snapshot().panelTransitions[panel.id]).toEqual({
      transition: "slide-left",
      duration: 250,
    });
    expect(runtime.runEvent(trigger, "onClick")).toEqual([]);
  });
});
