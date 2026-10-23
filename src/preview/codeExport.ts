import type { Project } from "../project/schema";
import { EXPRESSION_RUNTIME_SOURCE } from "../project/expressions";
import { widgetNotesCodeComments } from "../project/widgetNotes";
import { ensureRichTextRuns } from "../project/richText";

export type CodeExportScope = "all" | "current";
export type CodeExportTailwindVersion = "3" | "4";

export interface CodeExportOptions {
  scope: CodeExportScope;
  screenId?: string;
  includeInteractions: boolean;
  includeVariables: boolean;
  includeAssets: boolean;
  responsive: boolean;
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
  const notesComments = widgetNotesCodeComments(project);
  const exportProject = ensureRichTextRuns(project);
  return `import { useRef, useState, type CSSProperties, type ReactNode, type TouchEvent } from "react";
${notesComments ? `\n${notesComments}\n` : ""}

const project = ${jsxString(exportProject)};
type Widget = typeof project.screens[number]["widgets"][number];
type TouchGestureState = {
  x: number;
  y: number;
  distance?: number;
  centerX?: number;
  centerY?: number;
  lastTap: number;
  timer?: number;
  longFired: boolean;
  multiFired: boolean;
};
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
  const touchGestures = useRef(new WeakMap<HTMLElement, TouchGestureState>());
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
  const interactionHandlers = (widget: Widget, item?: Record<string, unknown>) => {
    const mode = screen.inputMode ?? "both";
    const stateFor = (element: HTMLElement): TouchGestureState => {
      let state = touchGestures.current.get(element);
      if (!state) {
        state = { x: 0, y: 0, lastTap: 0, longFired: false, multiFired: false };
        touchGestures.current.set(element, state);
      }
      return state;
    };
    const handlers = {
      onFocus: () => runInteractions(widget, "onFocus", item),
      onBlur: () => runInteractions(widget, "onBlur", item),
      onKeyDown: (event: { key: string }) => {
        runInteractions(widget, "onKeyDown", item);
        if (mode === "touch" && (event.key === "Enter" || event.key === " ")) {
          runInteractions(widget, "onClick", item);
        }
      },
      onChange: () => runInteractions(widget, "onChange", item),
      ...(mode === "mouse" ? {
        onClick: () => runInteractions(widget, "onClick", item),
        onDoubleClick: () => runInteractions(widget, "onDoubleClick", item),
        onContextMenu: (event: { preventDefault: () => void }) => {
          event.preventDefault();
          runInteractions(widget, "onRightClick", item);
        },
        onMouseEnter: () => runInteractions(widget, "onHover", item),
        onMouseDown: () => runInteractions(widget, "onMouseDown", item),
        onMouseUp: () => runInteractions(widget, "onMouseUp", item),
      } : {}),
      ...(mode === "both" ? {
        onClick: (event: { detail: number }) => {
          if (event.detail === 0) runInteractions(widget, "onClick", item);
        },
        onPointerUp: (event: { pointerType: string }) => {
          if (event.pointerType === "mouse") {
            runInteractions(widget, "onClick", item);
            runInteractions(widget, "onMouseUp", item);
          }
        },
        onPointerEnter: (event: { pointerType: string }) => {
          if (event.pointerType === "mouse") runInteractions(widget, "onHover", item);
        },
        onPointerDown: (event: { pointerType: string }) => {
          if (event.pointerType === "mouse") runInteractions(widget, "onMouseDown", item);
        },
        onDoubleClick: () => runInteractions(widget, "onDoubleClick", item),
        onContextMenu: (event: { preventDefault: () => void }) => {
          event.preventDefault();
          runInteractions(widget, "onRightClick", item);
        },
      } : {}),
      ...(mode !== "mouse" ? {
        onTouchStart: (event: TouchEvent<HTMLElement>) => {
          const element = event.currentTarget;
          const state = stateFor(element);
          const first = event.touches[0];
          if (!first) return;
          runInteractions(widget, "onTouchStart", item);
          state.x = first.clientX;
          state.y = first.clientY;
          state.longFired = false;
          state.multiFired = false;
          if (event.touches.length > 1) {
            const second = event.touches[1];
            state.x = (first.clientX + second.clientX) / 2;
            state.y = (first.clientY + second.clientY) / 2;
            state.centerX = state.x;
            state.centerY = state.y;
            state.distance = Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
            return;
          }
          state.timer = window.setTimeout(() => {
            state.longFired = true;
            runInteractions(widget, "onLongPress", item);
          }, 550);
        },
        onTouchMove: (event: TouchEvent<HTMLElement>) => {
          const state = stateFor(event.currentTarget);
          if (event.touches.length > 1 && state.distance !== undefined) {
            const first = event.touches[0];
            const second = event.touches[1];
            const distance = Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
            const centerX = (first.clientX + second.clientX) / 2;
            const centerY = (first.clientY + second.clientY) / 2;
            if (!state.multiFired && Math.abs(distance - state.distance) > 24) {
              state.multiFired = true;
              runInteractions(widget, distance < state.distance ? "onPinchIn" : "onPinchOut", item);
            } else if (!state.multiFired && Math.hypot(centerX - (state.centerX ?? centerX), centerY - (state.centerY ?? centerY)) > 18) {
              state.multiFired = true;
              runInteractions(widget, "onPan", item);
            }
            return;
          }
          const touch = event.touches[0];
          if (touch && Math.hypot(touch.clientX - state.x, touch.clientY - state.y) > 12) window.clearTimeout(state.timer);
        },
        onTouchEnd: (event: TouchEvent<HTMLElement>) => {
          const state = stateFor(event.currentTarget);
          window.clearTimeout(state.timer);
          runInteractions(widget, "onTouchEnd", item);
          const touch = event.changedTouches[0];
          if (!touch || state.distance !== undefined || state.longFired || state.multiFired) return;
          const dx = touch.clientX - state.x;
          const dy = touch.clientY - state.y;
          if (Math.max(Math.abs(dx), Math.abs(dy)) > 40) {
            runInteractions(widget, Math.abs(dx) > Math.abs(dy)
              ? dx < 0 ? "onSwipeLeft" : "onSwipeRight"
              : dy < 0 ? "onSwipeUp" : "onSwipeDown", item);
            return;
          }
          const now = Date.now();
          if (now - state.lastTap < 320) {
            state.lastTap = 0;
            runInteractions(widget, "onDoubleTap", item);
          } else {
            state.lastTap = now;
            runInteractions(widget, "onTap", item);
          }
        },
      } : {}),
    };
    return handlers;
  };
  const layoutPosition = (widget: Widget) => {
    const parent = widget.groupId ? screen.widgets.find((item) => item.id === widget.groupId) : undefined;
    if (!parent || (parent.type !== "flex-row" && parent.type !== "flex-column")) return undefined;
    const siblings = screen.widgets.filter((item) => item.groupId === parent.id)
      .sort((first, second) => first.zIndex - second.zIndex);
    const index = siblings.findIndex((item) => item.id === widget.id);
    const gap = typeof parent.props.gap === "number" ? Math.max(0, parent.props.gap) : 12;
    const padding = typeof parent.props.padding === "number" ? Math.max(0, parent.props.padding) : 12;
    const previous = siblings.slice(0, Math.max(0, index));
    const cursor = previous.reduce((total, item) =>
      total + (parent.type === "flex-row" ? item.width : item.height) + gap, 0);
    const horizontal = parent.type === "flex-row";
    const crossSize = horizontal ? parent.height : parent.width;
    const childSize = horizontal ? widget.height : widget.width;
    const crossOffset = parent.props.alignItems === "center"
      ? Math.max(0, (crossSize - childSize) / 2)
      : parent.props.alignItems === "flex-end"
        ? Math.max(0, crossSize - childSize)
        : 0;
    return {
      x: parent.x + padding + (horizontal ? cursor : crossOffset),
      y: parent.y + padding + (horizontal ? crossOffset : cursor),
    };
  };
  const style = (widget: Widget): CSSProperties => {
    const position = layoutPosition(widget);
    return ({
    position: "absolute",
    left: position?.x ?? widget.x,
    top: position?.y ?? widget.y,
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
    touchAction: screen.inputMode === "mouse" ? "manipulation" : "none",
    boxSizing: "border-box",
  });
  };
  const resolveText = (value: unknown, widget: Widget, item?: Record<string, unknown>) =>
    String(value ?? "").replace(/\\{\\{\\s*item\\.([\\w$.-]+)\\s*\\}\\}/g, (_match, field: string) =>
      String(item?.[field] ?? ""))
      .replace(/\\{\\{\\s*([\\w$.-]+)\\s*\\}\\}/g, (whole, name: string) => {
      const resolved = name.startsWith("item.")
        ? item?.[name.slice(5)]
        : getVariableValues()[name];
      return resolved === undefined ? whole : String(resolved);
    })
      .replace(/\\[\\[([\\s\\S]*?)\\]\\]/g, (whole, source: string) => {
        try {
          const variables = getVariableValues();
          const widgets = screen.widgets;
          const result = evaluateExpression(source.trim(), { variables, widgets, item, thisWidget: widget });
          return result === null || result === undefined ? "" : String(result);
        } catch { return whole; }
      });
  const renderRichText = (widget: Widget, item?: Record<string, unknown>): ReactNode[] => {
    const runs = Array.isArray(widget.props.richTextRuns)
      ? widget.props.richTextRuns as Array<{ text: string; marks?: Record<string, unknown> }>
      : [{ text: String(widget.props.text ?? ""), marks: {} }];
    return runs.flatMap((run, runIndex) => {
      const marks = run.marks ?? {};
      return String(run.text ?? "").split("\\n").flatMap((part, lineIndex, parts) => {
        if (!part) return lineIndex < parts.length - 1
          ? [<br key={\`rich-break-\${runIndex}-\${lineIndex}\`} />]
          : [];
        let content: ReactNode = resolveText(part, widget, item);
        const style: CSSProperties = {
          ...(typeof marks.color === "string" ? { color: marks.color } : {}),
          ...(typeof marks.fontSize === "number" ? { fontSize: marks.fontSize } : {}),
          ...(typeof marks.highlight === "string" ? { backgroundColor: marks.highlight } : {}),
        };
        if (Object.keys(style).length) content = <span style={style}>{content}</span>;
        if (marks.code === true) content = <code>{content}</code>;
        if (marks.bold === true) content = <strong>{content}</strong>;
        if (marks.italic === true) content = <em>{content}</em>;
        if (marks.underline === true) content = <u>{content}</u>;
        if (marks.strike === true) content = <s>{content}</s>;
        if (typeof marks.link === "string" && /^(https?:|mailto:)/i.test(marks.link)) {
          content = <a href={marks.link}>{content}</a>;
        }
        if (marks.list === "bullet" || marks.list === "number") {
          const List = marks.list === "bullet" ? "ul" : "ol";
          content = <List><li>{content}</li></List>;
        }
        return [
          content,
          ...(lineIndex < parts.length - 1 ? [<br key={\`rich-break-\${runIndex}-\${lineIndex}\`} />] : []),
        ];
      });
    });
  };
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
          {...interactionHandlers(widget, row)} style={{ position: "relative",
          width: widget.width, height: widget.height, flex: layout === "horizontal" ? "0 0 auto" : undefined }}>
          {template.filter((child) => child.visible && repeaterItemVisible(child, row)).map((child) => renderWidget(child, row))}
        </div>)}
      </div>;
    }
    if (["button", "icon-button"].includes(widget.type)) {
      return <button key={widget.id} type="button" style={style(widget)}
        {...interactionHandlers(widget, item)}>{text}</button>;
    }
    if (widget.type === "image") {
      const src = resolveText(widget.props.src, widget, item);
      if (src) return <img key={widget.id} src={src} alt={String(widget.props.alt ?? text)} style={{ ...style(widget), objectFit: "cover" }} {...interactionHandlers(widget, item)} />;
    }
    if (widget.type === "card") {
      const imageSrc = resolveText(widget.props.imageSrc ?? widget.props.src, widget, item);
      return <article key={widget.id} className="pf-card" style={{ ...style(widget), display: "flex",
        flexDirection: "column", overflow: "hidden", border: "1px solid #d9d5e0",
        borderRadius: 10, background: "#fff", boxShadow: "0 4px 14px #28203618" }}
        {...interactionHandlers(widget, item)}>
        {imageSrc ? <img src={imageSrc} alt={String(widget.props.imageAlt ?? widget.props.title ?? "")}
          style={{ width: "100%", height: "43%", minHeight: 48, objectFit: "cover" }} />
          : <div className="pf-card-image" aria-hidden="true" style={{ display: "grid", height: "43%",
            minHeight: 48, placeItems: "center", color: "#767187", background: "linear-gradient(135deg,#ece9f4,#d9d6e3)" }}>Image</div>}
        <div className="pf-card-content" style={{ display: "flex", minHeight: 0, flex: "1 1 auto",
          flexDirection: "column", alignItems: "flex-start", gap: 4, padding: "10px 12px" }}>
          <h2 style={{ maxWidth: "100%", margin: 0, overflow: "hidden", fontSize: 14, textOverflow: "ellipsis" }}>
            {resolveText(widget.props.title ?? text, widget, item)}</h2>
          <p style={{ maxWidth: "100%", margin: 0, overflow: "hidden", color: "#66616f",
            fontSize: 11, textOverflow: "ellipsis" }}>{resolveText(widget.props.subtitle ?? "", widget, item)}</p>
          <button type="button" tabIndex={-1} style={{ marginTop: "auto", padding: "4px 8px",
            border: 0, borderRadius: 4, color: "#fff", background: "#7454cf" }}>
            {resolveText(widget.props.actionLabel ?? "Learn more", widget, item)}</button>
        </div>
      </article>;
    }
    if (widget.type === "chart") {
      const values = (Array.isArray(widget.props.values) ? widget.props.values : [38, 68, 50, 88, 62])
        .slice(0, 8)
        .map((value) => typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0);
      const maximum = Math.max(1, ...values);
      const chartType = widget.props.chartType;
      return <figure key={widget.id} className="pf-chart" style={{ ...style(widget), display: "flex",
        flexDirection: "column", gap: 4, margin: 0, padding: "8px 10px", border: "1px solid #ddd9e5",
        borderRadius: 8, color: "#7454cf", background: "#fff" }}
        aria-label={String(widget.props.label ?? "Chart")} {...interactionHandlers(widget, item)}>
        <figcaption style={{ overflow: "hidden", color: "#45414c", fontSize: 11, fontWeight: 650,
          textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{resolveText(widget.props.label ?? text, widget, item)}</figcaption>
        <svg viewBox="0 0 200 100" role="img" aria-label={\`\${String(widget.props.label ?? "Chart")} (\${String(chartType ?? "bar")})\`}
          style={{ width: "100%", minHeight: 0, flex: "1 1 auto" }}>
          {chartType === "line"
            ? <polyline points={values.map((value, index) => \`\${12 + index * (176 / Math.max(1, values.length - 1))},\${88 - value / maximum * 70}\`).join(" ")} fill="none" stroke="currentColor" strokeWidth="3" />
            : chartType === "pie"
              ? <circle cx="100" cy="50" r="34" fill="none" stroke="#8b69ed" strokeWidth="22" strokeDasharray="150 214" />
              : values.map((value, index) => {
                  const height = value / maximum * 70;
                  return <rect key={index} x={12 + index * 23} y={88 - height} width="18" height={height} rx="3" fill={index % 2 ? "#55b6a8" : "#8b69ed"} />;
                })}
        </svg>
      </figure>;
    }
    if (widget.type === "alert") {
      const variant = String(widget.props.variant ?? "info");
      const alertColors = variant === "success"
        ? { borderColor: "#9ed9bb", color: "#17653e", background: "#effbf4" }
        : variant === "warning"
          ? { borderColor: "#f1d293", color: "#74500f", background: "#fff9e9" }
          : variant === "error"
            ? { borderColor: "#efb0b5", color: "#892c35", background: "#fff2f3" }
            : { borderColor: "#acd7ff", color: "#16466f", background: "#eff8ff" };
      return <aside key={widget.id} className={\`pf-alert is-\${variant}\`}
        role={variant === "error" ? "alert" : "status"} style={{ ...style(widget), display: "flex",
          alignItems: "flex-start", gap: 9, padding: "10px 12px", border: "1px solid",
          borderRadius: 7, ...alertColors }}
        {...interactionHandlers(widget, item)}>
        <strong style={{ flex: "1 1 auto", fontSize: 11 }}>{resolveText(widget.props.label ?? text, widget, item)}</strong>
        <span style={{ fontSize: 10 }}>{resolveText(widget.props.subtitle ?? "", widget, item)}</span>
        {widget.props.dismissible === true && <button type="button" aria-label="Dismiss alert"
          style={{ border: 0, color: "inherit", background: "transparent", fontSize: 18 }}>×</button>}
      </aside>;
    }
    if (widget.type === "skeleton") {
      return <div key={widget.id} className="pf-skeleton" aria-busy="true" style={{ ...style(widget),
        display: "flex", flexDirection: "column", justifyContent: "center", gap: 8, padding: 12,
        background: "#f1f0f4" }} {...interactionHandlers(widget, item)}>
        <span style={{ height: 12, borderRadius: 5, background: "#e5e3e9" }} />
        <span style={{ width: "78%", height: 12, borderRadius: 5, background: "#e5e3e9" }} />
        <span style={{ width: "56%", height: 12, borderRadius: 5, background: "#e5e3e9" }} />
      </div>;
    }
    if (widget.type === "video") {
      const source = resolveText(widget.props.src, widget, item);
      return <figure key={widget.id} className="pf-video" style={{ ...style(widget), display: "grid",
        placeItems: "center", overflow: "hidden", margin: 0, borderRadius: 8, background: "#171923" }}
        {...interactionHandlers(widget, item)}>
        {source
          ? <video controls src={source} poster={String(widget.props.poster ?? "")} aria-label={text}
              style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          : <div className="pf-video-placeholder" role="img" aria-label={\`\${text} video placeholder\`}
              style={{ display: "grid", width: "100%", height: "100%", placeItems: "center",
                color: "#fff", background: "linear-gradient(145deg,#2b3041,#171923)", fontSize: 30 }}>▶</div>}
        <figcaption>{text}</figcaption>
      </figure>;
    }
    if (widget.type === "flex-row" || widget.type === "flex-column" || widget.type === "container") {
      return <section key={widget.id} className={\`pf-layout is-\${widget.type}\`}
        aria-label={String(widget.props.label ?? widget.type)}
        style={{ ...style(widget), display: widget.type === "container" ? "block" : "flex",
          flexDirection: widget.type === "flex-row" ? "row" : "column",
          gap: typeof widget.props.gap === "number" ? widget.props.gap : 12,
          padding: typeof widget.props.padding === "number" ? widget.props.padding : 12,
          border: "1px dashed #8d7eb7", borderRadius: 7, background: "#5a4a8020" }}
        {...interactionHandlers(widget, item)} />;
    }
    if (widget.type === "spacer") {
      return <div key={widget.id} aria-hidden="true" className="pf-spacer" style={{ ...style(widget),
        border: "1px dashed #b6a6df", background: "repeating-linear-gradient(135deg,#8b69ed12 0 6px,transparent 6px 12px)" }}
        {...interactionHandlers(widget, item)} />;
    }
    if (widget.type === "mobile-app" || widget.type === "web-app") {
      return <div key={widget.id} role="img" aria-label={String(widget.props.label ?? widget.type)}
        className={\`pf-icon-mark is-\${widget.type}\`} style={{ ...style(widget), display: "grid",
          placeItems: "center", border: "1px solid #8b69ed", borderRadius: 9, color: "#7454cf",
          background: "#f3efff", fontSize: 32 }}
        {...interactionHandlers(widget, item)}>{widget.type === "mobile-app" ? "▯" : "▱"}</div>;
    }
    if (widget.type === "text" && widget.props.richText === true) {
      return <div key={widget.id} tabIndex={0} style={style(widget)}
        {...interactionHandlers(widget, item)}>{renderRichText(widget, item)}</div>;
    }
    if (["input", "search", "textarea"].includes(widget.type)) {
      return widget.type === "textarea"
        ? <textarea key={widget.id} aria-label={String(widget.props.label ?? "Preview input")} placeholder={String(widget.props.placeholder ?? "")} style={style(widget)} {...interactionHandlers(widget, item)} />
        : <input key={widget.id} type={widget.type === "search" ? "search" : String(widget.props.type ?? "text")} aria-label={String(widget.props.label ?? "Preview input")} placeholder={String(widget.props.placeholder ?? "")} style={style(widget)} {...interactionHandlers(widget, item)} />;
    }
    return <div key={widget.id} tabIndex={0} style={style(widget)}
      {...interactionHandlers(widget, item)}>{text}</div>;
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
