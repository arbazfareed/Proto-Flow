import type { Widget } from "../project/schema";
import { getLayerCategory } from "./layerGrouping";
import type { LayerCategoryId } from "./layerGrouping";

export const LAYER_CONTAINER_TYPES = new Set([
  "group",
  "frame",
  "panel",
  "dynamic-panel",
  "dynamicPanel",
  "repeater",
  "card",
  "modal",
  "overlay",
]);

export interface LayerTreeNode {
  id: string;
  kind: "widget" | "group";
  widget?: Widget;
  groupId?: string;
  label: string;
  category: LayerCategoryId;
  children: LayerTreeNode[];
  descendantCount: number;
  maxZIndex: number;
}

export interface FlattenedLayerTreeEntry {
  node: LayerTreeNode;
  depth: number;
  isLastChild: boolean;
  ancestorContinues: boolean[];
  collapsed: boolean;
  position: number;
  siblingCount: number;
}

function widgetOrder(first: Widget, second: Widget): number {
  return second.zIndex - first.zIndex || first.id.localeCompare(second.id);
}

function nodeOrder(first: LayerTreeNode, second: LayerTreeNode): number {
  return second.maxZIndex - first.maxZIndex || first.id.localeCompare(second.id);
}

export function isLayerContainer(widget: Widget): boolean {
  return LAYER_CONTAINER_TYPES.has(widget.type);
}

export function getLayerTreeCollapseKey(node: LayerTreeNode): string | null {
  if (node.kind === "group") return node.groupId ? `semantic:${node.groupId}` : null;
  return node.widget && isLayerContainer(node.widget)
    ? `container:${node.widget.id}`
    : null;
}

export function flattenLayerHierarchy(
  roots: readonly LayerTreeNode[],
  collapsedIds: ReadonlySet<string>,
): FlattenedLayerTreeEntry[] {
  const entries: FlattenedLayerTreeEntry[] = [];
  const lastVisibleNodeIds = new WeakMap<LayerTreeNode, string>();
  const getLastVisibleNodeId = (node: LayerTreeNode): string => {
    const cached = lastVisibleNodeIds.get(node);
    if (cached) return cached;
    const collapseKey = getLayerTreeCollapseKey(node);
    const lastChild = collapseKey && collapsedIds.has(collapseKey)
      ? undefined
      : node.children[node.children.length - 1];
    const id = lastChild ? getLastVisibleNodeId(lastChild) : node.id;
    lastVisibleNodeIds.set(node, id);
    return id;
  };
  const visit = (
    nodes: readonly LayerTreeNode[],
    depth: number,
    ancestors: { hasNextSibling: boolean; lastVisibleNodeId: string }[],
  ) => {
    nodes.forEach((node, index) => {
      const isLastChild = index === nodes.length - 1;
      const collapseKey = getLayerTreeCollapseKey(node);
      const collapsed = collapseKey !== null && collapsedIds.has(collapseKey);
      entries.push({
        node,
        depth,
        isLastChild,
        ancestorContinues: ancestors.map(
          ({ hasNextSibling, lastVisibleNodeId }) =>
            hasNextSibling || node.id !== lastVisibleNodeId,
        ),
        collapsed,
        position: index + 1,
        siblingCount: nodes.length,
      });
      if (!collapsed && node.children.length > 0) {
        visit(node.children, depth + 1, [
          ...ancestors,
          { hasNextSibling: !isLastChild, lastVisibleNodeId: getLastVisibleNodeId(node) },
        ]);
      }
    });
  };
  visit(roots, 0, []);
  return entries;
}

export function filterLayerHierarchy(
  roots: readonly LayerTreeNode[],
  matches: (node: LayerTreeNode) => boolean,
): LayerTreeNode[] {
  const filterNode = (node: LayerTreeNode): LayerTreeNode | null => {
    const children = node.children
      .map(filterNode)
      .filter((child): child is LayerTreeNode => child !== null);
    if (!matches(node) && children.length === 0) return null;
    const filtered = { ...node, children };
    filtered.descendantCount = children.reduce(
      (count, child) => count + child.descendantCount + 1,
      0,
    );
    return filtered;
  };
  return roots
    .map(filterNode)
    .filter((node): node is LayerTreeNode => node !== null);
}

export function getContainerBadge(widget: Widget, childCount: number): string {
  if (widget.type === "repeater") {
    const rows = widget.props.rows;
    const count = Array.isArray(rows)
      ? rows.length
      : typeof rows === "number" && Number.isFinite(rows)
        ? Math.max(0, Math.floor(rows))
        : childCount;
    return count === 0 ? "empty" : `${count} ${count === 1 ? "row" : "rows"}`;
  }
  if (["panel", "dynamic-panel", "dynamicPanel"].includes(widget.type)) {
    const states = widget.props.states;
    const count = Array.isArray(states) ? states.length : childCount;
    return count === 0 ? "empty" : `${count} ${count === 1 ? "state" : "states"}`;
  }
  return childCount === 0
    ? "empty"
    : `${childCount} ${childCount === 1 ? "child" : "children"}`;
}

export function buildLayerHierarchy(
  widgets: readonly Widget[],
  labelForWidget: (widget: Widget) => string,
): LayerTreeNode[] {
  const orderedWidgets = [...widgets].sort(widgetOrder);
  const containerIds = new Set(
    orderedWidgets.filter(isLayerContainer).map((widget) => widget.id),
  );
  const parentByWidgetId = new Map<string, string>();

  for (const widget of orderedWidgets) {
    if (
      widget.groupId &&
      widget.groupId !== widget.id &&
      containerIds.has(widget.groupId)
    ) {
      parentByWidgetId.set(widget.id, widget.groupId);
    }
  }

  const cycleMembers = new Set<string>();
  for (const widget of orderedWidgets) {
    const path: string[] = [];
    const pathIndexes = new Map<string, number>();
    let currentId: string | undefined = widget.id;
    while (currentId && parentByWidgetId.has(currentId)) {
      const previousIndex = pathIndexes.get(currentId);
      if (previousIndex !== undefined) {
        path.slice(previousIndex).forEach((id) => cycleMembers.add(id));
        break;
      }
      pathIndexes.set(currentId, path.length);
      path.push(currentId);
      currentId = parentByWidgetId.get(currentId);
    }
  }
  for (const id of cycleMembers) parentByWidgetId.delete(id);

  const widgetNodes = new Map<string, LayerTreeNode>();
  for (const widget of orderedWidgets) {
    widgetNodes.set(widget.id, {
      id: widget.id,
      kind: "widget",
      widget,
      label: labelForWidget(widget),
      category: getLayerCategory(widget.type, widget.layerCategory),
      children: [],
      descendantCount: 0,
      maxZIndex: widget.zIndex,
    });
  }

  const groupMembers = new Map<string, Widget[]>();
  for (const widget of orderedWidgets) {
    if (
      widget.groupId &&
      !containerIds.has(widget.groupId) &&
      !parentByWidgetId.has(widget.id)
    ) {
      const members = groupMembers.get(widget.groupId) ?? [];
      members.push(widget);
      groupMembers.set(widget.groupId, members);
    }
  }

  const groupNodes = new Map<string, LayerTreeNode>();
  for (const [groupId, members] of groupMembers) {
    const sortedMembers = members.sort(widgetOrder);
    groupNodes.set(groupId, {
      id: `semantic:${groupId}`,
      kind: "group",
      groupId,
      label: "Group",
      category: getLayerCategory(sortedMembers[0].type, sortedMembers[0].layerCategory),
      children: sortedMembers.map((widget) => widgetNodes.get(widget.id)!),
      descendantCount: 0,
      maxZIndex: sortedMembers[0].zIndex,
    });
  }

  for (const widget of orderedWidgets) {
    const parentId = parentByWidgetId.get(widget.id);
    if (parentId) {
      widgetNodes.get(parentId)?.children.push(widgetNodes.get(widget.id)!);
    }
  }

  for (const node of widgetNodes.values()) {
    node.children.sort((first, second) => {
      const firstWidget = first.widget;
      const secondWidget = second.widget;
      return firstWidget && secondWidget
        ? widgetOrder(firstWidget, secondWidget)
        : nodeOrder(first, second);
    });
  }

  const roots = orderedWidgets
    .filter((widget) => {
      if (parentByWidgetId.has(widget.id)) return false;
      if (widget.groupId && groupNodes.has(widget.groupId)) return false;
      return true;
    })
    .map((widget) => widgetNodes.get(widget.id)!);
  roots.push(...groupNodes.values());

  const attached = new Set<string>();
  const markAttached = (node: LayerTreeNode) => {
    if (node.kind === "widget" && node.widget) attached.add(node.widget.id);
    node.children.forEach(markAttached);
  };
  roots.forEach(markAttached);
  for (const widget of orderedWidgets) {
    if (!attached.has(widget.id)) roots.push(widgetNodes.get(widget.id)!);
  }

  const visitedNodes = new Set<string>();
  const finalize = (node: LayerTreeNode) => {
    if (visitedNodes.has(node.id)) return;
    visitedNodes.add(node.id);
    node.children = node.children.filter((child) => child.id !== node.id);
    node.children.forEach(finalize);
    node.descendantCount = node.children.reduce(
      (count, child) => count + 1 + child.descendantCount,
      0,
    );
    node.maxZIndex = node.children.reduce(
      (maxZIndex, child) => Math.max(maxZIndex, child.maxZIndex),
      node.widget?.zIndex ?? Number.NEGATIVE_INFINITY,
    );
  };
  roots.forEach(finalize);

  return roots.sort(nodeOrder);
}
