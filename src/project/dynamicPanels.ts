import type { Widget } from "./schema";

export const PANEL_TRANSITIONS = [
  "none",
  "fade",
  "slide-left",
  "slide-right",
  "slide-up",
  "slide-down",
] as const;

export type PanelTransition = (typeof PANEL_TRANSITIONS)[number];

export interface DynamicPanelState {
  id: string;
  name: string;
  widgets: Widget[];
}

function isState(value: unknown): value is DynamicPanelState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  return typeof state.id === "string" &&
    typeof state.name === "string" &&
    Array.isArray(state.widgets);
}

export function getPanelStates(widget: Widget): DynamicPanelState[] {
  const states = widget.props.states;
  return Array.isArray(states) ? states.filter(isState) : [];
}

export function getActivePanelState(
  widget: Widget,
  preferredStateId?: string,
): DynamicPanelState | undefined {
  const states = getPanelStates(widget);
  const activeStateId = preferredStateId ??
    (typeof widget.props.activeStateId === "string" ? widget.props.activeStateId : undefined);
  return states.find((state) => state.id === activeStateId) ?? states[0];
}

export function withPanelStates(
  widget: Widget,
  states: DynamicPanelState[],
  activeStateId = widget.props.activeStateId,
): Widget {
  const selectedId = typeof activeStateId === "string" &&
    states.some((state) => state.id === activeStateId)
    ? activeStateId
    : states[0]?.id ?? "";
  return {
    ...widget,
    props: {
      ...widget.props,
      states,
      activeStateId: selectedId,
    },
  };
}

export function flattenActivePanelWidgets(
  widgets: Widget[],
  activeStates: Record<string, string> = {},
  depth = 0,
): Widget[] {
  if (depth > 5) return [];
  return widgets.flatMap((widget) => {
    const panelContents = widget.type === "dynamic-panel"
      ? getActivePanelState(widget, activeStates[widget.id])?.widgets ?? []
      : [];
    const children = panelContents.map((child) => ({
      ...child,
      groupId: child.groupId ?? widget.id,
    }));
    return [
      widget,
      ...flattenActivePanelWidgets(children, activeStates, depth + 1),
    ];
  });
}

export function mapWidgetsDeep(
  widgets: Widget[],
  update: (widget: Widget) => Widget | null,
): Widget[] {
  return widgets.flatMap((widget) => {
    const changed = update(widget);
    if (!changed) return [];
    if (changed.type !== "dynamic-panel") return [changed];
    const states = getPanelStates(changed).map((state) => ({
      ...state,
      widgets: mapWidgetsDeep(state.widgets, update),
    }));
    return [withPanelStates(changed, states)];
  });
}

export function collectWidgetsDeep(widgets: Widget[]): Widget[] {
  return widgets.flatMap((widget) => [
    widget,
    ...(widget.type === "dynamic-panel"
      ? getPanelStates(widget).flatMap((state) => collectWidgetsDeep(state.widgets))
      : []),
  ]);
}

export function updatePanelState(
  widgets: Widget[],
  panelId: string,
  update: (panel: Widget, states: DynamicPanelState[]) => Widget,
): Widget[] {
  return mapWidgetsDeep(widgets, (widget) =>
    widget.id === panelId && widget.type === "dynamic-panel"
      ? update(widget, getPanelStates(widget))
      : widget,
  );
}

export function addWidgetsToPanelState(
  widgets: Widget[],
  panelId: string,
  stateId: string,
  additions: Widget[],
): Widget[] {
  return updatePanelState(widgets, panelId, (panel, states) => {
    const nextStates = states.map((state) =>
      state.id === stateId
        ? {
            ...state,
            widgets: [
              ...state.widgets,
              ...additions.map((widget) => ({ ...widget, groupId: panel.id })),
            ],
          }
        : state,
    );
    return withPanelStates(panel, nextStates);
  });
}

export function mergeActivePanelWidgets(
  rootWidgets: Widget[],
  activeWidgets: Widget[],
  editScope: { panelId: string; stateId: string } | null,
): Widget[] {
  const visibleIds = new Set(flattenActivePanelWidgets(rootWidgets).map((widget) => widget.id));
  const desiredById = new Map(activeWidgets.map((widget) => [widget.id, widget]));
  let next = mapWidgetsDeep(rootWidgets, (widget) => {
    if (!visibleIds.has(widget.id)) return widget;
    return desiredById.get(widget.id) ?? null;
  });
  const additions = activeWidgets.filter((widget) => !visibleIds.has(widget.id));
  if (additions.length === 0) return next;
  if (editScope) {
    const panel = collectWidgetsDeep(next).find((widget) => widget.id === editScope.panelId);
    if (panel && getPanelStates(panel).some((state) => state.id === editScope.stateId)) {
      next = addWidgetsToPanelState(next, editScope.panelId, editScope.stateId, additions);
      return next;
    }
  }
  return [...next, ...additions];
}
