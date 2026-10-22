import type { Project, VariableDefinition } from "./schema";

export type VariableIssue = {
  severity: "error" | "warning";
  code: "unknown-reference" | "unused-variable" | "type-mismatch";
  message: string;
  path: string;
};

const VARIABLE_REFERENCE = /\{\{\s*([A-Za-z_$][\w$]*)\s*\}\}/g;

export function getVariableCompletions(
  project: Project,
  screenId: string,
  text: string,
  cursor: number,
): { start: number; end: number; query: string; variables: VariableDefinition[] } | null {
  const beforeCursor = text.slice(0, cursor);
  const match = /\{\{\s*([A-Za-z_$][\w$]*)?$/.exec(beforeCursor);
  if (!match) return null;
  const query = match[1] ?? "";
  const matches = project.variables.filter((variable) =>
    (variable.scope === "project" ||
      (variable.scope === "screen" && variable.screenId === screenId)) &&
    variable.name.toLowerCase().startsWith(query.toLowerCase()),
  ).sort((first, second) =>
    first.scope === second.scope
      ? first.name.localeCompare(second.name)
      : first.scope === "screen" ? -1 : 1,
  );
  const seenNames = new Set<string>();
  const variables = matches.filter((variable) => {
    if (seenNames.has(variable.name)) return false;
    seenNames.add(variable.name);
    return true;
  });
  return {
    start: cursor - match[0].length,
    end: cursor,
    query,
    variables,
  };
}

function getVariable(
  variables: VariableDefinition[],
  name: string,
  screenId?: string,
): VariableDefinition | undefined {
  return variables.find(
    (variable) => variable.scope === "screen" &&
      variable.screenId === screenId &&
      variable.name === name,
  ) ?? variables.find(
    (variable) => variable.scope === "project" && variable.name === name,
  );
}

function collectStrings(value: unknown, path: string): Array<{ value: string; path: string }> {
  if (typeof value === "string") return [{ value, path }];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectStrings(item, `${path}[${index}]`));
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, item]) =>
      collectStrings(item, `${path}.${key}`),
    );
  }
  return [];
}

export function getVariableReferenceCount(
  project: Project,
  variableId: string,
): number {
  let count = 0;
  const countReferences = (value: unknown, screenId?: string) => {
    for (const entry of collectStrings(value, "")) {
      for (const match of entry.value.matchAll(VARIABLE_REFERENCE)) {
        const name = match[1];
        if (name && getVariable(project.variables, name, screenId)?.id === variableId) {
          count += 1;
        }
      }
    }
  };
  for (const screen of project.screens) {
    for (const widget of screen.widgets) countReferences(widget.props, screen.id);
  }
  for (const symbol of project.symbols) {
    for (const widget of symbol.widgets) countReferences(widget.props);
  }
  return count;
}

export function validateVariableReferences(project: Project): VariableIssue[] {
  const issues: VariableIssue[] = [];
  const used = new Set<string>();
  const checkText = (value: unknown, path: string, screenId?: string) => {
    for (const entry of collectStrings(value, path)) {
      for (const match of entry.value.matchAll(VARIABLE_REFERENCE)) {
        const name = match[1];
        if (!name) continue;
        const variable = getVariable(project.variables, name, screenId);
        if (!variable) {
          issues.push({
            severity: "error",
            code: "unknown-reference",
            message: `Unknown variable "${name}".`,
            path: entry.path,
          });
          continue;
        }
        used.add(variable.id);
      }
    }
  };

  project.screens.forEach((screen, screenIndex) => {
    screen.widgets.forEach((widget, widgetIndex) => {
      checkText(
        widget.props,
        `screens[${screenIndex}].widgets[${widgetIndex}].props`,
        screen.id,
      );
    });
    screen.interactionRules.forEach((rule, ruleIndex) => {
      rule.conditions.forEach((condition, conditionIndex) => {
        if (/^\[\[[\s\S]*\]\]$/.test(condition.variable)) return;
        const variable = getVariable(project.variables, condition.variable, screen.id);
        const path = `screens[${screenIndex}].interactionRules[${ruleIndex}].conditions[${conditionIndex}]`;
        if (!variable) {
          issues.push({
            severity: "error",
            code: "unknown-reference",
            message: `Unknown variable "${condition.variable}" in interaction condition.`,
            path,
          });
          return;
        }
        used.add(variable.id);
        const requiresNumber = [
          "greaterThan",
          "greaterThanOrEqual",
          "lessThan",
          "lessThanOrEqual",
        ].includes(condition.operator);
        const expressionValue = typeof condition.value === "string" &&
          /^\[\[[\s\S]*\]\]$/.test(condition.value);
        const mismatch = expressionValue
          ? false
          : requiresNumber
          ? variable.type !== "number" || typeof condition.value !== "number"
          : condition.operator === "contains"
            ? variable.type !== "string" || typeof condition.value !== "string"
            : condition.operator === "equals" || condition.operator === "notEquals"
              ? typeof condition.value !== variable.type
              : false;
        if (mismatch) {
          issues.push({
            severity: "warning",
            code: "type-mismatch",
            message: `The "${condition.operator}" condition value does not match the ${variable.type} variable "${variable.name}".`,
            path,
          });
        }
      });
      rule.actions.forEach((action, actionIndex) => {
        if (action.type !== "setVariable") return;
        const variable = getVariable(project.variables, action.target, screen.id);
        const path = `screens[${screenIndex}].interactionRules[${ruleIndex}].actions[${actionIndex}]`;
        if (!variable) {
          issues.push({
            severity: "error",
            code: "unknown-reference",
            message: `Unknown variable "${action.target}" in set-variable action.`,
            path,
          });
          return;
        }
        used.add(variable.id);
        if (
          action.value !== undefined &&
          !(typeof action.value === "string" && /^\[\[[\s\S]*\]\]$/.test(action.value)) &&
          typeof action.value !== variable.type
        ) {
          issues.push({
            severity: "warning",
            code: "type-mismatch",
            message: `The set-variable value does not match the ${variable.type} variable "${variable.name}".`,
            path,
          });
        }
      });
    });
  });

  project.symbols.forEach((symbol, symbolIndex) => {
    symbol.widgets.forEach((widget, widgetIndex) => {
      checkText(
        widget.props,
        `symbols[${symbolIndex}].widgets[${widgetIndex}].props`,
      );
    });
  });

  project.variables.forEach((variable, index) => {
    if (!used.has(variable.id)) {
      issues.push({
        severity: "warning",
        code: "unused-variable",
        message: `Variable "${variable.name}" is not used.`,
        path: `variables[${index}]`,
      });
    }
  });
  return issues;
}

function updateReferences(
  value: unknown,
  oldName: string,
  newName: string,
): unknown {
  if (typeof value === "string") {
    return value.replace(VARIABLE_REFERENCE, (token, name: string) =>
      name === oldName ? `{{${newName}}}` : token,
    );
  }
  if (Array.isArray(value)) {
    return value.map((item) => updateReferences(item, oldName, newName));
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        updateReferences(item, oldName, newName),
      ]),
    );
  }
  return value;
}

export function renameVariableReferences(
  project: Project,
  variable: VariableDefinition,
  newName: string,
): Project {
  const isTargetScope = (screenId?: string) =>
    variable.scope === "project"
      ? !project.variables.some((item) =>
          item.scope === "screen" &&
          item.screenId === screenId &&
          item.name === variable.name,
        )
      : screenId === variable.screenId;

  return {
    ...project,
    variables: project.variables.map((item) =>
      item.id === variable.id ? { ...item, name: newName } : item,
    ),
    screens: project.screens.map((screen) => {
      if (!isTargetScope(screen.id)) return screen;
      return {
        ...screen,
        widgets: screen.widgets.map((widget) => ({
          ...widget,
          props: updateReferences(widget.props, variable.name, newName) as Record<string, unknown>,
        })),
        interactionRules: screen.interactionRules.map((rule) => ({
          ...rule,
          conditions: rule.conditions.map((condition) =>
            condition.variable === variable.name
              ? { ...condition, variable: newName }
              : condition,
          ),
          actions: rule.actions.map((action) =>
            action.type === "setVariable" && action.target === variable.name
              ? { ...action, target: newName }
              : action,
          ),
        })),
      };
    }),
    symbols: variable.scope === "project"
      ? project.symbols.map((symbol) => ({
          ...symbol,
          widgets: symbol.widgets.map((widget) => ({
            ...widget,
            props: updateReferences(widget.props, variable.name, newName) as Record<string, unknown>,
          })),
        }))
      : project.symbols,
  };
}

export type RuntimeVariableValue = string | number | boolean;

export class VariableRuntimeStore {
  private readonly values = new Map<string, RuntimeVariableValue>();
  private definitions: VariableDefinition[];

  constructor(definitions: VariableDefinition[]) {
    this.definitions = structuredClone(definitions);
    this.reset();
  }

  reset(): void {
    this.values.clear();
    for (const variable of this.definitions) {
      this.values.set(variable.id, variable.initial);
    }
  }

  updateDefinitions(definitions: VariableDefinition[]): void {
    const previousValues = new Map(this.values);
    this.definitions = structuredClone(definitions);
    this.values.clear();
    for (const variable of this.definitions) {
      const previousValue = previousValues.get(variable.id);
      this.values.set(
        variable.id,
        previousValue !== undefined && typeof previousValue === variable.type
          ? previousValue
          : variable.initial,
      );
    }
  }

  entries(screenId?: string): Array<{ variable: VariableDefinition; value: RuntimeVariableValue }> {
    return this.definitions
      .filter((variable) =>
        variable.scope === "project" ||
        (screenId !== undefined && variable.screenId === screenId),
      )
      .map((variable) => ({
        variable,
        value: this.values.get(variable.id) ?? variable.initial,
      }));
  }

  get(name: string, screenId?: string): RuntimeVariableValue | undefined {
    const variable = getVariable(this.definitions, name, screenId);
    return variable ? this.values.get(variable.id) : undefined;
  }

  set(name: string, value: RuntimeVariableValue, screenId?: string): void {
    const variable = getVariable(this.definitions, name, screenId);
    if (!variable) throw new Error(`Unknown variable "${name}".`);
    if (typeof value !== variable.type) {
      throw new TypeError(`Value for "${name}" must be ${variable.type}.`);
    }
    this.values.set(variable.id, value);
  }

  interpolate(text: string, screenId?: string): string {
    return text.replace(VARIABLE_REFERENCE, (token, name: string) => {
      const value = this.get(name, screenId);
      return value === undefined ? token : String(value);
    });
  }
}
