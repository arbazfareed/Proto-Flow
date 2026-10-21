import type {
  InteractionAction,
  InteractionCondition,
  InteractionRule,
  Project,
  Screen,
  VariableDefinition,
  Widget,
} from "./schema";
import { VariableRuntimeStore } from "./variables";

export type InteractionIssue = {
  severity: "error" | "warning";
  code: "unknown-target" | "self-visibility" | "navigation-cycle" | "type-mismatch";
  message: string;
  ruleId: string;
};

export type InteractionTestResult = {
  matched: boolean;
  conditionResults: boolean[];
  actions: string[];
};

function isRuntimeValue(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function getVariable(
  variables: VariableDefinition[],
  name: string,
  screenId: string,
): VariableDefinition | undefined {
  return variables.find(
    (variable) => variable.scope === "screen" && variable.screenId === screenId &&
      variable.name === name,
  ) ?? variables.find(
    (variable) => variable.scope === "project" && variable.name === name,
  );
}

function compareValues(
  condition: InteractionCondition,
  value: string | number | boolean | undefined,
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

export function testInteractionRule(
  project: Project,
  screen: Screen,
  rule: InteractionRule,
): InteractionTestResult {
  const runtime = new VariableRuntimeStore(project.variables);
  const conditionResults = rule.conditions.map((condition) =>
    compareValues(condition, runtime.get(condition.variable, screen.id)),
  );
  const matched = rule.conditions.length === 0
    ? true
    : rule.conditionMode === "any"
      ? conditionResults.some(Boolean)
      : conditionResults.every(Boolean);
  const actions = matched
    ? rule.actions.map((action) => describeAction(project, screen, action, runtime))
    : [];
  return { matched, conditionResults, actions };
}

function describeAction(
  project: Project,
  screen: Screen,
  action: InteractionAction,
  runtime: VariableRuntimeStore,
): string {
  switch (action.type) {
    case "navigate":
    case "navigateTo": {
      const destination = project.screens.find((item) => item.id === action.target);
      return destination ? `Navigate to ${destination.name}` : `Unknown screen: ${action.target}`;
    }
    case "show":
    case "hide": {
      const widget = screen.widgets.find((item) => item.id === action.target);
      return widget
        ? `${action.type === "show" ? "Show" : "Hide"} ${widget.name ?? widget.type}`
        : `Unknown widget: ${action.target}`;
    }
    case "setVariable": {
      const variable = getVariable(project.variables, action.target, screen.id);
      if (!variable) return `Unknown variable: ${action.target}`;
      if (!isRuntimeValue(action.value) || typeof action.value !== variable.type) {
        return `Invalid ${variable.type} value for ${variable.name}`;
      }
      runtime.set(variable.name, action.value, screen.id);
      return `Set ${variable.name} to ${String(action.value)}`;
    }
    case "setPanelState":
    case "setRepeaterData":
      return `${action.type} for ${action.target}`;
    default:
      return `Unsupported action: ${action.type}`;
  }
}

export function validateInteractionRules(project: Project, screen: Screen): InteractionIssue[] {
  const issues: InteractionIssue[] = [];
  const navigation = new Map<string, Set<string>>();
  for (const ownerScreen of project.screens) {
    for (const rule of ownerScreen.interactionRules) {
      if (ownerScreen.id === screen.id) {
        if (rule.widgetId && !screen.widgets.some((widget) => widget.id === rule.widgetId)) {
          issues.push({
            severity: "error",
            code: "unknown-target",
            message: "Trigger must reference a widget on this screen.",
            ruleId: rule.id,
          });
        }
        for (const condition of rule.conditions) {
          const variable = getVariable(project.variables, condition.variable, screen.id);
          if (!variable) {
            issues.push({
              severity: "error",
              code: "unknown-target",
              message: `Unknown condition variable "${condition.variable}".`,
              ruleId: rule.id,
            });
          } else {
            const numeric = ["greaterThan", "greaterThanOrEqual", "lessThan", "lessThanOrEqual"]
              .includes(condition.operator);
            const mismatch = numeric
              ? variable.type !== "number" || typeof condition.value !== "number"
              : condition.operator === "contains"
                ? variable.type !== "string" || typeof condition.value !== "string"
                : typeof condition.value !== variable.type;
            if (mismatch) {
              issues.push({
                severity: "warning",
                code: "type-mismatch",
                message: `Condition value does not match the ${variable.type} variable "${variable.name}".`,
                ruleId: rule.id,
              });
            }
          }
        }
      }

      for (const action of rule.actions) {
        if (!action.target.trim()) {
          if (ownerScreen.id === screen.id) {
            issues.push({
              severity: "error",
              code: "unknown-target",
              message: "Choose a target for every action.",
              ruleId: rule.id,
            });
          }
          continue;
        }
        if (action.type === "navigate" || action.type === "navigateTo") {
          if (!project.screens.some((item) => item.id === action.target)) {
            if (ownerScreen.id === screen.id) {
              issues.push({
                severity: "error",
                code: "unknown-target",
                message: "Navigation action must target an existing screen.",
                ruleId: rule.id,
              });
            }
          } else {
            const targets = navigation.get(ownerScreen.id) ?? new Set<string>();
            targets.add(action.target);
            navigation.set(ownerScreen.id, targets);
          }
        } else if (action.type === "show" || action.type === "hide" ||
          action.type === "setPanelState" || action.type === "setRepeaterData") {
          const targetScreen = project.screens.find((item) =>
            item.widgets.some((widget) => widget.id === action.target),
          );
          const targetIsLocal = ownerScreen.id === screen.id &&
            screen.widgets.some((widget) => widget.id === action.target);
          const targetWidget = targetScreen?.widgets.find((widget) => widget.id === action.target);
          const targetTypeMatches = action.type === "setPanelState"
            ? ["panel", "dynamic-panel", "dynamicPanel"].includes(targetWidget?.type ?? "")
            : action.type === "setRepeaterData"
              ? targetWidget?.type === "repeater"
              : true;
          if (!targetScreen || (ownerScreen.id === screen.id && !targetIsLocal) || !targetTypeMatches) {
            if (ownerScreen.id === screen.id) {
              issues.push({
                severity: "error",
                code: "unknown-target",
                message: action.type === "setPanelState"
                  ? "Panel-state action must target a panel on this screen."
                  : action.type === "setRepeaterData"
                    ? "Repeater-data action must target a repeater on this screen."
                    : "Visibility action must target a widget on this screen.",
                ruleId: rule.id,
              });
            }
          } else if (
            ownerScreen.id === screen.id &&
            (action.type === "show" || action.type === "hide") &&
            rule.widgetId === action.target
          ) {
            issues.push({
              severity: "warning",
              code: "self-visibility",
              message: `This rule ${action.type}s its own trigger widget.`,
              ruleId: rule.id,
            });
          }
        } else if (action.type === "setVariable") {
          const variable = getVariable(project.variables, action.target, ownerScreen.id);
          if (!variable) {
            if (ownerScreen.id === screen.id) {
              issues.push({
                severity: "error",
                code: "unknown-target",
                message: "Variable action must target an existing variable.",
                ruleId: rule.id,
              });
            }
          } else if (
            ownerScreen.id === screen.id &&
            action.value !== undefined &&
            typeof action.value !== variable.type
          ) {
            issues.push({
              severity: "warning",
              code: "type-mismatch",
              message: `Action value must be ${variable.type} for "${variable.name}".`,
              ruleId: rule.id,
            });
          }
        }
      }
    }
  }

  const reaches = (from: string, target: string, seen = new Set<string>()): boolean => {
    if (from === target) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    for (const next of navigation.get(from) ?? []) {
      if (reaches(next, target, seen)) return true;
    }
    return false;
  };
  for (const [source, targets] of navigation) {
    for (const target of targets) {
      if (source === target || reaches(target, source)) {
        for (const rule of project.screens.find((item) => item.id === source)?.interactionRules.filter((item) =>
          item.actions.some((action) =>
            (action.type === "navigate" || action.type === "navigateTo") &&
            action.target === target,
          ),
        ) ?? []) {
          issues.push({
            severity: "warning",
            code: "navigation-cycle",
            message: "Navigation may create a loop between screens.",
            ruleId: rule.id,
          });
        }
      }
    }
  }
  return issues;
}

export function createInteractionRule(widget: Widget): InteractionRule {
  return {
    id: crypto.randomUUID(),
    widgetId: widget.id,
    event: "onClick",
    conditionMode: "all",
    conditions: [],
    actions: [{ type: "navigate", target: "" }],
  };
}
