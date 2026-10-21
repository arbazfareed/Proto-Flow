import type { Project } from "../project/schema";

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
        rule.conditions.every((condition) => variableNames.has(condition.variable)) &&
        rule.actions.every((action) => action.type !== "setVariable" || variableNames.has(action.target)),
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
  return `import { useState, type CSSProperties } from "react";

const project = ${jsxString(project)};
type Widget = typeof project.screens[number]["widgets"][number];

export default function App() {
  const [screenId, setScreenId] = useState(project.startScreenId);
  const screen = project.screens.find((item) => item.id === screenId) ?? project.screens[0];
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
  const label = (widget: Widget) => String(widget.props.text ?? widget.props.label ?? widget.props.title ?? widget.type);
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 16 }}>
      <label>
        Screen{" "}
        <select value={screen.id} onChange={(event) => setScreenId(event.target.value)}>
          {project.screens.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      <section style={{ position: "relative", width: screen.device?.width ?? 1440, height: screen.device?.height ?? 900, margin: "16px auto", background: "#fff", overflow: "hidden" }}>
        {screen.widgets.filter((widget) => widget.visible).sort((a, b) => a.zIndex - b.zIndex).map((widget) => {
          const text = label(widget);
          if (["button", "icon-button"].includes(widget.type)) {
            return <button key={widget.id} type="button" style={style(widget)}>{text}</button>;
          }
          if (widget.type === "image" && typeof widget.props.src === "string" && widget.props.src) {
            return <img key={widget.id} src={widget.props.src} alt={String(widget.props.alt ?? text)} style={{ ...style(widget), objectFit: "cover" }} />;
          }
          if (["input", "search", "textarea"].includes(widget.type)) {
            return widget.type === "textarea"
              ? <textarea key={widget.id} aria-label={String(widget.props.label ?? "Preview input")} placeholder={String(widget.props.placeholder ?? "")} style={style(widget)} />
              : <input key={widget.id} type={widget.type === "search" ? "search" : String(widget.props.type ?? "text")} aria-label={String(widget.props.label ?? "Preview input")} placeholder={String(widget.props.placeholder ?? "")} style={style(widget)} />;
          }
          return <div key={widget.id} style={style(widget)}>{text}</div>;
        })}
      </section>
    </main>
  );
}
`;
}
