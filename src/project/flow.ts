import dagre from "@dagrejs/dagre";
import type { Project, Screen } from "./schema";

export interface FlowEdge {
  id: string;
  ruleId: string;
  actionIndex: number;
  sourceScreenId: string;
  targetScreenId: string;
  widgetId?: string;
  label: string;
  event: string;
}

export interface FlowPosition {
  x: number;
  y: number;
}

export const FLOW_NODE_WIDTH = 224;
export const FLOW_NODE_HEIGHT = 190;
export const FLOW_COLUMN_GAP = 112;
export const FLOW_ROW_GAP = 36;

const OPERATOR_LABELS: Record<string, string> = {
  equals: "=",
  notEquals: "!=",
  greaterThan: ">",
  greaterThanOrEqual: ">=",
  lessThan: "<",
  lessThanOrEqual: "<=",
  contains: "contains",
};

function printableValue(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "expression";
}

export function getNavigationEdges(project: Project): FlowEdge[] {
  const screenIds = new Set(project.screens.map((screen) => screen.id));
  return project.screens.flatMap((screen) =>
    screen.interactionRules.flatMap((rule) =>
      rule.actions.flatMap((action, actionIndex) => {
        if (
          (action.type !== "navigate" && action.type !== "navigateTo") ||
          !screenIds.has(action.target)
        ) {
          return [];
        }
        const conditions = rule.conditions.map((condition) =>
          `${condition.variable} ${OPERATOR_LABELS[condition.operator] ?? condition.operator} ${printableValue(condition.value)}`,
        );
        const stateChanges = rule.actions
          .filter((ruleAction) => ruleAction.type === "setVariable")
          .map((ruleAction) => `${ruleAction.target} ← ${printableValue(ruleAction.value)}`);
        const labels = [
          ...(conditions.length > 0 ? [conditions.join(" AND ")] : []),
          ...stateChanges,
        ];
        return [{
          id: `${rule.id}:${actionIndex}`,
          ruleId: rule.id,
          actionIndex,
          sourceScreenId: screen.id,
          targetScreenId: action.target,
          ...(rule.widgetId ? { widgetId: rule.widgetId } : {}),
          label: labels.join(" · ") || rule.event,
          event: rule.event,
        }];
      }),
    ),
  );
}

export function autoLayoutScreens(
  screens: Screen[],
  edges: FlowEdge[],
  startScreenId: string,
): Record<string, FlowPosition> {
  const adjacency = new Map(screens.map((screen) => [screen.id, [] as string[]]));
  for (const edge of edges) {
    adjacency.get(edge.sourceScreenId)?.push(edge.targetScreenId);
  }
  const start = screens.some((screen) => screen.id === startScreenId)
    ? startScreenId
    : screens[0]?.id;
  const reachable = new Set(start ? [start] : []);
  const queue = start ? [start] : [];
  let deepestReachable = start;
  for (let index = 0; index < queue.length; index += 1) {
    const source = queue[index];
    for (const target of adjacency.get(source) ?? []) {
      if (reachable.has(target)) continue;
      reachable.add(target);
      queue.push(target);
      deepestReachable = target;
    }
  }

  const graph = new dagre.graphlib.Graph({ multigraph: true })
    .setGraph({
      rankdir: "LR",
      nodesep: FLOW_ROW_GAP,
      ranksep: FLOW_COLUMN_GAP,
      marginx: 48,
      marginy: 48,
    })
    .setDefaultEdgeLabel(() => ({}));
  for (const screen of screens) {
    graph.setNode(screen.id, { width: FLOW_NODE_WIDTH, height: FLOW_NODE_HEIGHT });
  }
  for (const edge of edges) {
    graph.setEdge(edge.sourceScreenId, edge.targetScreenId);
  }
  for (const screen of screens) {
    if (reachable.has(screen.id) || !deepestReachable) continue;
    graph.setEdge(deepestReachable, screen.id, { minlen: 2, weight: 0 }, `layout:${screen.id}`);
  }
  dagre.layout(graph);
  const positions: Record<string, FlowPosition> = {};
  for (const screen of screens) {
    const node = graph.node(screen.id);
    if (!node) throw new Error(`Dagre did not return a position for screen "${screen.name}".`);
    positions[screen.id] = {
      x: node.x - FLOW_NODE_WIDTH / 2,
      y: node.y - FLOW_NODE_HEIGHT / 2,
    };
  }
  return positions;
}

export function getInitialFlowPositions(
  screens: Screen[],
  edges: FlowEdge[],
  startScreenId: string,
): Record<string, FlowPosition> {
  const positions = autoLayoutScreens(screens, edges, startScreenId);
  for (const screen of screens) {
    if (screen.flowPosition) positions[screen.id] = screen.flowPosition;
  }
  return positions;
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function buildFlowSvg(
  project: Project,
  positions: Record<string, FlowPosition>,
  edges = getNavigationEdges(project),
): string {
  const screensById = new Map(project.screens.map((screen) => [screen.id, screen]));
  const width = Math.max(
    640,
    ...project.screens.map((screen) => (positions[screen.id]?.x ?? 0) + FLOW_NODE_WIDTH + 48),
  );
  const height = Math.max(
    360,
    ...project.screens.map((screen) => (positions[screen.id]?.y ?? 0) + FLOW_NODE_HEIGHT + 48),
  );
  const paths = edges.flatMap((edge) => {
    const source = positions[edge.sourceScreenId];
    const target = positions[edge.targetScreenId];
    if (!source || !target) return [];
    const startX = source.x + FLOW_NODE_WIDTH;
    const startY = source.y + 74;
    const endX = target.x;
    const endY = target.y + 74;
    const midpoint = (startX + endX) / 2;
    return [
      `<path d="M ${startX} ${startY} C ${midpoint} ${startY}, ${midpoint} ${endY}, ${endX} ${endY}" fill="none" stroke="#9a7cf2" stroke-width="2" marker-end="url(#arrow)"/>`,
      `<text x="${midpoint}" y="${(startY + endY) / 2 - 8}" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#ded8ed">${escapeXml(edge.label)}</text>`,
    ];
  }).join("");
  const nodes = project.screens.map((screen) => {
    const position = positions[screen.id] ?? { x: 0, y: 0 };
    const deviceWidth = screen.device?.width ?? 1280;
    const deviceHeight = screen.device?.height ?? 800;
    const thumbX = position.x + 12;
    const thumbY = position.y + 48;
    const thumbWidth = FLOW_NODE_WIDTH - 24;
    const thumbHeight = 128;
    const scale = Math.min(thumbWidth / deviceWidth, thumbHeight / deviceHeight);
    const previewWidth = deviceWidth * scale;
    const previewHeight = deviceHeight * scale;
    const previewX = thumbX + (thumbWidth - previewWidth) / 2;
    const previewY = thumbY + (thumbHeight - previewHeight) / 2;
    const widgets = screen.widgets.filter((widget) => widget.visible).map((widget) => {
      const color = /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(widget.style.fill ?? "")
        ? widget.style.fill
        : "#9a7cf2";
      const x = previewX + widget.x * scale;
      const y = previewY + widget.y * scale;
      const note = widget.notes;
      const priorityColor = note ? {
        low: "#7196e8",
        medium: "#d5a446",
        high: "#e57945",
        critical: "#e04f59",
      }[note.priority] : "";
      return [
        `<rect x="${x}" y="${y}" width="${Math.max(2, widget.width * scale)}" height="${Math.max(2, widget.height * scale)}" rx="2" fill="${color}" opacity="${widget.opacity}"/>`,
        ...(note && (note.description || note.requirementId || note.tags.length || Object.keys(note.custom).length)
          ? [`<circle cx="${x + Math.max(2, widget.width * scale)}" cy="${y}" r="4" fill="${priorityColor}"><title>${escapeXml(`${note.priority}: ${note.description.slice(0, 100) || note.requirementId || note.tags.join(", ") || Object.entries(note.custom).map(([key, value]) => `${key}: ${value}`).join(", ")}`)}</title></circle>`]
          : []),
      ].join("");
    }).join("");
    return [
      `<g><rect x="${position.x}" y="${position.y}" width="${FLOW_NODE_WIDTH}" height="${FLOW_NODE_HEIGHT}" rx="12" fill="#202126" stroke="#8067c4" stroke-width="2"/>`,
      `<text x="${position.x + 12}" y="${position.y + 30}" font-family="sans-serif" font-size="15" font-weight="600" fill="#f2eff8">${escapeXml(screen.name)}</text>`,
      `<rect x="${thumbX}" y="${thumbY}" width="${thumbWidth}" height="${thumbHeight}" rx="5" fill="#fff" stroke="#5a5b64"/>`,
      widgets,
      `<text x="${position.x + 12}" y="${position.y + 184}" font-family="sans-serif" font-size="11" fill="#aaa6b2">${escapeXml(screen.id === project.startScreenId ? "Start screen" : screen.device?.presetId ?? "Screen")}</text></g>`,
    ].join("");
  }).join("");
  const missingTarget = edges.some((edge) => !screensById.has(edge.targetScreenId));
  if (missingTarget) throw new Error("The flow diagram contains a link to a missing screen.");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><marker id="arrow" markerWidth="10" markerHeight="8" refX="8" refY="4" orient="auto"><path d="M 0 0 L 10 4 L 0 8 z" fill="#9a7cf2"/></marker></defs><rect width="100%" height="100%" fill="#151619"/>${paths}${nodes}</svg>`;
}
