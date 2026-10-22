import type { Project } from "../project/schema";

export const PREVIEW_RUNTIME_SCRIPT = String.raw`
const project = JSON.parse(document.getElementById("project-data").textContent);
const stage = document.getElementById("stage");
const screenPicker = document.getElementById("screen-picker");
const backButton = document.getElementById("back");
const variables = new Map(project.variables.map((item) => [item.id, item.initial]));
function allWidgets(widgets) {
  return widgets.flatMap((item) => [item,
    ...(item.type === "dynamic-panel" ? (item.props.states || []).flatMap((state) => allWidgets(state.widgets || [])) : []),
    ...(item.type === "repeater" ? allWidgets(item.props.rowTemplate?.widgets || []) : [])]);
}
const visibility = new Map(project.screens.flatMap((screen) => allWidgets(screen.widgets).map((item) => [item.id, item.visible])));
const panelStates = new Map();
const panelTransitions = new Map();
const repeaterData = new Map();
let screenId = project.startScreenId;
let backStack = [];
let loadedScreen = "";
function screen() {
  return project.screens.find((item) => item.id === screenId) || project.screens[0];
}
function variable(name, activeScreen) {
  const item = project.variables.find((entry) => entry.name === name && entry.scope === "screen" && entry.screenId === activeScreen)
    || project.variables.find((entry) => entry.name === name && entry.scope === "project");
  return item ? variables.get(item.id) : undefined;
}
function setVariable(name, value, activeScreen) {
  const item = project.variables.find((entry) => entry.name === name && entry.scope === "screen" && entry.screenId === activeScreen)
    || project.variables.find((entry) => entry.name === name && entry.scope === "project");
  if (item && typeof value === typeof item.initial) variables.set(item.id, value);
}
function text(value, activeScreen, item) {
  return String(value ?? "").replace(/\{\{\s*([\w$.-]+)\s*\}\}/g, (_, name) => {
    if (name.startsWith("item.")) return String(item?.[name.slice(5)] ?? "");
    return String(variable(name, activeScreen) ?? "");
  });
}
function repeaterRows(value) {
  let rows = value;
  if (typeof rows === "string") {
    try { rows = JSON.parse(rows); } catch { throw new Error("Repeater data must be valid JSON."); }
  }
  if (!Array.isArray(rows) || rows.length > 1000 || rows.some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
    throw new Error("Repeater data must contain at most 1,000 record objects.");
  }
  return rows;
}
function repeaterItemVisible(widget, item) {
  const rule = widget.props.visibleWhen;
  if (!rule || typeof rule.field !== "string" || typeof rule.operator !== "string") return true;
  const actual = item[rule.field];
  switch (rule.operator) {
    case "notEquals": return actual !== rule.value;
    case "contains": return typeof actual === "string" && actual.includes(String(rule.value ?? ""));
    case "greaterThan": return typeof actual === "number" && typeof rule.value === "number" && actual > rule.value;
    case "lessThan": return typeof actual === "number" && typeof rule.value === "number" && actual < rule.value;
    default: return actual === rule.value;
  }
}
function interpolateActionValue(value, item) {
  if (typeof value === "string") return text(value, screen().id, item);
  if (Array.isArray(value)) return value.map((entry) => interpolateActionValue(entry, item));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, interpolateActionValue(entry, item)]));
  return value;
}
function actionValue(value, item) {
  const interpolated = interpolateActionValue(value, item);
  if (typeof interpolated !== "string") return interpolated;
  try { return JSON.parse(interpolated); } catch { return interpolated; }
}
function matches(condition, activeScreen) {
  const current = variable(condition.variable, activeScreen);
  switch (condition.operator) {
    case "equals": return current === condition.value;
    case "notEquals": return current !== condition.value;
    case "greaterThan": return current > condition.value;
    case "greaterThanOrEqual": return current >= condition.value;
    case "lessThan": return current < condition.value;
    case "lessThanOrEqual": return current <= condition.value;
    case "contains": return typeof current === "string" && current.includes(condition.value);
    default: return false;
  }
}
function actions(rule, activeScreen, item) {
  for (const action of rule.actions) {
    if (action.type === "navigate" || action.type === "navigateTo") {
      if (project.screens.some((item) => item.id === action.target) && action.target !== screenId) {
        backStack.push(screenId);
        screenId = action.target;
        loadedScreen = "";
      }
    } else if (action.type === "show" || action.type === "hide") {
      visibility.set(action.target, action.type === "show");
    } else if (action.type === "setVariable") {
      setVariable(action.target, action.value, activeScreen);
    } else if (action.type === "setPanelState") {
      const panel = allWidgets(screen().widgets).find((item) => item.id === action.target);
      const states = panel?.props.states || [];
      const state = states.find((item) => item.id === action.stateId || item.id === action.value || item.name === action.value);
      if (states.length && !state) throw new Error("The requested panel state does not exist.");
      panelStates.set(action.target, state?.id || action.stateId || action.value);
      panelTransitions.set(action.target, { transition: action.transition || "none", duration: action.duration || 0 });
    } else if (action.type === "setRepeaterData") {
      repeaterData.set(action.target, repeaterRows(actionValue(action.value, item)));
    } else if (["addRepeaterRow", "removeRepeaterRow", "sortRepeater", "filterRepeater"].includes(action.type)) {
      const repeater = allWidgets(screen().widgets).find((entry) => entry.id === action.target && entry.type === "repeater");
      if (!repeater) throw new Error("Repeater action target is missing.");
      const rows = repeaterRows(repeaterData.get(action.target) ?? repeater.props.dataset ?? []);
      if (action.type === "addRepeaterRow") {
        const row = actionValue(action.value, item);
        repeaterData.set(action.target, repeaterRows([...rows, row && typeof row === "object" ? row : {}]));
      } else if (action.type === "removeRepeaterRow") {
        const index = Number(actionValue(action.value, item));
        if (!Number.isInteger(index) || index < 0 || index >= rows.length) throw new Error("Repeater row index must reference an existing row.");
        repeaterData.set(action.target, rows.filter((_, rowIndex) => rowIndex !== index));
      } else {
        const config = actionValue(action.value, item);
        if (!config || typeof config !== "object" || typeof config.field !== "string") throw new Error("Repeater sort/filter action requires a field.");
        if (action.type === "sortRepeater") {
          const direction = config.direction === "desc" ? -1 : 1;
          repeaterData.set(action.target, rows.slice().sort((a, b) => String(a[config.field] ?? "").localeCompare(String(b[config.field] ?? ""), undefined, { numeric: true }) * direction));
        } else {
          repeaterData.set(action.target, rows.filter((row) => config.operator === "contains"
            ? String(row[config.field] ?? "").includes(String(config.value ?? ""))
            : config.operator === "notEquals" ? row[config.field] !== config.value : row[config.field] === config.value));
        }
      }
    }
  }
}
function fire(widget, event, item) {
  const activeScreen = screen();
  for (const rule of activeScreen.interactionRules.filter((item) => item.event === event && (!item.widgetId || item.widgetId === widget.id))) {
    const checks = rule.conditions.map((condition) => matches(condition, activeScreen.id));
    if (rule.conditions.length && (rule.conditionMode === "any" ? !checks.some(Boolean) : !checks.every(Boolean))) continue;
    actions(rule, activeScreen.id, item);
  }
  render();
}
function renderWidget(widget, activeScreen, item) {
  const element = document.createElement(widget.type === "button" || widget.type === "icon-button" ? "button" : "div");
  element.className = "widget";
  element.style.left = widget.x + "px";
  element.style.top = widget.y + "px";
  element.style.width = widget.width + "px";
  element.style.height = widget.height + "px";
  element.style.zIndex = String(widget.zIndex);
  element.style.transform = widget.rotation ? "rotate(" + widget.rotation + "deg)" : "";
  element.style.opacity = String(widget.opacity);
  element.style.color = typeof widget.props.color === "string" ? widget.props.color : "#24212b";
  element.style.backgroundColor = widget.style.fill || "transparent";
  element.style.border = widget.style.stroke ? (widget.style.strokeWidth || 1) + "px solid " + widget.style.stroke : "none";
  element.style.borderRadius = typeof widget.style.cornerRadius === "number" ? widget.style.cornerRadius + "px" : "";
  element.style.fontFamily = typeof widget.props.fontFamily === "string" ? widget.props.fontFamily : "Arial, sans-serif";
  element.style.fontSize = (typeof widget.props.fontSize === "number" ? widget.props.fontSize : 16) + "px";
  element.style.fontWeight = typeof widget.props.fontWeight === "string" ? widget.props.fontWeight : "normal";
  element.style.textAlign = typeof widget.props.align === "string" ? widget.props.align : "left";
  element.style.padding = (typeof widget.props.padding === "number" ? widget.props.padding : 8) + "px";
  element.style.whiteSpace = "pre-wrap";
  const rawText = widget.props.text ?? widget.props.label ?? widget.props.title ?? "";
  const shownText = text(rawText, activeScreen.id, item);
  if (widget.type === "ellipse" || widget.type === "circle") element.style.borderRadius = "50%";
  if (widget.type === "button" || widget.type === "icon-button") element.textContent = shownText || "Button";
  else if (widget.type === "input" || widget.type === "search" || widget.type === "textarea") {
    const input = document.createElement(widget.type === "textarea" ? "textarea" : "input");
    input.type = widget.type === "search" ? "search" : (typeof widget.props.type === "string" ? widget.props.type : "text");
    input.setAttribute("aria-label", text(widget.props.label || "Preview input", activeScreen.id, item));
    input.placeholder = text(widget.props.placeholder || "", activeScreen.id, item);
    input.value = String(widget.props.value ?? "");
    input.addEventListener("input", () => {
      const binding = widget.props.variableName ?? widget.props.variable;
      if (typeof binding === "string") {
        const definition = project.variables.find((item) => item.name === binding && (item.scope === "project" || item.screenId === activeScreen.id));
        if (definition) setVariable(binding, definition.type === "number" ? Number(input.value) : input.value, activeScreen.id);
      }
    });
    input.addEventListener("change", () => fire(widget, "onChange", item));
    element.append(input);
  } else if (["checkbox", "toggle", "radio"].includes(widget.type)) {
    const input = document.createElement("input");
    input.type = widget.type === "radio" ? "radio" : "checkbox";
    input.checked = widget.props.checked === true || widget.props.selected === true || widget.props.on === true;
    input.setAttribute("aria-label", shownText || widget.type);
    input.addEventListener("change", () => {
      const binding = widget.props.variableName ?? widget.props.variable;
      if (typeof binding === "string") setVariable(binding, input.checked, activeScreen.id);
      fire(widget, "onChange", item);
    });
    element.append(input, document.createTextNode(shownText));
  } else if (widget.type === "image") {
    const src = text(typeof widget.props.src === "string" ? widget.props.src : "", activeScreen.id, item);
    if (src.startsWith("data:image/") || src.startsWith("assets/")) {
      const image = document.createElement("img");
      image.src = src;
      image.alt = text(widget.props.alt || shownText, activeScreen.id, item);
      element.append(image);
    } else element.textContent = shownText || "Image";
  } else if (widget.type === "list" && Array.isArray(widget.props.items)) {
    const list = document.createElement("ul");
    for (const listItem of widget.props.items) {
      const row = document.createElement("li");
      row.textContent = text(listItem, activeScreen.id, item);
      list.append(row);
    }
    element.append(list);
  } else if (widget.type === "repeater") {
    const rows = repeaterRows(repeaterData.get(widget.id) ?? widget.props.dataset ?? []);
    const template = widget.props.rowTemplate?.widgets || [];
    const layout = ["horizontal", "grid"].includes(widget.props.layout) ? widget.props.layout : "vertical";
    element.replaceChildren();
    element.style.display = layout === "grid" ? "grid" : "flex";
    element.style.flexDirection = layout === "horizontal" ? "row" : "column";
    element.style.gridTemplateColumns = layout === "grid" ? "repeat(auto-fill,minmax(120px,1fr))" : "";
    element.style.gap = Math.max(0, Number(widget.props.gap) || 0) + "px";
    element.style.overflow = "visible";
    element.style.height = layout === "horizontal" ? widget.height + "px" : Math.max(widget.height, rows.length * (widget.height + (Number(widget.props.gap) || 0))) + "px";
    for (const [index, rowData] of rows.entries()) {
      const row = document.createElement("div");
      row.className = "repeater-row";
      row.style.position = "relative";
      row.style.flex = layout === "horizontal" ? "0 0 " + widget.width + "px" : "0 0 auto";
      row.style.width = widget.width + "px";
      row.style.height = widget.height + "px";
      row.style.overflow = "hidden";
      row.addEventListener("click", () => fire(widget, "onClick", rowData));
      for (const child of template) {
        if (child.visible && visibility.get(child.id) !== false && repeaterItemVisible(child, rowData)) row.append(renderWidget(child, activeScreen, rowData));
      }
      element.append(row);
    }
  } else {
    element.textContent = shownText || widget.type.replaceAll("-", " ");
  }
  if (widget.type !== "repeater") element.addEventListener("click", () => fire(widget, "onClick", item));
  element.addEventListener("mouseenter", () => fire(widget, "onHover", item));
  element.addEventListener("touchstart", () => fire(widget, "onTouchStart", item), { passive: true });
  element.addEventListener("touchend", () => {
    fire(widget, "onTouchEnd", item);
    fire(widget, "onTap", item);
  }, { passive: true });
  const panelState = panelStates.get(widget.id);
  if (panelState) element.dataset.panelState = panelState;
  const owner = widget.groupId ? allWidgets(activeScreen.widgets).find((item) => item.id === widget.groupId) : undefined;
  const transition = owner ? panelTransitions.get(owner.id) : undefined;
  if (transition && transition.transition !== "none" && transition.duration > 0) {
    element.style.animation = "protoflow-panel-" + transition.transition + " " + transition.duration + "ms ease both";
  }
  return element;
}
function activeWidgets(widgets, depth = 0) {
  if (depth > 5) return [];
  return widgets.flatMap((widget) => {
    if (widget.type !== "dynamic-panel") return [widget];
    const states = widget.props.states || [];
    const stateId = panelStates.get(widget.id) || widget.props.activeStateId;
    const state = states.find((item) => item.id === stateId) || states[0];
    return [widget, ...(state ? activeWidgets(state.widgets || [], depth + 1) : [])];
  });
}
function render() {
  const activeScreen = screen();
  screenPicker.replaceChildren();
  for (const item of project.screens) {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.name;
    option.selected = item.id === activeScreen.id;
    screenPicker.append(option);
  }
  backButton.disabled = backStack.length === 0;
  stage.replaceChildren();
  const device = activeScreen.device || { width: 1280, height: 800 };
  stage.style.width = device.width + "px";
  stage.style.height = device.height + "px";
  for (const widget of activeWidgets(activeScreen.widgets).sort((a, b) => a.zIndex - b.zIndex)) {
    if (visibility.get(widget.id) === false || widget.visible === false) continue;
    stage.append(renderWidget(widget, activeScreen));
  }
  if (loadedScreen !== activeScreen.id) {
    loadedScreen = activeScreen.id;
    for (const rule of activeScreen.interactionRules.filter((item) => item.event === "onLoad")) {
      const checks = rule.conditions.map((condition) => matches(condition, activeScreen.id));
      if (!rule.conditions.length || (rule.conditionMode === "any" ? checks.some(Boolean) : checks.every(Boolean))) {
        actions(rule, activeScreen.id);
      }
    }
    if (loadedScreen === screenId) return;
    render();
  }
}
screenPicker.addEventListener("change", () => {
  if (project.screens.some((item) => item.id === screenPicker.value)) {
    backStack.push(screenId);
    screenId = screenPicker.value;
    loadedScreen = "";
    render();
  }
});
backButton.addEventListener("click", () => {
  screenId = backStack.pop() || screenId;
  loadedScreen = "";
  render();
});
document.getElementById("restart").addEventListener("click", () => {
  variables.clear();
  for (const item of project.variables) variables.set(item.id, item.initial);
  visibility.clear();
  for (const item of project.screens.flatMap((entry) => allWidgets(entry.widgets))) visibility.set(item.id, item.visible);
  panelStates.clear();
  panelTransitions.clear();
  repeaterData.clear();
  screenId = project.startScreenId;
  backStack = [];
  loadedScreen = "";
  render();
});
render();
`;

export const PREVIEW_RUNTIME_STYLES = `*{box-sizing:border-box}html,body{margin:0;min-height:100%;font:14px system-ui,sans-serif;background:#15131b;color:#f5f3fa}
.toolbar{position:sticky;top:0;z-index:2147483647;display:flex;gap:8px;align-items:center;padding:10px;background:#211e29;border-bottom:1px solid #37323f}
.toolbar button,.toolbar select{min-height:32px;border:1px solid #494353;border-radius:6px;padding:5px 9px;background:#302b39;color:inherit}
.toolbar button:disabled{opacity:.45}.stage-wrap{padding:28px;overflow:auto}.stage{position:relative;margin:0 auto;background:#fff;color:#24212b;overflow:hidden;box-shadow:0 12px 42px #0007}
.widget{position:absolute;overflow:hidden;white-space:pre-wrap}.widget img{width:100%;height:100%;object-fit:cover}.widget textarea,.widget input{max-width:100%;font:inherit}ul{margin:0;padding-left:20px}
@keyframes protoflow-panel-fade{from{opacity:0}to{opacity:1}}
@keyframes protoflow-panel-slide-left{from{translate:20px 0}to{translate:0 0}}
@keyframes protoflow-panel-slide-right{from{translate:-20px 0}to{translate:0 0}}
@keyframes protoflow-panel-slide-up{from{translate:0 20px}to{translate:0 0}}
@keyframes protoflow-panel-slide-down{from{translate:0 -20px}to{translate:0 0}}
@media(prefers-reduced-motion:reduce){.widget[style*="protoflow-panel-"]{animation:none!important}}`;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function serializeProject(project: Project): string {
  return JSON.stringify(project)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

export function generatePublishedPreviewHtml(project: Project): string {
  const startScreen = project.screens.find((screen) => screen.id === project.startScreenId);
  if (!startScreen) throw new Error("The project start screen is missing.");
  const title = escapeHtml(project.name);
  const projectData = serializeProject(project);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${title} — ProtoFlow preview</title>
<style>${PREVIEW_RUNTIME_STYLES}</style>
</head>
<body>
<header class="toolbar"><button id="back" type="button" aria-label="Back">Back</button><select id="screen-picker" aria-label="Preview screen"></select><button id="restart" type="button">Restart</button><span>Published with ProtoFlow</span></header>
<main class="stage-wrap"><section id="stage" class="stage" aria-label="Prototype preview"></section></main>
<script id="project-data" type="application/json">${projectData}</script>
<script>${PREVIEW_RUNTIME_SCRIPT}</script>
</body>
</html>`;
}

export function getPublishedProjectData(html: string): string | null {
  const match = html.match(/<script id="project-data" type="application\/json">([\s\S]*?)<\/script>/);
  return match?.[1] ?? null;
}

export function publishedBundleSize(html: string): number {
  return new TextEncoder().encode(html).byteLength;
}
