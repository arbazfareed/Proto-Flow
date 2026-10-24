import JSZip from "jszip";
import { ProjectSchema, type Project } from "../../src/project/schema";
import {
  prepareExportProject,
  type CodeExportOptions,
} from "../../src/preview/codeExport";

export const MAX_CODE_EXPORT_PROJECT_BYTES = 10 * 1024 * 1024;
export const MAX_CODE_EXPORT_ARCHIVE_BYTES = 15 * 1024 * 1024;

export class CodeExportInputError extends Error {}

const exportOptions = {
  parse(value: unknown): CodeExportOptions {
    if (!isCodeExportOptions(value)) {
      throw new CodeExportInputError("Export settings are invalid.");
    }
    return value;
  },
};

function isCodeExportOptions(value: unknown): value is CodeExportOptions {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const options = value as Record<string, unknown>;
  return (
    (options.scope === "all" || options.scope === "current") &&
    typeof options.includeInteractions === "boolean" &&
    typeof options.includeVariables === "boolean" &&
    typeof options.includeAssets === "boolean" &&
    typeof options.responsive === "boolean" &&
    (options.tailwindVersion === "3" || options.tailwindVersion === "4") &&
    (options.scope !== "current" || typeof options.screenId === "string") &&
    !Object.keys(options).some((key) =>
      !["scope", "screenId", "includeInteractions", "includeVariables", "includeAssets", "responsive", "tailwindVersion"].includes(key),
    )
  );
}

function decodeProject(encoded: unknown): Project {
  if (
    typeof encoded !== "string" ||
    encoded.length === 0 ||
    encoded.length > Math.ceil(MAX_CODE_EXPORT_PROJECT_BYTES / 3) * 4 + 8 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
  ) {
    throw new CodeExportInputError("The project export payload is invalid or too large.");
  }
  let json: string;
  try {
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    if (bytes.byteLength > MAX_CODE_EXPORT_PROJECT_BYTES) {
      throw new CodeExportInputError("The project exceeds the 10 MiB export limit.");
    }
    json = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new CodeExportInputError(`The project export payload is invalid: ${error instanceof Error ? error.message : "invalid encoding"}`);
  }
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new CodeExportInputError("The project export payload is not valid JSON.");
  }
  const parsed = ProjectSchema.safeParse(value);
  if (!parsed.success) throw new CodeExportInputError("The project does not match the current ProtoFlow project schema.");
  return parsed.data;
}

function sourceProject(project: Project): string {
  return JSON.stringify(project)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function slug(value: string): string {
  const result = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return result || "prototype";
}

function responsiveHelperSource(): string {
  return `import type { Breakpoint, Screen, Widget } from "../types";

export function getScreenBreakpoints(screen: Screen): Breakpoint[] {
  return screen.breakpoints?.length
    ? screen.breakpoints
    : [
        { id: "mobile", name: "Mobile", minWidth: 0, maxWidth: 767, width: 390, height: 844 },
        { id: "tablet", name: "Tablet", minWidth: 768, maxWidth: 1023, width: 768, height: 1024 },
        { id: "desktop", name: "Desktop", minWidth: 1024, width: screen.device?.width ?? 1440, height: screen.device?.height ?? 900 },
      ];
}

export function resolveWidgetsForBreakpoint(
  widgets: Widget[],
  breakpoint: Breakpoint,
  baseWidth: number,
  baseHeight: number,
  compactLayout = false,
): Widget[] {
  let stackY = 24;
  return [...widgets].sort((first, second) => first.zIndex - second.zIndex).map((widget) => {
    let next = { ...widget };
    const mode = widget.cascadeMode ?? (compactLayout && breakpoint.width < baseWidth ? "hide" : undefined);
    if (mode === "hide") next.visible = false;
    else if (breakpoint.width < baseWidth && mode === "fluid") {
      next.width = Math.max(1, Math.min(breakpoint.width, widget.width * breakpoint.width / baseWidth));
    } else if (breakpoint.width < baseWidth && mode === "stack") {
      next.x = 0;
      next.y = stackY;
      next.width = Math.min(widget.width, breakpoint.width);
      stackY += next.height + 16;
    }
    const constraints = widget.constraints;
    if (constraints && (mode === undefined || mode === "absolute")) {
      if (constraints.horizontal === "right") next.x = breakpoint.width - (baseWidth - widget.x - widget.width);
      else if (constraints.horizontal === "center") next.x = (breakpoint.width - widget.width) / 2 + widget.x - (baseWidth - widget.width) / 2;
      else if (constraints.horizontal === "scale") {
        next.x *= breakpoint.width / baseWidth;
        next.width *= breakpoint.width / baseWidth;
      } else if (constraints.horizontal === "stretch") {
        next.width = Math.max(1, breakpoint.width - (baseWidth - widget.x - widget.width) - widget.x);
      }
      if (constraints.vertical === "bottom") next.y = breakpoint.height - (baseHeight - widget.y - widget.height);
      else if (constraints.vertical === "center") next.y = (breakpoint.height - widget.height) / 2 + widget.y - (baseHeight - widget.height) / 2;
      else if (constraints.vertical === "scale") {
        next.y *= breakpoint.height / baseHeight;
        next.height *= breakpoint.height / baseHeight;
      } else if (constraints.vertical === "stretch") {
        next.height = Math.max(1, breakpoint.height - (baseHeight - widget.y - widget.height) - widget.y);
      }
    }
    const overrides = widget.overrides as Record<string, Partial<Widget>> | undefined;
    const override = overrides?.[breakpoint.id];
    const resolved = override ? {
      ...next,
      ...override,
      style: override.style ? { ...next.style, ...override.style } : next.style,
      props: override.props ? { ...next.props, ...override.props } : next.props,
    } : next;
    if (compactLayout && breakpoint.width < 768) {
      const horizontalScale = breakpoint.width / 390;
      const verticalScale = breakpoint.height < 844 ? breakpoint.height / 844 : 1;
      resolved.x *= horizontalScale;
      resolved.width = Math.max(1, resolved.width * horizontalScale);
      resolved.y *= verticalScale;
      resolved.height = Math.max(1, resolved.height * verticalScale);
      if (typeof resolved.props.fontSize === "number") {
        resolved.props = { ...resolved.props, fontSize: Math.max(10, resolved.props.fontSize * verticalScale) };
      }
    }
    return resolved;
  });
}
`;
}

function buildFiles(
  project: Project,
  tailwindVersion: "3" | "4",
  responsive: boolean,
): Record<string, string> {
  const packageJson = {
    name: slug(project.name).slice(0, 200),
    private: true,
    version: "1.0.0",
    type: "module",
    scripts: { dev: "vite", build: "tsc --noEmit && vite build", preview: "vite preview" },
    dependencies: {
      "react": "^19.1.0",
      "react-dom": "^19.1.0",
      "react-router-dom": "^6.30.1",
    },
    devDependencies: {
      "@vitejs/plugin-react": "^6.0.2",
      "@types/react": "^19.1.8",
      "@types/react-dom": "^19.1.6",
      "vite": "^8.0.16",
      "typescript": "~6.0.3",
      ...(tailwindVersion === "4"
        ? { "@tailwindcss/vite": "^4.1.0", "tailwindcss": "^4.1.0" }
        : { "autoprefixer": "^10.4.21", "postcss": "^8.5.6", "tailwindcss": "^3.4.17" }),
    },
  };
  const files: Record<string, string> = {
    "package.json": JSON.stringify(packageJson, null, 2),
    "index.html": `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><title>${project.name.replace(/[&<>"]/g, "")}</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>`,
    "vite.config.ts": tailwindVersion === "4"
      ? `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({ plugins: [react(), tailwindcss()] });
`
      : `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({ plugins: [react()] });
`,
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        useDefineForClassFields: true,
        lib: ["ES2022", "DOM", "DOM.Iterable"],
        module: "ESNext",
        skipLibCheck: true,
        moduleResolution: "Bundler",
        types: ["vite/client"],
        allowImportingTsExtensions: true,
        verbatimModuleSyntax: true,
        moduleDetection: "force",
        noEmit: true,
        jsx: "react-jsx",
        strict: true,
        noUnusedLocals: true,
        noUnusedParameters: true,
        noFallthroughCasesInSwitch: true,
      },
      include: ["src"],
    }, null, 2),
    "src/main.tsx": `import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
`,
    "src/types.ts": `export type Value = string | number | boolean;
export interface Variable { id: string; name: string; type: "string" | "number" | "boolean"; initial: Value; scope: "project" | "screen"; screenId?: string }
export interface Breakpoint { id: string; name: string; minWidth: number; maxWidth?: number; width: number; height: number }
export interface Widget { id: string; type: string; name?: string; groupId?: string; layerCategory?: string; x: number; y: number; width: number; height: number; rotation: number; opacity: number; visible: boolean; locked: boolean; zIndex: number; symbolId?: string; style: Record<string, unknown>; props: Record<string, unknown>; cascadeMode?: string; constraints?: { horizontal: string; vertical: string }; important?: boolean; overrides?: Record<string, unknown> }
export interface Condition { variable: string; operator: string; value: unknown }
export interface Action { type: string; target: string; value?: unknown }
export interface Rule { id: string; widgetId?: string; event: string; conditionMode?: "all" | "any"; conditions: Condition[]; actions: Action[] }
export interface Screen { id: string; name: string; device?: { width: number; height: number; [key: string]: unknown }; compactLayout?: boolean; breakpoints?: Breakpoint[]; widgets: Widget[]; interactionRules: Rule[] }
export interface Project { schemaVersion: string; id: string; name: string; createdAt: string; updatedAt: string; startScreenId: string; variables: Variable[]; screens: Screen[]; symbols: Array<{ id: string; name: string; width: number; height: number; widgets: Widget[] }> }
`,
    "src/project.ts": `import type { Project } from "./types";

export const project: Project = ${sourceProject(project)};
`,
    "src/hooks/useVariables.ts": `import { useCallback, useMemo, useState } from "react";
import type { Variable, Value } from "../types";

export function useVariables(definitions: Variable[]) {
  const [values, setValues] = useState<Record<string, Value>>(() =>
    Object.fromEntries(definitions.map((item) => [item.scope === "project" ? item.name : \`\${item.screenId}:\${item.name}\`, item.initial])),
  );
  const get = useCallback((name: string, screenId: string) => {
    const localKey = \`\${screenId}:\${name}\`;
    if (Object.hasOwn(values, localKey)) return values[localKey];
    return values[name];
  }, [values]);
  const set = useCallback((name: string, value: Value, screenId: string) => {
    const definition = definitions.find((item) => item.name === name && item.scope === "screen" && item.screenId === screenId)
      ?? definitions.find((item) => item.name === name && item.scope === "project");
    if (!definition || typeof value !== definition.type) return;
    const key = definition.scope === "project" ? name : \`\${screenId}:\${name}\`;
    setValues((current) => ({ ...current, [key]: value }));
  }, [definitions]);
  const interpolate = useCallback((value: string, screenId: string) =>
    value.replace(/\\{\\{\\s*([\\w$]+)\\s*\\}\\}/g, (_match, name: string) => String(get(name, screenId) ?? "")),
  [get]);
  return useMemo(() => ({ values, get, set, interpolate }), [values, get, set, interpolate]);
}
`,
    "src/hooks/useInteractions.ts": `import { useCallback, useContext } from "react";
import { useNavigate } from "react-router-dom";
import { RuntimeContext } from "./runtime";
import type { Project, Screen, Value, Widget } from "../types";

function conditionMatches(operator: string, current: Value | undefined, expected: unknown): boolean {
  switch (operator) {
    case "equals": return current === expected;
    case "notEquals": return current !== expected;
    case "greaterThan": return typeof current === "number" && typeof expected === "number" && current > expected;
    case "greaterThanOrEqual": return typeof current === "number" && typeof expected === "number" && current >= expected;
    case "lessThan": return typeof current === "number" && typeof expected === "number" && current < expected;
    case "lessThanOrEqual": return typeof current === "number" && typeof expected === "number" && current <= expected;
    case "contains": return typeof current === "string" && typeof expected === "string" && current.includes(expected);
    default: return false;
  }
}

export function useInteractions(project: Project) {
  const runtime = useContext(RuntimeContext);
  const navigate = useNavigate();
  if (!runtime) throw new Error("Interaction runtime is missing.");
  const execute = useCallback((screen: Screen, widgetId: string | undefined, event: string) => {
    const rules = screen.interactionRules.filter((rule) =>
      rule.event === event && (event === "onLoad" ? rule.widgetId === widgetId : (!rule.widgetId || rule.widgetId === widgetId)),
    );
    for (const rule of rules) {
      const checks = rule.conditions.map((item) => conditionMatches(item.operator, runtime.get(item.variable, screen.id), item.value));
      if (rule.conditions.length && (rule.conditionMode === "any" ? !checks.some(Boolean) : !checks.every(Boolean))) continue;
      for (const action of rule.actions) {
        if (action.type === "navigate" || action.type === "navigateTo") {
          if (project.screens.some((item) => item.id === action.target)) navigate(\`/s/\${action.target}\`);
        } else if (action.type === "show" || action.type === "hide") {
          runtime.setVisibility((current) => ({ ...current, [action.target]: action.type === "show" }));
        } else if (action.type === "setVariable") {
          if (typeof action.value === "string" || typeof action.value === "number" || typeof action.value === "boolean") {
            runtime.set(action.target, action.value, screen.id);
          }
        } else if (action.type === "setPanelState" && typeof action.value === "string") {
          runtime.setPanelStates((current) => ({ ...current, [action.target]: action.value as string }));
        } else if (action.type === "setRepeaterData") {
          const value = typeof action.value === "string" ? JSON.parse(action.value) as unknown : action.value;
          runtime.setRepeaterData((current) => ({ ...current, [action.target]: value }));
        }
      }
    }
  }, [navigate, project.screens, runtime]);
  const runEvent = useCallback((screen: Screen, widget: Widget, event: string) => {
    try {
      execute(screen, widget.id, event);
    } catch (error) {
      console.error("Prototype interaction failed.", error);
    }
  }, [execute]);
  const runScreenLoad = useCallback((screen: Screen) => {
    execute(screen, undefined, "onLoad");
    screen.widgets.forEach((widget) => execute(screen, widget.id, "onLoad"));
  }, [execute]);
  return { runEvent, runScreenLoad };
}
`,
    "src/hooks/runtime.tsx": `import { createContext, useContext, type Dispatch, type SetStateAction } from "react";
import type { Value } from "../types";

export interface RuntimeState {
  get: (name: string, screenId: string) => Value | undefined;
  set: (name: string, value: Value, screenId: string) => void;
  interpolate: (value: string, screenId: string) => string;
  visibility: Record<string, boolean>;
  setVisibility: Dispatch<SetStateAction<Record<string, boolean>>>;
  panelStates: Record<string, string>;
  setPanelStates: Dispatch<SetStateAction<Record<string, string>>>;
  repeaterData: Record<string, unknown>;
  setRepeaterData: Dispatch<SetStateAction<Record<string, unknown>>>;
}
export const RuntimeContext = createContext<RuntimeState | null>(null);
export function useRuntime() {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error("Prototype runtime is missing.");
  return runtime;
}
`,
    "src/components/WidgetRenderer.tsx": `import type { CSSProperties } from "react";
import { useRuntime } from "../hooks/runtime";
import { useInteractions } from "../hooks/useInteractions";
import type { Screen, Widget } from "../types";

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function WidgetRenderer({ screen, widget, project }: { screen: Screen; widget: Widget; project: import("../types").Project }) {
  const runtime = useRuntime();
  const { runEvent } = useInteractions(project);
  const props = widget.props;
  const text = runtime.interpolate(stringValue(props.text, stringValue(props.label, stringValue(props.title, widget.type))), screen.id);
  const style: CSSProperties = {
    position: "absolute", left: widget.x, top: widget.y, width: widget.width, height: widget.height,
    zIndex: widget.zIndex, opacity: widget.opacity, transform: widget.rotation ? \`rotate(\${widget.rotation}deg)\` : undefined,
    color: stringValue(props.color, "#24212b"), background: stringValue(widget.style.fill, "transparent"),
    border: widget.style.stroke ? \`\${typeof widget.style.strokeWidth === "number" ? widget.style.strokeWidth : 1}px solid \${stringValue(widget.style.stroke)}\` : "none",
    borderRadius: typeof widget.style.cornerRadius === "number" ? widget.style.cornerRadius : undefined,
    fontSize: typeof props.fontSize === "number" ? props.fontSize : 16, textAlign: stringValue(props.align, "left") as CSSProperties["textAlign"],
    whiteSpace: "pre-wrap", padding: typeof props.padding === "number" ? props.padding : 8, boxSizing: "border-box", overflow: "hidden",
  };
  const event = (name: string) => runEvent(screen, widget, name);
  const variableName = stringValue(props.variableName, stringValue(props.variable));
  const common = {
    style,
    onClick: () => event("onClick"),
    onMouseEnter: () => event("onHover"),
    onTouchStart: () => event("onTouchStart"),
    onTouchEnd: () => { event("onTouchEnd"); event("onTap"); },
  };
  if (widget.type === "button" || widget.type === "icon-button") return <button {...common} type="button">{text || "Button"}</button>;
  if (widget.type === "image") return <img {...common} src={stringValue(props.src, stringValue(props.url))} alt={stringValue(props.alt, text)} />;
  if (["input", "search", "textarea"].includes(widget.type)) {
    const onChange = (value: string) => {
      if (variableName) {
        const definition = project.variables.find((item) => item.name === variableName && (item.scope === "project" || item.screenId === screen.id));
        runtime.set(variableName, definition?.type === "number" ? Number(value) : value, screen.id);
      }
      event("onChange");
    };
    return widget.type === "textarea"
      ? <textarea {...common} aria-label={stringValue(props.label, "Preview input")} placeholder={stringValue(props.placeholder)} onChange={(e) => onChange(e.currentTarget.value)} />
      : <input {...common} type={widget.type === "search" ? "search" : stringValue(props.type, "text")} aria-label={stringValue(props.label, "Preview input")} placeholder={stringValue(props.placeholder)} onChange={(e) => onChange(e.currentTarget.value)} />;
  }
  if (["checkbox", "toggle", "radio"].includes(widget.type)) {
    const onChange = (checked: boolean) => {
      if (variableName) runtime.set(variableName, checked, screen.id);
      event("onChange");
    };
    return <label {...common}><input type={widget.type === "radio" ? "radio" : "checkbox"} defaultChecked={props.checked === true || props.selected === true || props.on === true} onChange={(e) => onChange(e.currentTarget.checked)} />{text}</label>;
  }
  if (widget.type === "repeater") {
    const rows = runtime.repeaterData[widget.id];
    return <div {...common} data-panel-state={runtime.panelStates[widget.id]}>{Array.isArray(rows) ? rows.map((row, index) => <div key={index}>{typeof row === "string" ? runtime.interpolate(row, screen.id) : JSON.stringify(row)}</div>) : text}</div>;
  }
  if (widget.type === "list" && Array.isArray(props.items)) return <ul {...common}>{props.items.map((item, index) => <li key={index}>{runtime.interpolate(String(item), screen.id)}</li>)}</ul>;
  return <div {...common} data-panel-state={runtime.panelStates[widget.id]}>{text}</div>;
}
`,
    "src/components/ScreenRenderer.tsx": responsive ? `import { useEffect, useRef, useState } from "react";
import { project } from "../project";
import { useRuntime } from "../hooks/runtime";
import { useInteractions } from "../hooks/useInteractions";
import { WidgetRenderer } from "./WidgetRenderer";
import { getScreenBreakpoints, resolveWidgetsForBreakpoint } from "../project/responsive";
import type { Screen } from "../types";

export function ScreenRenderer({ screen }: { screen: Screen }) {
  const runtime = useRuntime();
  const { runScreenLoad } = useInteractions(project);
  const loadedScreen = useRef("");
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const updateWidth = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, []);
  useEffect(() => {
    if (loadedScreen.current === screen.id) return;
    loadedScreen.current = screen.id;
    runScreenLoad(screen);
  }, [runScreenLoad, screen]);
  const breakpoints = getScreenBreakpoints(screen);
  const breakpoint = breakpoints.find((item) =>
    viewportWidth >= item.minWidth && (item.maxWidth === undefined || viewportWidth <= item.maxWidth),
  ) ?? breakpoints.reduce((closest, item) =>
    Math.abs(item.width - viewportWidth) < Math.abs(closest.width - viewportWidth) ? item : closest,
  );
  const baseWidth = screen.device?.width ?? breakpoint.width;
  const baseHeight = screen.device?.height ?? breakpoint.height;
  const responsiveWidgets = resolveWidgetsForBreakpoint(screen.widgets, breakpoint, baseWidth, baseHeight, screen.compactLayout);
  const scale = Math.min(1, Math.max(0.1, (viewportWidth - 48) / breakpoint.width));
  return <main className="min-h-screen overflow-auto bg-slate-100 p-6">
    <section className="relative mx-auto overflow-hidden bg-white shadow-xl" style={{ width: breakpoint.width, height: breakpoint.height, transform: \`scale(\${scale})\`, transformOrigin: "top center" }}>
      {responsiveWidgets.filter((widget) => widget.visible && runtime.visibility[widget.id] !== false).sort((a, b) => a.zIndex - b.zIndex).map((widget) =>
        <WidgetRenderer key={widget.id} screen={screen} widget={widget} project={project} />,
      )}
    </section>
  </main>;
}
` : `import { useEffect, useRef } from "react";
import { project } from "../project";
import { useRuntime } from "../hooks/runtime";
import { useInteractions } from "../hooks/useInteractions";
import { WidgetRenderer } from "./WidgetRenderer";
import type { Screen } from "../types";

export function ScreenRenderer({ screen }: { screen: Screen }) {
  const runtime = useRuntime();
  const { runScreenLoad } = useInteractions(project);
  const loadedScreen = useRef("");
  useEffect(() => {
    if (loadedScreen.current === screen.id) return;
    loadedScreen.current = screen.id;
    runScreenLoad(screen);
  }, [runScreenLoad, screen]);
  return <main className="min-h-screen overflow-auto bg-slate-100 p-6">
    <section className="relative mx-auto overflow-hidden bg-white shadow-xl" style={{ width: screen.device?.width ?? 1440, height: screen.device?.height ?? 900 }}>
      {screen.widgets.filter((widget) => widget.visible && runtime.visibility[widget.id] !== false).sort((a, b) => a.zIndex - b.zIndex).map((widget) =>
        <WidgetRenderer key={widget.id} screen={screen} widget={widget} project={project} />,
      )}
    </section>
  </main>;
}
`,
    "src/App.tsx": `import { useMemo, useState, type ReactElement } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { project } from "./project";
import { RuntimeContext } from "./hooks/runtime";
import { useVariables } from "./hooks/useVariables";
import type { Screen } from "./types";
import "./index.css";
${project.screens.map((screen, index) => {
  const fileName = `${slug(screen.name)}-${index + 1}`;
  return `import Screen${index + 1} from "./screens/${fileName}";`;
}).join("\n")}

function PrototypeApp() {
  const navigate = useNavigate();
  const location = useLocation();
  const variables = useVariables(project.variables);
  const [visibility, setVisibility] = useState<Record<string, boolean>>(() => Object.fromEntries(project.screens.flatMap((screen) => screen.widgets.map((widget) => [widget.id, widget.visible]))));
  const [panelStates, setPanelStates] = useState<Record<string, string>>({});
  const [repeaterData, setRepeaterData] = useState<Record<string, unknown>>({});
  const runtime = useMemo(() => ({ ...variables, visibility, setVisibility, panelStates, setPanelStates, repeaterData, setRepeaterData }), [variables, visibility, panelStates, repeaterData]);
  const screens: Array<{ screen: Screen; Component: () => ReactElement }> = [
${project.screens.map((screen, index) => `    { screen: project.screens.find((item) => item.id === ${JSON.stringify(screen.id)})!, Component: Screen${index + 1} },`).join("\n")}
  ];
  return <RuntimeContext.Provider value={runtime}>
    <nav className="sticky top-0 z-50 flex items-center gap-3 border-b bg-white p-3">
      <strong className="mr-auto">{project.name}</strong>
      <label htmlFor="screen-nav">Screen</label>
      <select id="screen-nav" value={location.pathname.startsWith("/s/") ? location.pathname.slice(3) : project.startScreenId} onChange={(event) => navigate(\`/s/\${event.currentTarget.value}\`)}>
        {project.screens.map((screen) => <option key={screen.id} value={screen.id}>{screen.name}</option>)}
      </select>
    </nav>
    <Routes>
      {screens.map(({ screen, Component }) => <Route key={screen.id} path={\`/s/\${screen.id}\`} element={<Component />} />)}
      <Route path="*" element={<Navigate to={\`/s/\${project.startScreenId}\`} replace />} />
    </Routes>
  </RuntimeContext.Provider>;
}

export default function App() {
  return <BrowserRouter><PrototypeApp /></BrowserRouter>;
}
`,
    "src/index.css": tailwindVersion === "4"
      ? `@import "tailwindcss";\n\nhtml, body, #root { min-width: 320px; min-height: 100%; margin: 0; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }\nbutton, input, textarea, select { font: inherit; }\n`
      : `@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\nhtml, body, #root { min-width: 320px; min-height: 100%; margin: 0; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }\nbutton, input, textarea, select { font: inherit; }\n`,
    "tailwind.config.ts": `const config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: { extend: {} },
  plugins: [],
};
export default config;
`,
    "README.md": `# ${project.name.replace(/[&<>]/g, "")}

React + TypeScript + Vite + Tailwind CSS ${tailwindVersion}.

## Run locally

\`\`\`sh
npm install
npm run dev
\`\`\`

\`npm run build\` creates a production build in \`dist/\`. The prototype screens are available through React Router, and the generated interaction and variable hooks are in \`src/hooks/\`.
`,
  };

  if (responsive) files["src/project/responsive.ts"] = responsiveHelperSource();
  if (tailwindVersion === "3") {
    files["postcss.config.js"] = `export default { plugins: { tailwindcss: {}, autoprefixer: {} } };\n`;
  }
  project.screens.forEach((screen, index) => {
    const fileName = `${slug(screen.name)}-${index + 1}`;
    files[`src/screens/${fileName}.tsx`] = `import { project } from "../project";
import { ScreenRenderer } from "../components/ScreenRenderer";

export default function Screen${index + 1}() {
  const screen = project.screens.find((item) => item.id === ${JSON.stringify(screen.id)})!;
  return <ScreenRenderer screen={screen} />;
}
`;
  });
  return files;
}

export async function generateReactCodeArchive(
  encodedProject: unknown,
  rawOptions: unknown,
): Promise<{ fileName: string; zipBase64: string; sizeBytes: number }> {
  const project = decodeProject(encodedProject);
  const options = exportOptions.parse(rawOptions);
  let selectedProject: Project;
  try {
    selectedProject = prepareExportProject(project, options);
  } catch (error) {
    throw new CodeExportInputError(error instanceof Error ? error.message : "Export settings do not match this project.");
  }
  const zip = new JSZip();
  for (const [path, contents] of Object.entries(buildFiles(
    selectedProject,
    options.tailwindVersion,
    options.responsive,
  ))) {
    zip.file(path, contents);
  }
  const output = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
  if (output.byteLength > MAX_CODE_EXPORT_ARCHIVE_BYTES) {
    throw new CodeExportInputError("The generated React project exceeds the 15 MiB archive limit.");
  }
  return {
    fileName: `${slug(selectedProject.name)}-react-export.zip`,
    zipBase64: encodeBase64(output),
    sizeBytes: output.byteLength,
  };
}
