import type { Project } from "../project/schema";
import { EXPRESSION_RUNTIME_SOURCE } from "../project/expressions";

export type CodeExportScope = "all" | "current";
export type CodeExportTailwindVersion = "3" | "4";

export interface CodeExportOptions {
  scope: CodeExportScope;
  screenId?: string;
  includeInteractions: boolean;
  includeVariables: boolean;
  includeAssets: boolean;
  tailwindVersion: CodeExportTailwindVersion;
}

export function encodeProjectForCodeExport(project: Project): string {
  const bytes = new TextEncoder().encode(JSON.stringify(project));
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export function prepareExportProject(project: Project, options: CodeExportOptions): Project {
  const screens = options.scope === "all"
    ? project.screens
    : project.screens.filter((screen) => screen.id === options.screenId);
  if (screens.length === 0) throw new Error("Choose a screen that exists in this project.");

  const screenIds = new Set(screens.map((screen) => screen.id));
  const variables = options.includeVariables
    ? project.variables.filter((variable) =>
      variable.scope === "project" || (variable.screenId && screenIds.has(variable.screenId)),
    )
    : [];
  const variableNames = new Set(variables.map((variable) => variable.name));
  const filteredScreens = screens.map((screen) => ({
    ...screen,
    widgets: screen.widgets.map((widget) => {
      const props = { ...widget.props };
      delete props.assetPath;
      if (!options.includeAssets) {
        for (const key of ["src", "url"]) {
          if (typeof props[key] === "string" && props[key].startsWith("data:")) props[key] = "";
        }
      }
      return { ...widget, props };
    }),
    interactionRules: options.includeInteractions
      ? screen.interactionRules.filter((rule) =>
        rule.conditions.every((condition) =>
          /^\[\[[\s\S]*\]\]$/.test(condition.variable) ||
          (rule.localVariables ?? []).some((variable) => variable.name === condition.variable) ||
          variableNames.has(condition.variable),
        ) &&
        rule.actions.every((action) =>
          action.type !== "setVariable" ||
          variableNames.has(action.target) ||
          (rule.localVariables ?? []).some((variable) => variable.name === action.target),
        ),
      )
      : [],
  }));
  const startScreenId = screenIds.has(project.startScreenId)
    ? project.startScreenId
    : filteredScreens[0].id;

  return {
    ...project,
    variables,
    screens: filteredScreens,
    startScreenId,
  };
}

function jsxString(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

export function generateSingleFileJsx(project: Project): string {
  return `import { useState, type CSSProperties, type ReactNode } from "react";

const project = ${jsxString(project)};
type Widget = typeof project.screens[number]["widgets"][number];
const repeaterItemVisible = (widget: Widget, item: Record<string, unknown>): boolean => {
  const rule = widget.props.visibleWhen;
  if (typeof rule !== "object" || rule === null || Array.isArray(rule)) return true;
  const condition = rule as Record<string, unknown>;
  if (typeof condition.field !== "string" || typeof condition.operator !== "string") return true;
  const actual = item[condition.field];
  switch (condition.operator) {
    case "notEquals": return actual !== condition.value;
    case "contains": return typeof actual === "string" && actual.includes(String(condition.value ?? ""));
    case "greaterThan": return typeof actual === "number" && typeof condition.value === "number" && actual > condition.value;
    case "lessThan": return typeof actual === "number" && typeof condition.value === "number" && actual < condition.value;
    default: return actual === condition.value;
  }
};

export default function App() {
${EXPRESSION_RUNTIME_SOURCE}
  const [screenId, setScreenId] = useState(project.startScreenId);
  const [runtimeVariables, setRuntimeVariables] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(project.variables.map((entry) => [entry.id, entry.initial])));
  const screen = project.screens.find((item) => item.id === screenId) ?? project.screens[0];
  const getVariableValues = (updates: Record<string, unknown> = {}) => Object.fromEntries([
    ...project.variables.filter((entry) => entry.scope === "project"),
    ...project.variables.filter((entry) => entry.scope === "screen" && entry.screenId === screen.id),
  ].map((entry) => [entry.name, updates[entry.id] ?? runtimeVariables[entry.id] ?? entry.initial]));
  const resolveActionValue = (value: unknown, variables: Record<string, unknown>, item?: Record<string, unknown>, widget?: Widget): unknown => {
    if (typeof value === "string") {
      const withBindings = value.replace(/\\{\\{\\s*([\\w$.-]+)\\s*\\}\\}/g, (whole, name: string) => {
        const current = name.startsWith("item.") ? item?.[name.slice(5)] : variables[name];
        return current === undefined ? whole : String(current);
      });
      const wholeExpression = /^\\[\\[([\\s\\S]*?)\\]\\]$/.exec(withBindings);
      const context = { variables, widgets: screen.widgets, item, thisWidget: widget };
      if (wholeExpression) return evaluateExpression(wholeExpression[1].trim(), context);
      return withBindings.replace(/\\[\\[([\\s\\S]*?)\\]\\]/g, (whole, source: string) => {
        try {
          const result = evaluateExpression(source.trim(), context);
          return result === null || result === undefined ? "" : String(result);
        } catch { return whole; }
      });
    }
    if (Array.isArray(value)) return value.map((entry) => resolveActionValue(entry, variables, item, widget));
    if (typeof value === "object" && value !== null) {
      return Object.fromEntries(Object.entries(value).map(([key, entry]) =>
        [key, resolveActionValue(entry, variables, item, widget)]));
    }
    return value;
  };
  const runInteractions = (widget: Widget, eventName: string, item?: Record<string, unknown>) => {
    const updates: Record<string, unknown> = {};
    for (const rule of screen.interactionRules.filter((entry) =>
      entry.event === eventName && (!entry.widgetId || entry.widgetId === widget.id))) {
      const localVariables: Record<string, unknown> = {};
      for (const definition of rule.localVariables ?? []) {
        let localValue = definition.initial;
        localVariables[definition.name] = localValue;
      }
      const variables = { ...getVariableValues(updates), ...localVariables };
      const matches = rule.conditions.map((condition) => {
        const expression = /^\\[\\[([\\s\\S]*?)\\]\\]$/.exec(condition.variable);
        if (expression) {
          try {
            return Boolean(evaluateExpression(expression[1].trim(), { variables, widgets: screen.widgets, item, thisWidget: widget }));
          } catch { return false; }
        }
        const current = variables[condition.variable];
        const expected = typeof condition.value === "string"
          ? resolveActionValue(condition.value, variables, item, widget)
          : condition.value;
        switch (condition.operator) {
          case "equals": return current === expected;
          case "notEquals": return current !== expected;
          case "greaterThan": return typeof current === "number" && typeof expected === "number" && current > expected;
          case "greaterThanOrEqual": return typeof current === "number" && typeof expected === "number" && current >= expected;
          case "lessThan": return typeof current === "number" && typeof expected === "number" && current < expected;
          case "lessThanOrEqual": return typeof current === "number" && typeof expected === "number" && current <= expected;
          case "contains": return typeof current === "string" && typeof expected === "string" && current.includes(expected);
          default: return false;
        }
      });
      if (rule.conditions.length && (rule.conditionMode === "any" ? !matches.some(Boolean) : !matches.every(Boolean))) continue;
      for (const action of rule.actions) {
        if (action.type !== "setVariable") continue;
        const actionVariables = { ...getVariableValues(updates), ...localVariables };
        const value = resolveActionValue(action.value, actionVariables, item, widget);
        if (Object.hasOwn(localVariables, action.target)) {
          const localDefinition = rule.localVariables?.find((entry) => entry.name === action.target);
          if (localDefinition && typeof value === localDefinition.type) localVariables[action.target] = value;
          continue;
        }
        const definition = project.variables.find((entry) =>
          entry.name === action.target && entry.scope === "screen" && entry.screenId === screen.id,
        ) ?? project.variables.find((entry) => entry.name === action.target && entry.scope === "project");
        if (definition && typeof value === definition.type) updates[definition.id] = value;
      }
    }
    if (Object.keys(updates).length) setRuntimeVariables((current) => ({ ...current, ...updates }));
  };
  const style = (widget: Widget): CSSProperties => ({
    position: "absolute",
    left: widget.x,
    top: widget.y,
    width: widget.width,
    height: widget.height,
    transform: widget.rotation ? \`rotate(\${widget.rotation}deg)\` : undefined,
    opacity: widget.opacity,
    color: typeof widget.props.color === "string" ? widget.props.color : "#24212b",
    background: typeof widget.style.fill === "string" ? widget.style.fill : "transparent",
    border: typeof widget.style.stroke === "string" ? \`\${typeof widget.style.strokeWidth === "number" ? widget.style.strokeWidth : 1}px solid \${widget.style.stroke}\` : "none",
    borderRadius: typeof widget.style.cornerRadius === "number" ? widget.style.cornerRadius : undefined,
    fontSize: typeof widget.props.fontSize === "number" ? widget.props.fontSize : 16,
    textAlign: typeof widget.props.align === "string" ? widget.props.align as CSSProperties["textAlign"] : "left",
    whiteSpace: "pre-wrap",
    padding: typeof widget.props.padding === "number" ? widget.props.padding : 8,
    boxSizing: "border-box",
  });
  const resolveText = (value: unknown, widget: Widget, item?: Record<string, unknown>) =>
    String(value ?? "").replace(/\\{\\{\\s*item\\.([\\w$.-]+)\\s*\\}\\}/g, (_match, field: string) => String(item?.[field] ?? ""))
      .replace(/\\[\\[([\\s\\S]*?)\\]\\]/g, (whole, source: string) => {
        try {
          const variables = getVariableValues();
          const widgets = screen.widgets;
          const result = evaluateExpression(source.trim(), { variables, widgets, item, thisWidget: widget });
          return result === null || result === undefined ? "" : String(result);
        } catch { return whole; }
      });
  const label = (widget: Widget, item?: Record<string, unknown>) =>
    resolveText(widget.props.text ?? widget.props.label ?? widget.props.title ?? widget.type, widget, item);
  const renderWidget = (widget: Widget, item?: Record<string, unknown>): ReactNode => {
    const text = label(widget, item);
    if (widget.type === "repeater") {
      const rows = Array.isArray(widget.props.dataset) ? widget.props.dataset as Record<string, unknown>[] : [];
      const template = typeof widget.props.rowTemplate === "object" && widget.props.rowTemplate !== null
        && "widgets" in widget.props.rowTemplate && Array.isArray(widget.props.rowTemplate.widgets)
        ? widget.props.rowTemplate.widgets as Widget[] : [];
      const layout = widget.props.layout === "horizontal" || widget.props.layout === "grid" ? widget.props.layout : "vertical";
      return <div key={widget.id} style={{ ...style(widget), display: layout === "grid" ? "grid" : "flex",
        flexDirection: layout === "horizontal" ? "row" : "column",
        gridTemplateColumns: layout === "grid" ? "repeat(auto-fill,minmax(120px,1fr))" : undefined,
        gap: typeof widget.props.gap === "number" ? widget.props.gap : 8, overflow: "visible" }}>
        {rows.slice(0, 1000).map((row, index) => <div key={index}
          onClick={() => runInteractions(widget, "onClick", row)} style={{ position: "relative",
          width: widget.width, height: widget.height, flex: layout === "horizontal" ? "0 0 auto" : undefined }}>
          {template.filter((child) => child.visible && repeaterItemVisible(child, row)).map((child) => renderWidget(child, row))}
        </div>)}
      </div>;
    }
    if (["button", "icon-button"].includes(widget.type)) {
      return <button key={widget.id} type="button" style={style(widget)}
        onClick={() => runInteractions(widget, "onClick", item)}>{text}</button>;
    }
    if (widget.type === "image") {
      const src = resolveText(widget.props.src, widget, item);
      if (src) return <img key={widget.id} src={src} alt={String(widget.props.alt ?? text)} style={{ ...style(widget), objectFit: "cover" }} />;
    }
    if (["input", "search", "textarea"].includes(widget.type)) {
      return widget.type === "textarea"
        ? <textarea key={widget.id} aria-label={String(widget.props.label ?? "Preview input")} placeholder={String(widget.props.placeholder ?? "")} style={style(widget)} />
        : <input key={widget.id} type={widget.type === "search" ? "search" : String(widget.props.type ?? "text")} aria-label={String(widget.props.label ?? "Preview input")} placeholder={String(widget.props.placeholder ?? "")} style={style(widget)} />;
    }
    return <div key={widget.id} style={style(widget)}
      onClick={() => runInteractions(widget, "onClick", item)}>{text}</div>;
  };
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 16 }}>
      <label>
        Screen{" "}
        <select value={screen.id} onChange={(event) => setScreenId(event.target.value)}>
          {project.screens.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      <section style={{ position: "relative", width: screen.device?.width ?? 1440, height: screen.device?.height ?? 900, margin: "16px auto", background: "#fff", overflow: "hidden" }}>
        {screen.widgets.filter((widget) => widget.visible).sort((a, b) => a.zIndex - b.zIndex).map((widget) => renderWidget(widget))}
      </section>
    </main>
  );
}
`;
}
