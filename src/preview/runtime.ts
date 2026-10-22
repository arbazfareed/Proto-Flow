import type {
  InteractionCondition,
  InteractionRule,
  Project,
  Screen,
  VariableDefinition,
  Widget,
} from "../project/schema";
import {
  VariableRuntimeStore,
  type RuntimeVariableValue,
} from "../project/variables";
import {
  collectWidgetsDeep,
  getPanelStates,
  type PanelTransition,
} from "../project/dynamicPanels";
import {
  getRepeaterDataset,
  interpolateItem,
  parseRepeaterDataset,
  type RepeaterRecord,
} from "../project/repeaters";
import { evaluateExpression, interpolateExpressions } from "../project/expressions";

function resolveExpressionValue(
  value: unknown,
  context: import("../project/expressions").ExpressionContext,
  item?: RepeaterRecord,
): unknown {
  if (typeof value === "string") {
    const withItem = item ? interpolateItem(value, item) : value;
    const wholeExpression = /^\[\[([\s\S]*?)\]\]$/.exec(withItem);
    if (wholeExpression) return evaluateExpression(wholeExpression[1].trim(), context);
    return interpolateExpressions(withItem, context);
  }
  if (Array.isArray(value)) return value.map((entry) => resolveExpressionValue(entry, context, item));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key,
      resolveExpressionValue(entry, context, item),
    ]));
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface RepeaterActionConfig extends Record<string, unknown> {
  field: string;
}

function parseRepeaterActionConfig(
  value: unknown,
  action: "sort" | "filter",
): RepeaterActionConfig {
  let config = value;
  if (typeof config === "string") {
    try {
      config = JSON.parse(config) as unknown;
    } catch (error) {
      throw new Error(`Repeater ${action} action must be valid JSON: ${error instanceof Error ? error.message : "invalid JSON"}`);
    }
  }
  if (!isRecord(config) || typeof config.field !== "string") {
    throw new Error(`Repeater ${action} action requires a field name.`);
  }
  return { ...config, field: config.field };
}

export type PreviewEvent =
  | "onClick"
  | "onHover"
  | "onChange"
  | "onLoad"
  | "onTap"
  | "onTouchStart"
  | "onTouchEnd";

export interface PreviewRuntimeSnapshot {
  screenId: string;
  backStack: string[];
  visibility: Record<string, boolean>;
  panelStates: Record<string, string>;
  panelTransitions: Record<string, { transition: PanelTransition; duration: number }>;
  repeaterData: Record<string, unknown>;
  variables: Array<{ variable: VariableDefinition; value: RuntimeVariableValue }>;
}

function conditionMatches(
  condition: InteractionCondition,
  value: RuntimeVariableValue | undefined,
): boolean {
  if (value === undefined) return false;
  switch (condition.operator) {
    case "equals":
      return value === condition.value;
    case "notEquals":
      return value !== condition.value;
    case "greaterThan":
      return typeof value === "number" && typeof condition.value === "number" &&
        value > condition.value;
    case "greaterThanOrEqual":
      return typeof value === "number" && typeof condition.value === "number" &&
        value >= condition.value;
    case "lessThan":
      return typeof value === "number" && typeof condition.value === "number" &&
        value < condition.value;
    case "lessThanOrEqual":
      return typeof value === "number" && typeof condition.value === "number" &&
        value <= condition.value;
    case "contains":
      return typeof value === "string" && typeof condition.value === "string" &&
        value.includes(condition.value);
  }
}

export class PreviewRuntime {
  private project: Project;
  private readonly variables: VariableRuntimeStore;
  private screenId: string;
  private backStack: string[] = [];
  private visibility: Record<string, boolean>;
  private panelStates: Record<string, string> = {};
  private panelTransitions: Record<string, { transition: PanelTransition; duration: number }> = {};
  private repeaterData: Record<string, unknown> = {};

  constructor(project: Project) {
    this.project = structuredClone(project);
    this.variables = new VariableRuntimeStore(project.variables);
    this.screenId = project.startScreenId;
    this.visibility = Object.fromEntries(
      project.screens.flatMap((screen) =>
        collectWidgetsDeep(screen.widgets).map((widget) => [widget.id, widget.visible]),
      ),
    );
  }

  get currentScreen(): Screen {
    const screen = this.project.screens.find((item) => item.id === this.screenId);
    if (!screen) throw new Error(`Preview screen "${this.screenId}" no longer exists.`);
    return screen;
  }

  get currentScreenId(): string {
    return this.screenId;
  }

  updateProject(project: Project): void {
    this.project = structuredClone(project);
    this.variables.updateDefinitions(project.variables);
    const widgetIds = new Set(project.screens.flatMap((screen) =>
      collectWidgetsDeep(screen.widgets).map((widget) => widget.id),
    ));
    this.visibility = Object.fromEntries(
      Object.entries(this.visibility).filter(([widgetId]) => widgetIds.has(widgetId)),
    );
    for (const screen of project.screens) {
      for (const widget of collectWidgetsDeep(screen.widgets)) {
        this.visibility[widget.id] ??= widget.visible;
      }
    }
    this.panelStates = Object.fromEntries(
      Object.entries(this.panelStates).filter(([widgetId]) => widgetIds.has(widgetId)),
    );
    this.panelTransitions = Object.fromEntries(
      Object.entries(this.panelTransitions).filter(([widgetId]) => widgetIds.has(widgetId)),
    );
    this.repeaterData = Object.fromEntries(
      Object.entries(this.repeaterData).filter(([widgetId]) => widgetIds.has(widgetId)),
    );
    const screenIds = new Set(project.screens.map((screen) => screen.id));
    this.backStack = this.backStack.filter((id) => screenIds.has(id));
    if (!screenIds.has(this.screenId)) {
      this.screenId = screenIds.has(project.startScreenId)
        ? project.startScreenId
        : project.screens[0].id;
      this.backStack = [];
    }
  }

  restart(): void {
    this.variables.reset();
    this.screenId = this.project.startScreenId;
    this.backStack = [];
    this.visibility = Object.fromEntries(
      this.project.screens.flatMap((screen) =>
        collectWidgetsDeep(screen.widgets).map((widget) => [widget.id, widget.visible]),
      ),
    );
    this.panelStates = {};
    this.panelTransitions = {};
    this.repeaterData = {};
  }

  navigate(screenId: string): void {
    if (!this.project.screens.some((screen) => screen.id === screenId)) {
      throw new Error(`Cannot navigate to unknown screen "${screenId}".`);
    }
    if (screenId === this.screenId) return;
    this.backStack.push(this.screenId);
    this.screenId = screenId;
  }

  back(): void {
    const previous = this.backStack.pop();
    if (previous) this.screenId = previous;
  }

  getVariable(name: string, screenId = this.screenId): RuntimeVariableValue | undefined {
    return this.variables.get(name, screenId);
  }

  setVariable(name: string, value: RuntimeVariableValue, screenId = this.screenId): void {
    this.variables.set(name, value, screenId);
  }

  interpolate(text: string, screenId = this.screenId, item?: RepeaterRecord, widget?: Widget): string {
    const contextualText = item ? interpolateItem(text, item) : text;
    return interpolateExpressions(
      this.variables.interpolate(contextualText, screenId),
      this.expressionContext(widget, item),
    );
  }

  expressionContext(widget?: Widget, item?: RepeaterRecord) {
    const variables = Object.fromEntries(this.variables.entries(this.screenId)
      .map(({ variable, value }) => [variable.name, value]));
    return {
      variables,
      widgets: collectWidgetsDeep(this.currentScreen.widgets),
      item,
      thisWidget: widget,
    };
  }

  snapshot(): PreviewRuntimeSnapshot {
    return {
      screenId: this.screenId,
      backStack: [...this.backStack],
      visibility: { ...this.visibility },
      panelStates: { ...this.panelStates },
      panelTransitions: { ...this.panelTransitions },
      repeaterData: structuredClone(this.repeaterData),
      variables: this.variables.entries(this.screenId),
    };
  }

  runEvent(widget: Widget, event: PreviewEvent, item?: RepeaterRecord): string[] {
    const screen = this.currentScreen;
    const errors: string[] = [];
    const rules = screen.interactionRules.filter((rule) =>
      rule.event === event && (!rule.widgetId || rule.widgetId === widget.id),
    );
    for (const rule of rules) {
      if (!this.conditionsMatch(rule, screen.id, item, widget)) continue;
      try {
        this.runActions(rule, screen, item, widget);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "Interaction action failed.");
      }
    }
    return errors;
  }

  updateBoundVariable(widget: Widget, value: RuntimeVariableValue): void {
    const variableName = widget.props.variableName ?? widget.props.variable;
    if (typeof variableName !== "string") return;
    const definition = this.project.variables.find((item) =>
      item.scope === "screen" && item.screenId === this.screenId && item.name === variableName,
    ) ?? this.project.variables.find((item) =>
      item.scope === "project" && item.name === variableName,
    );
    if (!definition) return;
    this.variables.set(variableName, value, this.screenId);
  }

  private conditionsMatch(
    rule: InteractionRule,
    screenId: string,
    item?: RepeaterRecord,
    widget?: Widget,
  ): boolean {
    if (rule.conditions.length === 0) return true;
    const results = rule.conditions.map((condition) => {
      const directExpression = /^\[\[([\s\S]*?)\]\]$/.exec(condition.variable);
      if (directExpression) {
        try {
          return Boolean(evaluateExpression(directExpression[1].trim(), this.expressionContext(widget, item)));
        } catch {
          return false;
        }
      }
      let value: RuntimeVariableValue | undefined = this.variables.get(condition.variable, screenId);
      if (typeof condition.value === "string") {
        const expression = /^\[\[([\s\S]*?)\]\]$/.exec(condition.value);
        if (expression) {
          try {
            const evaluated = evaluateExpression(expression[1].trim(), this.expressionContext(widget, item));
            value = typeof evaluated === "string" || typeof evaluated === "number" || typeof evaluated === "boolean"
              ? evaluated
              : undefined;
          } catch {
            value = undefined;
          }
        }
      }
      return conditionMatches(condition, value);
    });
    return rule.conditionMode === "any"
      ? results.some(Boolean)
      : results.every(Boolean);
  }

  private runActions(rule: InteractionRule, screen: Screen, item?: RepeaterRecord, widget?: Widget): void {
    for (const action of rule.actions) {
      const actionValue = resolveExpressionValue(action.value, this.expressionContext(widget, item), item);
      switch (action.type) {
        case "navigate":
        case "navigateTo":
          this.navigate(action.target);
          break;
        case "show":
        case "hide":
          if (!collectWidgetsDeep(screen.widgets).some((item) => item.id === action.target)) {
            throw new Error(`Visibility action target "${action.target}" is missing.`);
          }
          this.visibility[action.target] = action.type === "show";
          break;
        case "setVariable":
          if (!this.project.variables.some((item) =>
            item.scope === "project"
              ? item.name === action.target
              : item.screenId === screen.id && item.name === action.target,
          )) {
            throw new Error(`Variable "${action.target}" is missing.`);
          }
          if (
            typeof actionValue !== "string" &&
            typeof actionValue !== "number" &&
            typeof actionValue !== "boolean"
          ) {
            throw new Error(`A typed value is required for variable "${action.target}".`);
          }
          this.variables.set(action.target, actionValue, screen.id);
          break;
        case "setPanelState":
          {
          const panel = this.requireWidget(screen, action.target, ["panel", "dynamic-panel", "dynamicPanel"]);
          if (typeof actionValue !== "string" && typeof action.stateId !== "string") {
            throw new Error("Panel-state action requires a state ID or state name.");
          }
          const states = getPanelStates(panel);
          const state = states.find((item) =>
            item.id === action.stateId ||
            item.id === actionValue ||
            item.name === actionValue,
          );
          if (states.length > 0 && !state) {
            throw new Error(`Panel "${panel.id}" does not contain the requested state.`);
          }
          this.panelStates[action.target] = state?.id ?? String(action.stateId ?? actionValue);
          this.panelTransitions[action.target] = {
            transition: action.transition ?? "none",
            duration: action.duration ?? 0,
          };
          break;
          }
        case "setRepeaterData":
          {
          this.requireWidget(screen, action.target, ["repeater"]);
          this.repeaterData[action.target] = parseRepeaterDataset(
            actionValue,
          );
          break;
          }
        case "addRepeaterRow":
          {
          const repeater = this.requireWidget(screen, action.target, ["repeater"]);
          const rows = this.getRepeaterRows(repeater);
          let row = actionValue;
          if (typeof row === "string") {
            try {
              row = JSON.parse(row) as unknown;
            } catch (error) {
              throw new Error(`Repeater row must be a JSON object: ${error instanceof Error ? error.message : "invalid JSON"}`);
            }
          }
          if (!isRecord(row)) throw new Error("Repeater row must be an object.");
          this.repeaterData[action.target] = parseRepeaterDataset([
            ...rows,
            row,
          ]);
          break;
          }
        case "removeRepeaterRow":
          {
          const repeater = this.requireWidget(screen, action.target, ["repeater"]);
          const rows = this.getRepeaterRows(repeater);
          const index = Number(actionValue);
          if (!Number.isInteger(index) || index < 0 || index >= rows.length) {
            throw new Error("Repeater row index must reference an existing row.");
          }
          this.repeaterData[action.target] = rows.filter((_row, rowIndex) => rowIndex !== index);
          break;
          }
        case "sortRepeater":
          {
          const repeater = this.requireWidget(screen, action.target, ["repeater"]);
          const config = parseRepeaterActionConfig(actionValue, "sort");
          const field = config.field;
          const direction = config.direction === "desc" ? -1 : 1;
          this.repeaterData[action.target] = this.getRepeaterRows(repeater).slice().sort((first, second) =>
            String(first[field] ?? "").localeCompare(String(second[field] ?? ""), undefined, { numeric: true }) * direction,
          );
          break;
          }
        case "filterRepeater":
          {
          const repeater = this.requireWidget(screen, action.target, ["repeater"]);
          const config = parseRepeaterActionConfig(actionValue, "filter");
          const field = config.field;
          const operator = typeof config.operator === "string" ? config.operator : "equals";
          const expected = config.value;
          this.repeaterData[action.target] = this.getRepeaterRows(repeater).filter((row) => {
            const actual = row[field];
            switch (operator) {
              case "notEquals": return actual !== expected;
              case "contains": return typeof actual === "string" && actual.includes(String(expected ?? ""));
              case "greaterThan": return typeof actual === "number" && typeof expected === "number" && actual > expected;
              case "lessThan": return typeof actual === "number" && typeof expected === "number" && actual < expected;
              default: return actual === expected;
            }
          });
          break;
          }
        default:
          throw new Error(`Unsupported interaction action "${action.type}".`);
      }
    }
  }

  private getRepeaterRows(widget: Widget): RepeaterRecord[] {
    return this.repeaterData[widget.id] === undefined
      ? getRepeaterDataset(widget)
      : parseRepeaterDataset(this.repeaterData[widget.id]);
  }

  private requireWidget(screen: Screen, widgetId: string, acceptedTypes: string[]): Widget {
    const widget = collectWidgetsDeep(screen.widgets).find((item) => item.id === widgetId);
    if (!widget || !acceptedTypes.includes(widget.type)) {
      throw new Error(`Action target "${widgetId}" must be a ${acceptedTypes.join(" or ")} widget.`);
    }
    return widget;
  }
}
