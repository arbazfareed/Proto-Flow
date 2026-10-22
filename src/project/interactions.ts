import type {
  InteractionAction,
  InteractionCondition,
  InteractionLocalVariable,
  InteractionRule,
  Project,
  Screen,
  VariableDefinition,
  Widget,
} from "./schema";
import { isValidVariableName } from "./schema";
import { isValidInteractionLocalVariableName } from "./interactionSchema";
import { VariableRuntimeStore } from "./variables";
import { collectWidgetsDeep, getPanelStates } from "./dynamicPanels";
import { evaluateExpression } from "./expressions";

export type InteractionIssue = {
  severity: "error" | "warning";
  code: "unknown-target" | "self-visibility" | "navigation-cycle" | "type-mismatch" |
    "unused-local" | "invalid-local" | "duplicate-local";
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
  const trigger = collectWidgetsDeep(screen.widgets).find((widget) => widget.id === rule.widgetId);
  const localValues: Record<string, string | number | boolean> = Object.fromEntries(
    (rule.localVariables ?? []).map(({ name, initial }) => [name, initial]),
  );
  const getExpressionContext = () => ({
    variables: {
      ...Object.fromEntries(runtime.entries(screen.id)
        .filter(({ variable }) => variable.scope === "project")
        .map(({ variable, value }) => [variable.name, value])),
      ...Object.fromEntries(runtime.entries(screen.id)
        .filter(({ variable }) => variable.scope === "screen")
        .map(({ variable, value }) => [variable.name, value])),
      ...localValues,
    },
    widgets: collectWidgetsDeep(screen.widgets),
    thisWidget: trigger,
  });
  const expressionContext = {
    ...getExpressionContext(),
  };
  const conditionResults = rule.conditions.map((condition) => {
    if (/^\[\[[\s\S]*\]\]$/.test(condition.variable)) {
      try {
        return Boolean(evaluateExpression(condition.variable.slice(2, -2).trim(), expressionContext));
      } catch {
        return false;
      }
    }
    let expected = condition.value;
    if (typeof expected === "string") {
      const expression = /^\[\[([\s\S]*?)\]\]$/.exec(expected);
      if (expression) {
        try {
          expected = evaluateExpression(expression[1].trim(), expressionContext) as string | number | boolean;
        } catch {
          return false;
        }
      }
    }
    return compareValues(
      { ...condition, value: expected },
      Object.hasOwn(localValues, condition.variable)
        ? localValues[condition.variable]
        : runtime.get(condition.variable, screen.id),
    );
  });
  const matched = rule.conditions.length === 0
    ? true
    : rule.conditionMode === "any"
      ? conditionResults.some(Boolean)
      : conditionResults.every(Boolean);
  const actions = matched
    ? rule.actions.map((action) =>
      describeAction(project, screen, action, runtime, rule.localVariables ?? [], localValues, getExpressionContext),
    )
    : [];
  return { matched, conditionResults, actions };
}

function describeAction(
  project: Project,
  screen: Screen,
  action: InteractionAction,
  runtime: VariableRuntimeStore,
  localDefinitions: InteractionLocalVariable[],
  localValues: Record<string, string | number | boolean>,
  getExpressionContext: () => { variables: Record<string, unknown>; widgets: Widget[]; thisWidget: Widget | undefined },
): string {
  switch (action.type) {
    case "navigate":
    case "navigateTo": {
      const destination = project.screens.find((item) => item.id === action.target);
      return destination ? `Navigate to ${destination.name}` : `Unknown screen: ${action.target}`;
    }
    case "show":
    case "hide": {
      const widget = collectWidgetsDeep(screen.widgets).find((item) => item.id === action.target);
      return widget
        ? `${action.type === "show" ? "Show" : "Hide"} ${widget.name ?? widget.type}`
        : `Unknown widget: ${action.target}`;
    }
    case "setVariable": {
      const localVariable = localDefinitions.find((item) => item.name === action.target);
      if (localVariable) {
        let value: unknown = action.value;
        if (typeof value === "string") {
          const expression = /^\[\[([\s\S]*?)\]\]$/.exec(value);
          if (expression) {
            try {
              value = evaluateExpression(expression[1].trim(), getExpressionContext());
            } catch {
              return `Invalid expression for local variable ${localVariable.name}`;
            }
          }
        }
        if (!isRuntimeValue(value) || typeof value !== localVariable.type) {
          return `Invalid ${localVariable.type} value for local variable ${localVariable.name}`;
        }
        localValues[localVariable.name] = value;
        return `Set local ${localVariable.name} to ${String(value)}`;
      }
      const variable = getVariable(project.variables, action.target, screen.id);
      if (!variable) return `Unknown variable: ${action.target}`;
      let value: unknown = action.value;
      if (typeof value === "string") {
        const expression = /^\[\[([\s\S]*?)\]\]$/.exec(value);
        if (expression) {
          try {
            value = evaluateExpression(expression[1].trim(), {
              ...getExpressionContext(),
            });
          } catch {
            return `Invalid expression for ${variable.name}`;
          }
        }
      }
      if (!isRuntimeValue(value) || typeof value !== variable.type) {
        return `Invalid ${variable.type} value for ${variable.name}`;
      }
      runtime.set(variable.name, value, screen.id);
      return `Set ${variable.name} to ${String(value)}`;
    }
    case "setPanelState":
    case "setRepeaterData":
    case "addRepeaterRow":
    case "removeRepeaterRow":
    case "sortRepeater":
    case "filterRepeater":
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
        if (rule.widgetId && !collectWidgetsDeep(screen.widgets).some((widget) => widget.id === rule.widgetId)) {
          issues.push({
            severity: "error",
            code: "unknown-target",
            message: "Trigger must reference a widget on this screen.",
            ruleId: rule.id,
          });
        }
        for (const condition of rule.conditions) {
          if (/^\[\[[\s\S]*\]\]$/.test(condition.variable)) continue;
          const localVariable = rule.localVariables?.find((item) => item.name === condition.variable);
          const variable = localVariable ?? getVariable(project.variables, condition.variable, screen.id);
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
            const expressionValue = typeof condition.value === "string" &&
              /^\[\[[\s\S]*\]\]$/.test(condition.value);
            const mismatch = expressionValue
              ? false
              : numeric
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

      if (ownerScreen.id === screen.id) {
        const localVariables = rule.localVariables ?? [];
        const names = new Set(localVariables.map((variable) => variable.name));
        const declaredNames = new Set<string>();
        const referenced = new Set<string>();
        for (const localVariable of localVariables) {
          if (!isValidInteractionLocalVariableName(localVariable.name) || !isValidVariableName(localVariable.name)) {
            issues.push({
              severity: "error",
              code: "invalid-local",
              message: `Local variable "${localVariable.name}" must be a valid identifier.`,
              ruleId: rule.id,
            });
          }
          if (declaredNames.has(localVariable.name)) {
            issues.push({
              severity: "error",
              code: "duplicate-local",
              message: `Local variable "${localVariable.name}" is declared more than once.`,
              ruleId: rule.id,
            });
          }
          declaredNames.add(localVariable.name);
        }
        const markReferences = (value: unknown) => {
          if (typeof value !== "string") return;
          for (const name of names) {
            if (value === name || value.includes(`{{${name}}}`) ||
              new RegExp(`(^|[^\\w$])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\w$]|$)`).test(value)) {
              referenced.add(name);
            }
          }
        };
        for (const condition of rule.conditions) {
          markReferences(condition.variable);
          markReferences(condition.value);
        }
        for (const action of rule.actions) markReferences(action.value);
        for (const localVariable of localVariables) {
          const shadowed = getVariable(project.variables, localVariable.name, ownerScreen.id);
          if (shadowed && shadowed.type !== localVariable.type) {
            issues.push({
              severity: "warning",
              code: "type-mismatch",
              message: `Local variable "${localVariable.name}" shadows a ${shadowed.type} variable with type ${localVariable.type}.`,
              ruleId: rule.id,
            });
          }
          if (!referenced.has(localVariable.name)) {
            issues.push({
              severity: "warning",
              code: "unused-local",
              message: `Local variable "${localVariable.name}" is never read by this interaction.`,
              ruleId: rule.id,
            });
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
          action.type === "setPanelState" || ["setRepeaterData", "addRepeaterRow",
            "removeRepeaterRow", "sortRepeater", "filterRepeater"].includes(action.type)) {
          const targetScreen = project.screens.find((item) =>
            collectWidgetsDeep(item.widgets).some((widget) => widget.id === action.target),
          );
          const targetIsLocal = ownerScreen.id === screen.id &&
            collectWidgetsDeep(screen.widgets).some((widget) => widget.id === action.target);
          const targetWidget = targetScreen
            ? collectWidgetsDeep(targetScreen.widgets).find((widget) => widget.id === action.target)
            : undefined;
          const targetTypeMatches = action.type === "setPanelState"
            ? ["panel", "dynamic-panel", "dynamicPanel"].includes(targetWidget?.type ?? "")
            : ["setRepeaterData", "addRepeaterRow", "removeRepeaterRow",
              "sortRepeater", "filterRepeater"].includes(action.type)
              ? targetWidget?.type === "repeater"
              : true;
          if (!targetScreen || (ownerScreen.id === screen.id && !targetIsLocal) || !targetTypeMatches) {
            if (ownerScreen.id === screen.id) {
              issues.push({
                severity: "error",
                code: "unknown-target",
                message: action.type === "setPanelState"
                  ? "Panel-state action must target a panel on this screen."
                  : ["setRepeaterData", "addRepeaterRow", "removeRepeaterRow",
                    "sortRepeater", "filterRepeater"].includes(action.type)
                    ? "Repeater action must target a repeater on this screen."
                    : "Visibility action must target a widget on this screen.",
                ruleId: rule.id,
              });
            }
          } else if (ownerScreen.id === screen.id && action.type === "setPanelState" &&
            targetWidget && getPanelStates(targetWidget).length > 0 &&
            !getPanelStates(targetWidget).some((state) =>
              state.id === action.stateId ||
              state.id === action.value ||
              state.name === action.value,
            )) {
            issues.push({
              severity: "error",
              code: "unknown-target",
              message: "Panel-state action must choose a state belonging to its target panel.",
              ruleId: rule.id,
            });
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
          const localVariable = rule.localVariables?.find((item) => item.name === action.target);
          const variable = localVariable ?? getVariable(project.variables, action.target, ownerScreen.id);
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
            !(typeof action.value === "string" && /^\[\[[\s\S]*\]\]$/.test(action.value)) &&
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
    localVariables: [],
  };
}
