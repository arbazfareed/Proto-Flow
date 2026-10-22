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

function parseRepeaterValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new Error(
      `Repeater data must be valid JSON: ${error instanceof Error ? error.message : "invalid JSON"}`,
    );
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

  interpolate(text: string, screenId = this.screenId): string {
    return this.variables.interpolate(text, screenId);
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

  runEvent(widget: Widget, event: PreviewEvent): string[] {
    const screen = this.currentScreen;
    const errors: string[] = [];
    const rules = screen.interactionRules.filter((rule) =>
      rule.event === event && (!rule.widgetId || rule.widgetId === widget.id),
    );
    for (const rule of rules) {
      if (!this.conditionsMatch(rule, screen.id)) continue;
      try {
        this.runActions(rule, screen);
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

  private conditionsMatch(rule: InteractionRule, screenId: string): boolean {
    if (rule.conditions.length === 0) return true;
    const results = rule.conditions.map((condition) =>
      conditionMatches(condition, this.variables.get(condition.variable, screenId)),
    );
    return rule.conditionMode === "any"
      ? results.some(Boolean)
      : results.every(Boolean);
  }

  private runActions(rule: InteractionRule, screen: Screen): void {
    for (const action of rule.actions) {
      switch (action.type) {
        case "navigate":
        case "navigateTo":
          this.navigate(action.target);
          break;
        case "show":
        case "hide":
          if (!screen.widgets.some((item) => item.id === action.target)) {
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
            typeof action.value !== "string" &&
            typeof action.value !== "number" &&
            typeof action.value !== "boolean"
          ) {
            throw new Error(`A typed value is required for variable "${action.target}".`);
          }
          this.variables.set(action.target, action.value, screen.id);
          break;
        case "setPanelState":
          {
          const panel = this.requireWidget(screen, action.target, ["panel", "dynamic-panel", "dynamicPanel"]);
          if (typeof action.value !== "string" && typeof action.stateId !== "string") {
            throw new Error("Panel-state action requires a state ID or state name.");
          }
          const states = getPanelStates(panel);
          const state = states.find((item) =>
            item.id === action.stateId ||
            item.id === action.value ||
            item.name === action.value,
          );
          if (states.length > 0 && !state) {
            throw new Error(`Panel "${panel.id}" does not contain the requested state.`);
          }
          this.panelStates[action.target] = state?.id ?? String(action.stateId ?? action.value);
          this.panelTransitions[action.target] = {
            transition: action.transition ?? "none",
            duration: action.duration ?? 0,
          };
          break;
          }
        case "setRepeaterData":
          this.requireWidget(screen, action.target, ["repeater"]);
          this.repeaterData[action.target] = parseRepeaterValue(action.value);
          break;
        default:
          throw new Error(`Unsupported interaction action "${action.type}".`);
      }
    }
  }

  private requireWidget(screen: Screen, widgetId: string, acceptedTypes: string[]): Widget {
    const widget = collectWidgetsDeep(screen.widgets).find((item) => item.id === widgetId);
    if (!widget || !acceptedTypes.includes(widget.type)) {
      throw new Error(`Action target "${widgetId}" must be a ${acceptedTypes.join(" or ")} widget.`);
    }
    return widget;
  }
}
