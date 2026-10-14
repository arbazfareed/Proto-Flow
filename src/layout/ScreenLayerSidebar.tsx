import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, DragEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  ChevronDown,
  ChevronRight,
  Check,
  CircleSlash,
  AlertTriangle,
  Eye,
  EyeOff,
  FilePlus2,
  Folder,
  Layers2,
  Lock,
  Monitor,
  MoreHorizontal,
  PanelTop,
  Plus,
  Search,
  Sparkles,
  Unlock,
  X,
} from "lucide-react";
import { getShapeToolDefinition } from "../canvas/shapeTools";
import { DEFAULT_DEVICE_PRESET, findDevicePreset, toScreenDevice } from "../devices/catalog";
import { DevicePicker } from "../devices/DevicePicker";
import type { DeviceCategory, ScreenDevice } from "../devices/types";
import { reorderScreens } from "../project/layers";
import { createDefaultBreakpoints } from "../project/responsive";
import type { Project, Screen, Widget } from "../project/schema";
import {
  setActiveLayerDragPayload,
  LAYER_DRAG_MIME,
  reorderWidgetSet,
  serializeLayerDragPayload,
} from "../project/layerDrag";
import { useStore } from "../store";
import { CategoryHeader } from "./CategoryHeader";
import {
  buildLayerGroups,
  getLayerCategory,
  LAYER_CATEGORIES,
  LAYER_CATEGORY_DEFINITIONS,
  LAYER_VIEW_MODES,
} from "./layerGrouping";
import type { LayerCategoryId, LayerGroup, LayerViewMode } from "./layerGrouping";
import { getVirtualizedRange } from "./layerVirtualization";
import {
  createDefaultLayerTreePreferences,
  layerGroupCollapseKey,
  layerGroupNameKey,
  parseLayerTreePreferences,
  reorderLayerGroupIds,
  serializeLayerTreePreferences,
} from "./layerTreePreferences";
import type { LayerTreePreferences } from "./layerTreePreferences";
import { ScreenIcon, WidgetIcon } from "./widgetIcons";
import { ScreenThumbnail } from "./ScreenThumbnail";
import {
  buildLayerHierarchy,
  filterLayerHierarchy,
  flattenLayerHierarchy,
  getContainerBadge,
  getLayerTreeCollapseKey,
  isLayerContainer,
} from "./layerTree";
import type { FlattenedLayerTreeEntry, LayerTreeNode } from "./layerTree";

type MenuState =
  | { kind: "screen" | "layer" | "group"; id: string; x: number; y: number }
  | null;

type DropIndicator = { id: string; edge: "before" | "after" } | null;
type LayerDropIndicator = { id: string; edge: "before" | "after" | "inside" } | null;
type LayerTreeEntry =
  | { kind: "category"; group: LayerGroup; collapsed: boolean; visibleCount: number }
  | ({ kind: "node" } & FlattenedLayerTreeEntry);
const LAYER_ROW_HEIGHT = 30;
const SCREEN_TREE_ROW_HEIGHT = 34;
const SCREEN_ROW_HEIGHT = 152;

function collapsedStorageKey(projectId: string): string {
  return `protoflow:collapsed-layer-groups:${projectId}`;
}

function preferencesStorageKey(projectId: string): string {
  return `protoflow:layer-tree-view:${projectId}`;
}

function readLayerTreePreferences(projectId: string): LayerTreePreferences {
  try {
    return parseLayerTreePreferences(localStorage.getItem(preferencesStorageKey(projectId)));
  } catch (error) {
    console.error("Could not read the saved layer-tree view preferences.", error);
    return createDefaultLayerTreePreferences();
  }
}

function persistLayerTreePreferences(projectId: string, preferences: LayerTreePreferences): void {
  try {
    localStorage.setItem(preferencesStorageKey(projectId), serializeLayerTreePreferences(preferences));
  } catch (error) {
    console.error("Could not save the layer-tree view preferences.", error);
  }
}

function readCollapsedGroups(projectId: string): Record<string, string[]> {
  try {
    const stored = localStorage.getItem(collapsedStorageKey(projectId));
    if (!stored) return {};
    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string[]] =>
          Array.isArray(entry[1]) && entry[1].every((id) => typeof id === "string"),
      ),
    );
  } catch (error) {
    console.error("Could not read the saved layer-tree collapse state.", error);
    return {};
  }
}

function widgetLabel(widget: Widget): string {
  if (widget.name) return widget.name;
  const values = widget.type === "image"
    ? [widget.props.fileName, widget.props.alt, widget.props.text]
    : [widget.props.label, widget.props.text, widget.props.fileName];
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  if (widget.type === "image") return "Untitled asset";
  return getShapeToolDefinition(widget.type)?.label ?? widget.type;
}

function screenIconCategory(device: ScreenDevice | undefined): DeviceCategory {
  if (!device) return DEFAULT_DEVICE_PRESET.category;
  const preset = findDevicePreset(device.presetId);
  if (preset) return preset.category;
  if (device.height > device.width * 1.2) {
    return device.width >= 600 ? "tablet" : "phone";
  }
  return "desktop";
}

function categoryAccent(widget: Widget): string {
  return LAYER_CATEGORY_DEFINITIONS[
    getLayerCategory(widget.type, widget.layerCategory)
  ].badge;
}

function wouldCreateLayerCycle(
  widgets: readonly Widget[],
  draggedIds: readonly string[],
  targetId: string,
): boolean {
  const dragged = new Set(draggedIds);
  if (dragged.has(targetId)) return true;
  const widgetsById = new Map(widgets.map((widget) => [widget.id, widget]));
  const visited = new Set<string>();
  let ancestorId = widgetsById.get(targetId)?.groupId;
  while (ancestorId && !visited.has(ancestorId)) {
    if (dragged.has(ancestorId)) return true;
    visited.add(ancestorId);
    ancestorId = widgetsById.get(ancestorId)?.groupId;
  }
  return false;
}

function findLayerTreeNode(
  nodes: readonly LayerTreeNode[],
  widgetId: string,
): LayerTreeNode | undefined {
  for (const node of nodes) {
    if (node.widget?.id === widgetId) return node;
    const nested = findLayerTreeNode(node.children, widgetId);
    if (nested) return nested;
  }
  return undefined;
}

function layerNodeDomId(node: LayerTreeNode): string {
  return node.widget
    ? `layer-row-${node.widget.id}`
    : `layer-group-${node.groupId ?? node.id}`;
}

function beginLayerDrag(
  event: DragEvent<HTMLElement>,
  widgets: Widget[],
  label: string,
): void {
  if (widgets.length === 0) return;
  const payload = {
    version: 1 as const,
    kind: "widgets" as const,
    widgetIds: widgets.map((widget) => widget.id),
  };
  setActiveLayerDragPayload(payload);
  event.dataTransfer.effectAllowed = "copyMove";
  event.dataTransfer.setData(
    LAYER_DRAG_MIME,
    serializeLayerDragPayload(payload),
  );
  event.dataTransfer.setData("text/plain", label);

  const ghost = document.createElement("div");
  Object.assign(ghost.style, {
    position: "fixed",
    left: "-10000px",
    top: "0",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    minWidth: "120px",
    padding: "8px",
    border: "1px solid #625486",
    borderRadius: "7px",
    color: "#f0edf7",
    background: "#24222c",
    font: "12px sans-serif",
    opacity: "0.6",
    pointerEvents: "none",
  });
  const sourceIcon =
    event.currentTarget.querySelector<SVGElement>(".layer-select > svg") ??
    event.currentTarget.querySelector<SVGElement>(".layer-group-row > svg");
  if (sourceIcon) {
    const icon = sourceIcon.cloneNode(true) as SVGElement;
    Object.assign(icon.style, { width: "24px", height: "24px", flex: "0 0 24px" });
    ghost.append(icon);
  } else {
    const placeholder = document.createElement("span");
    Object.assign(placeholder.style, {
      display: "grid",
      width: "64px",
      height: "64px",
      placeItems: "center",
      border: "1px solid #625486",
      borderRadius: "4px",
    });
    placeholder.textContent = "PF";
    ghost.append(placeholder);
  }
  const caption = document.createElement("span");
  caption.textContent = `${label} · ${widgets.length} item${widgets.length === 1 ? "" : "s"}`;
  ghost.append(caption);
  document.body.append(ghost);
  event.dataTransfer.setDragImage(ghost, 34, 34);
  window.setTimeout(() => ghost.remove(), 1200);
}

function beginScreenDrag(event: DragEvent<HTMLElement>, screen: Screen): void {
  setActiveLayerDragPayload({ version: 1, kind: "screen", screenId: screen.id });
  event.dataTransfer.effectAllowed = "copyMove";
  event.dataTransfer.setData(
    LAYER_DRAG_MIME,
    serializeLayerDragPayload({ version: 1, kind: "screen", screenId: screen.id }),
  );
  event.dataTransfer.setData("text/plain", screen.name);
  const ghost = document.createElement("div");
  Object.assign(ghost.style, {
    position: "fixed",
    left: "-10000px",
    top: "0",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "8px",
    border: "1px solid #625486",
    borderRadius: "7px",
    color: "#f0edf7",
    background: "#24222c",
    font: "12px sans-serif",
    opacity: "0.6",
    pointerEvents: "none",
  });
  const sourceThumbnail =
    event.currentTarget.querySelector<HTMLImageElement>(".screen-thumbnail img");
  if (sourceThumbnail) {
    const preview = sourceThumbnail.cloneNode() as HTMLImageElement;
    Object.assign(preview.style, {
      width: "64px",
      height: "40px",
      objectFit: "contain",
      border: "1px solid #625486",
      borderRadius: "4px",
    });
    ghost.append(preview);
  }
  ghost.append(document.createTextNode(screen.name));
  document.body.append(ghost);
  event.dataTransfer.setDragImage(ghost, 34, 34);
  window.setTimeout(() => ghost.remove(), 1200);
}

function editProject(update: (project: Project) => Project): void {
  const current = useStore.getState();
  current.setProject({
    ...update(current.project),
    updatedAt: new Date().toISOString(),
  });
}

function commitScreenRename(screenId: string, name: string): void {
  const normalized = name.trim().slice(0, 120);
  if (!normalized) return;
  if (useStore.getState().project.screens.find((screen) => screen.id === screenId)?.name === normalized) {
    return;
  }
  editProject((project) => ({
    ...project,
    screens: project.screens.map((screen) =>
      screen.id === screenId ? { ...screen, name: normalized } : screen,
    ),
  }));
}

function duplicateScreen(screen: Screen): Screen {
  const groupIds = new Map<string, string>();
  const widgetIds = new Map<string, string>();
  const widgets = screen.widgets.map((widget) => {
    const id = crypto.randomUUID();
    widgetIds.set(widget.id, id);
    if (widget.groupId && !groupIds.has(widget.groupId)) {
      groupIds.set(widget.groupId, crypto.randomUUID());
    }
    return {
      ...widget,
      id,
      groupId: widget.groupId ? groupIds.get(widget.groupId) : undefined,
    };
  });
  return {
    ...screen,
    id: crypto.randomUUID(),
    name: `${screen.name} copy`.slice(0, 120),
    widgets,
    interactionRules: screen.interactionRules.map((rule) => ({
      ...rule,
      id: crypto.randomUUID(),
      actions: rule.actions.map((action) => ({
        ...action,
        target: widgetIds.get(action.target) ?? action.target,
      })),
    })),
  };
}

export function ScreenLayerSidebar() {
  const project = useStore((state) => state.project);
  const activeScreenId = useStore((state) => state.getActiveScreenId());
  const activeBreakpointId = useStore((state) => state.activeBreakpointId);
  const selectedIds = useStore((state) => state.selectedIds);
  const hoveredWidgetId = useStore((state) => state.hoveredWidgetId);
  const activeScreen = project.screens.find((screen) => screen.id === activeScreenId);
  const [menu, setMenu] = useState<MenuState>(null);
  const [renamingScreenId, setRenamingScreenId] = useState<string | null>(null);
  const [renamingWidgetId, setRenamingWidgetId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [screenPickerOpen, setScreenPickerOpen] = useState(false);
  const [deviceTargetScreenId, setDeviceTargetScreenId] = useState<string | null>(null);
  const [draggedScreenId, setDraggedScreenId] = useState<string | null>(null);
  const [draggedLayerIds, setDraggedLayerIds] = useState<string[]>([]);
  const [dropIndicator, setDropIndicator] = useState<LayerDropIndicator>(null);
  const [collapsedByScreen, setCollapsedByScreen] = useState(() =>
    readCollapsedGroups(project.id),
  );
  const [layerPreferences, setLayerPreferences] = useState(() =>
    readLayerTreePreferences(project.id),
  );
  const [categorySearch, setCategorySearch] = useState("");
  const [categoryMenu, setCategoryMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [draggedCategoryId, setDraggedCategoryId] = useState<string | null>(null);
  const [categoryDropIndicator, setCategoryDropIndicator] = useState<DropIndicator>(null);
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [renameGroupDraft, setRenameGroupDraft] = useState("");
  const [movePickerOpen, setMovePickerOpen] = useState(false);
  const [layerScrollTop, setLayerScrollTop] = useState(0);
  const [layerViewportHeight, setLayerViewportHeight] = useState(300);
  const [screenScrollTop, setScreenScrollTop] = useState(0);
  const [screenViewportHeight, setScreenViewportHeight] = useState(240);
  const [recentWidgetIds, setRecentWidgetIds] = useState<Set<string>>(() => new Set());
  const cancelScreenRenameRef = useRef(false);
  const cancelWidgetRenameRef = useRef(false);
  const layerTreeRef = useRef<HTMLDivElement>(null);
  const screenListRef = useRef<HTMLDivElement>(null);
  const previousWidgetIdsRef = useRef<{ screenId: string; ids: Set<string> } | null>(null);
  const recentWidgetTimersRef = useRef(new Map<string, number>());
  const autoExpandTimerRef = useRef<number | null>(null);
  const autoExpandTargetRef = useRef<string | null>(null);

  useEffect(() => {
    const list = screenListRef.current;
    if (!list) return;
    const updateHeight = () => setScreenViewportHeight(list.clientHeight || 240);
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(list);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const previous = previousWidgetIdsRef.current;
    const ids = new Set(activeScreen?.widgets.map((widget) => widget.id) ?? []);
    if (previous?.screenId === activeScreenId) {
      const added = [...ids].filter((id) => !previous.ids.has(id));
      if (added.length > 0) {
        setRecentWidgetIds((current) => new Set([...current, ...added]));
        for (const id of added) {
          const previousTimer = recentWidgetTimersRef.current.get(id);
          if (previousTimer !== undefined) window.clearTimeout(previousTimer);
          recentWidgetTimersRef.current.set(id, window.setTimeout(() => {
            setRecentWidgetIds((current) => {
              const next = new Set(current);
              next.delete(id);
              return next;
            });
            recentWidgetTimersRef.current.delete(id);
          }, 200));
        }
      }
    }
    previousWidgetIdsRef.current = { screenId: activeScreenId, ids };
  }, [activeScreen, activeScreenId]);

  useEffect(() => () => {
    for (const timer of recentWidgetTimersRef.current.values()) window.clearTimeout(timer);
    if (autoExpandTimerRef.current !== null) window.clearTimeout(autoExpandTimerRef.current);
  }, []);

  useEffect(() => {
    setLayerScrollTop(0);
    if (layerTreeRef.current) layerTreeRef.current.scrollTop = 0;
  }, [activeScreenId]);

  useEffect(() => {
    const layerList = layerTreeRef.current;
    if (!layerList) return;
    const updateViewportHeight = () => setLayerViewportHeight(layerList.clientHeight);
    updateViewportHeight();
    const observer = new ResizeObserver(updateViewportHeight);
    observer.observe(layerList);
    return () => observer.disconnect();
  }, [activeScreenId, Boolean(activeScreen?.widgets.length)]);

  useEffect(() => {
    setCollapsedByScreen(readCollapsedGroups(project.id));
    setLayerPreferences(readLayerTreePreferences(project.id));
    setCategorySearch("");
  }, [project.id]);

  useEffect(() => {
    if (!menu) return;
    const closeMenu = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".tree-context-menu")) {
        setMenu(null);
      }
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    window.addEventListener("pointerdown", closeMenu);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [menu]);

  useEffect(() => {
    if (!categoryMenu) return;
    const closeMenu = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".tree-context-menu")) {
        setCategoryMenu(null);
      }
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setCategoryMenu(null);
    };
    window.addEventListener("pointerdown", closeMenu);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [categoryMenu]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p") {
        if (
          event.target instanceof HTMLElement &&
          (event.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName))
        ) return;
        if (selectedIds.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        setMovePickerOpen(true);
        return;
      }
      if (event.key === "Escape" && movePickerOpen) {
        setMovePickerOpen(false);
        return;
      }
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "g") return;
      if (
        event.target instanceof HTMLElement &&
        (event.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName))
      ) return;
      if (!activeScreen || selectedIds.length === 0) return;

      const selected = new Set(selectedIds);
      if (event.shiftKey) {
        const hasGroup = activeScreen.widgets.some(
          (widget) => selected.has(widget.id) && widget.groupId,
        );
        if (!hasGroup) return;
        editProject((current) => ({
          ...current,
          screens: current.screens.map((screen) =>
            screen.id !== activeScreen.id
              ? screen
              : {
                  ...screen,
                  widgets: screen.widgets.map((widget) =>
                    selected.has(widget.id) ? { ...widget, groupId: undefined } : widget,
                  ),
                },
          ),
        }));
      } else {
        const groupMembers = activeScreen.widgets.filter((widget) => selected.has(widget.id));
        if (groupMembers.length < 2) return;
        const groupId = crypto.randomUUID();
        editProject((current) => ({
          ...current,
          screens: current.screens.map((screen) =>
            screen.id !== activeScreen.id
              ? screen
              : {
                  ...screen,
                  widgets: screen.widgets.map((widget) =>
                    selected.has(widget.id) ? { ...widget, groupId } : widget,
                  ),
                },
          ),
        }));
      }
      event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeScreen, movePickerOpen, selectedIds]);

  const collapsedGroups = collapsedByScreen[activeScreenId] ?? [];
  const updateLayerPreferences = (update: (preferences: LayerTreePreferences) => LayerTreePreferences) => {
    setLayerPreferences((current) => {
      const next = update(current);
      persistLayerTreePreferences(project.id, next);
      return next;
    });
  };
  const layerMode = layerPreferences.mode;
  const layerGroups = useMemo(() => {
    const query = categorySearch.trim().toLowerCase();
    const widgets = activeScreen?.widgets ?? [];
    const filteredWidgets = query
      ? widgets.filter((widget) => {
          const definition = getShapeToolDefinition(widget.type);
        const groupId = layerMode === "category"
          ? getLayerCategory(widget.type, widget.layerCategory)
          : widget.type;
        const groupName =
          layerPreferences.groupNames[layerGroupNameKey(layerMode, groupId)] ??
          (layerMode === "category"
            ? LAYER_CATEGORY_DEFINITIONS[getLayerCategory(widget.type, widget.layerCategory)].label
            : definition?.label ?? widget.type);
        const categoryLabel = layerMode === "category"
          ? LAYER_CATEGORY_DEFINITIONS[getLayerCategory(widget.type, widget.layerCategory)].label
          : "";
        return (
          widgetLabel(widget).toLowerCase().includes(query) ||
          widget.type.toLowerCase().includes(query) ||
          (definition?.label ?? "").toLowerCase().includes(query) ||
          groupName.toLowerCase().includes(query) ||
          categoryLabel.toLowerCase().includes(query)
        );
        })
      : widgets;
    const savedOrder = layerPreferences.groupOrder[layerMode] ?? [];
    let groups = buildLayerGroups(
      filteredWidgets,
      layerMode,
      savedOrder,
      (type) => getShapeToolDefinition(type)?.label ?? type,
    );
    if (layerMode === "category" && draggedLayerIds.length > 0 && draggedCategoryId === null) {
      const groupsById = new Map(groups.map((group) => [group.id, group]));
      const order: LayerCategoryId[] = [
        ...savedOrder.filter((id): id is LayerCategoryId => LAYER_CATEGORIES.includes(id as LayerCategoryId)),
        ...LAYER_CATEGORIES.filter((id) => !savedOrder.includes(id)),
      ];
      groups = order.map((id) => groupsById.get(id) ?? ({
        id,
        label: LAYER_CATEGORY_DEFINITIONS[id].label,
        category: id,
        widgets: [],
      }));
    }
    return groups.map((group) => ({
      ...group,
      label: layerPreferences.groupNames[layerGroupNameKey(layerMode, group.id)] ?? group.label,
    }));
  }, [
    activeScreen,
    categorySearch,
    layerMode,
    draggedCategoryId,
    draggedLayerIds,
    layerPreferences.groupNames,
    layerPreferences.groupOrder,
  ]);
  const hierarchyRoots = useMemo(() => {
    const roots = buildLayerHierarchy(activeScreen?.widgets ?? [], widgetLabel);
    const query = categorySearch.trim().toLowerCase();
    return query
      ? filterLayerHierarchy(roots, (node) =>
          node.label.toLowerCase().includes(query) ||
          node.widget?.type.toLowerCase().includes(query) === true ||
          LAYER_CATEGORY_DEFINITIONS[node.category].label.toLowerCase().includes(query),
        )
      : roots;
  }, [activeScreen, categorySearch]);
  const layerEntries = useMemo<LayerTreeEntry[]>(() => {
    const entries: LayerTreeEntry[] = [];
    const collapsedIds = new Set(collapsedGroups);
    const groupWidgetIds = new Set<string>();
    const claimedRootIds = new Set<string>();
    const addDescendantIds = (node: LayerTreeNode) => {
      if (node.widget) groupWidgetIds.add(node.widget.id);
      node.children.forEach(addDescendantIds);
    };
    const appendRoots = (roots: LayerTreeNode[]) => {
      const flattened = flattenLayerHierarchy(roots, collapsedIds);
      for (const entry of flattened) entries.push({ kind: "node", ...entry });
    };

    if (layerMode === "z-order") {
      appendRoots(hierarchyRoots);
      return entries;
    }

    for (const group of layerGroups) {
      const collapsed = collapsedGroups.includes(layerGroupCollapseKey(layerMode, group.id));
      const matchingWidgetIds = new Set(group.widgets.map((widget) => widget.id));
      const roots = hierarchyRoots.filter((root) => {
        if (claimedRootIds.has(root.id)) return false;
        groupWidgetIds.clear();
        addDescendantIds(root);
        const containsMatchingWidget = [...groupWidgetIds].some((id) => matchingWidgetIds.has(id));
        const isPrimaryGroup = layerMode === "category"
          ? root.category === group.category
          : root.widget?.type === group.id ||
            (!root.widget && root.children[0]?.widget?.type === group.id);
        const matches = categorySearch.trim()
          ? containsMatchingWidget
          : isPrimaryGroup;
        if (matches) claimedRootIds.add(root.id);
        return matches;
      });
      if (roots.length === 0) continue;
      entries.push({ kind: "category", group, collapsed, visibleCount: roots.length });
      if (!collapsed) appendRoots(roots);
      groupWidgetIds.clear();
    }
    return entries;
  }, [categorySearch, collapsedGroups, hierarchyRoots, layerGroups, layerMode]);
  const virtualizedRange = getVirtualizedRange(
    layerEntries.length,
    Math.max(0, layerScrollTop - SCREEN_TREE_ROW_HEIGHT),
    Math.max(0, layerViewportHeight - SCREEN_TREE_ROW_HEIGHT),
    LAYER_ROW_HEIGHT,
  );
  const visibleLayerEntries = layerEntries.slice(virtualizedRange.start, virtualizedRange.end);
  const lastLayerNodeId = useMemo(() => {
    for (let index = layerEntries.length - 1; index >= 0; index -= 1) {
      const entry = layerEntries[index];
      if (entry.kind === "node") return entry.node.id;
    }
    return undefined;
  }, [layerEntries]);
  const visibleLayerNodeIds = new Set(
    visibleLayerEntries
      .filter((entry): entry is Extract<LayerTreeEntry, { kind: "node" }> => entry.kind === "node")
      .map((entry) => entry.node.id),
  );
  useEffect(() => {
    const focusWidgetId = hoveredWidgetId ?? selectedIds[0];
    if (!focusWidgetId) return;
    const findAncestors = (
      nodes: readonly LayerTreeNode[],
      targetId: string,
      ancestors: string[] = [],
    ): string[] | null => {
      for (const node of nodes) {
        const nextAncestors = getLayerTreeCollapseKey(node)
          ? [...ancestors, getLayerTreeCollapseKey(node)!]
          : ancestors;
        if (node.widget?.id === targetId) return ancestors;
        const nested = findAncestors(node.children, targetId, nextAncestors);
        if (nested) return nested;
      }
      return null;
    };
    const ancestors = findAncestors(
      buildLayerHierarchy(activeScreen?.widgets ?? [], widgetLabel),
      focusWidgetId,
    );
    const categoryKeys = layerMode === "z-order"
      ? []
      : layerGroups
          .filter((group) => group.widgets.some((widget) => widget.id === focusWidgetId))
          .map((group) => layerGroupCollapseKey(layerMode, group.id));
    const collapsedPath = [...(ancestors ?? []), ...categoryKeys];
    if (collapsedPath.some((key) => collapsedGroups.includes(key))) {
      const nextCollapsed = collapsedGroups.filter((key) => !collapsedPath.includes(key));
      const next = { ...collapsedByScreen, [activeScreenId]: nextCollapsed };
      setCollapsedByScreen(next);
      try {
        localStorage.setItem(collapsedStorageKey(project.id), JSON.stringify(next));
      } catch (error) {
        console.error("Could not save the layer-tree collapse state.", error);
      }
      return;
    }
    const entryIndex = layerEntries.findIndex(
      (entry) => entry.kind === "node" && entry.node.widget?.id === focusWidgetId,
    );
    if (entryIndex < 0) return;
    const rowTop = entryIndex * LAYER_ROW_HEIGHT;
    const list = layerTreeRef.current;
    if (list && (rowTop < list.scrollTop || rowTop + LAYER_ROW_HEIGHT > list.scrollTop + list.clientHeight)) {
      list.scrollTop = rowTop;
      setLayerScrollTop(rowTop);
    }
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`layer-row-${focusWidgetId}`)?.scrollIntoView({ block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    activeScreen,
    activeScreenId,
    collapsedByScreen,
    collapsedGroups,
    hoveredWidgetId,
    layerEntries,
    project.id,
    layerGroups,
    layerMode,
    selectedIds,
  ]);
  const screenVirtualizedRange = project.screens.length > 20
    ? getVirtualizedRange(
        project.screens.length,
        screenScrollTop,
        screenViewportHeight,
        SCREEN_ROW_HEIGHT,
        3,
      )
    : {
        start: 0,
        end: project.screens.length,
        topSpacerHeight: 0,
        bottomSpacerHeight: 0,
      };
  const visibleScreens = project.screens.slice(
    screenVirtualizedRange.start,
    screenVirtualizedRange.end,
  );

  const addScreen = (device: ScreenDevice) => {
    const name = device.presetId === "custom"
      ? `Custom ${device.width} × ${device.height}`
      : findDevicePreset(device.presetId)?.name ?? `Screen ${project.screens.length + 1}`;
    const screen: Screen = {
      id: crypto.randomUUID(),
      name,
      device,
      breakpoints: createDefaultBreakpoints(device.width, device.height),
      widgets: [],
      interactionRules: [],
    };
    editProject((current) => ({ ...current, screens: [...current.screens, screen] }));
    useStore.getState().setActiveScreen(screen.id);
    setScreenPickerOpen(false);
  };

  const changeScreenDevice = (device: ScreenDevice, scaleWidgets: boolean) => {
    if (!deviceTargetScreenId) return;
    const target = project.screens.find((screen) => screen.id === deviceTargetScreenId);
    if (!target) return;
    const previous = target.device ?? toScreenDevice(DEFAULT_DEVICE_PRESET);
    const scaleX = device.width / previous.width;
    const scaleY = device.height / previous.height;
    editProject((current) => ({
      ...current,
      screens: current.screens.map((screen) =>
        screen.id !== deviceTargetScreenId
          ? screen
          : {
              ...screen,
              device,
              widgets: scaleWidgets
                ? screen.widgets.map((widget) => ({
                    ...widget,
                    x: Math.max(-100_000, Math.min(100_000, widget.x * scaleX)),
                    y: Math.max(-100_000, Math.min(100_000, widget.y * scaleY)),
                    width: Math.max(1, widget.width * scaleX),
                    height: Math.max(1, widget.height * scaleY),
                  }))
                : screen.widgets,
            },
      ),
    }));
    setScreenPickerOpen(false);
    setDeviceTargetScreenId(null);
  };

  const deleteScreen = (screenId: string) => {
    if (project.screens.length <= 1) return;
    const remaining = project.screens.filter((screen) => screen.id !== screenId);
    const deletedStartScreen = project.startScreenId === screenId;
    editProject((current) => ({
      ...current,
      screens: remaining,
      startScreenId: deletedStartScreen ? remaining[0].id : current.startScreenId,
    }));
    if (activeScreenId === screenId) {
      useStore.getState().setActiveScreen(remaining[0].id);
    }
    setMenu(null);
  };

  const startScreenRename = (screen: Screen) => {
    setRenamingScreenId(screen.id);
    setRenameDraft(screen.name);
  };

  const finishScreenRename = (screenId: string) => {
    if (cancelScreenRenameRef.current) {
      cancelScreenRenameRef.current = false;
      setRenamingScreenId(null);
      return;
    }
    commitScreenRename(screenId, renameDraft);
    setRenamingScreenId(null);
  };

  const setWidgetProperty = (widgetId: string, patch: Partial<Widget>) => {
    if (!activeScreen) return;
    editProject((current) => ({
      ...current,
      screens: current.screens.map((screen) =>
        screen.id !== activeScreen.id
          ? screen
          : {
              ...screen,
              widgets: screen.widgets.map((widget) =>
                widget.id === widgetId ? { ...widget, ...patch } : widget,
              ),
            },
      ),
    }));
  };

  const deleteWidgets = (widgetIds: string[]) => {
    if (!activeScreen) return;
    const ids = new Set(widgetIds);
    editProject((current) => ({
      ...current,
      screens: current.screens.map((screen) =>
        screen.id !== activeScreen.id
          ? screen
          : { ...screen, widgets: screen.widgets.filter((widget) => !ids.has(widget.id)) },
      ),
    }));
    const current = useStore.getState();
    current.select(current.selectedIds.filter((id) => !ids.has(id)));
    setMenu(null);
  };

  const duplicateWidget = (widgetId: string) => {
    if (!activeScreen) return;
    const source = activeScreen.widgets.find((widget) => widget.id === widgetId);
    if (!source) return;
    const duplicate: Widget = {
      ...source,
      id: crypto.randomUUID(),
      name: source.name ? `${source.name} copy`.slice(0, 120) : undefined,
      x: source.x + 16,
      y: source.y + 16,
      zIndex: Math.max(0, ...activeScreen.widgets.map((widget) => widget.zIndex)) + 1,
    };
    editProject((current) => ({
      ...current,
      screens: current.screens.map((screen) =>
        screen.id === activeScreen.id
          ? { ...screen, widgets: [...screen.widgets, duplicate] }
          : screen,
      ),
    }));
    useStore.getState().select([duplicate.id]);
    setMenu(null);
  };

  const toggleGroup = (groupId: string, collapseKey = layerGroupCollapseKey(layerMode, groupId)) => {
    const nextForScreen = collapsedGroups.includes(collapseKey)
      ? collapsedGroups.filter((id) => id !== collapseKey)
      : [...collapsedGroups, collapseKey];
    const next = { ...collapsedByScreen, [activeScreenId]: nextForScreen };
    setCollapsedByScreen(next);
    try {
      localStorage.setItem(collapsedStorageKey(project.id), JSON.stringify(next));
    } catch (error) {
      console.error("Could not save the layer-tree collapse state.", error);
    }
  };

  const setTreeCollapsed = (root: LayerTreeNode, collapsed: boolean) => {
    const keys = new Set<string>();
    const visit = (node: LayerTreeNode) => {
      const key = getLayerTreeCollapseKey(node);
      if (key) keys.add(key);
      node.children.forEach(visit);
    };
    visit(root);
    const nextForScreen = collapsed
      ? [...new Set([...collapsedGroups, ...keys])]
      : collapsedGroups.filter((key) => !keys.has(key));
    const next = { ...collapsedByScreen, [activeScreenId]: nextForScreen };
    setCollapsedByScreen(next);
    try {
      localStorage.setItem(collapsedStorageKey(project.id), JSON.stringify(next));
    } catch (error) {
      console.error("Could not save the layer-tree collapse state.", error);
    }
  };

  const setAllGroupsCollapsed = (collapsed: boolean) => {
    const activeKeys = new Set(
      buildLayerGroups(activeScreen?.widgets ?? [], layerMode, []).map(
        (group) => layerGroupCollapseKey(layerMode, group.id),
      ),
    );
    const collectTreeKeys = (node: LayerTreeNode) => {
      const key = getLayerTreeCollapseKey(node);
      if (key) activeKeys.add(key);
      node.children.forEach(collectTreeKeys);
    };
    buildLayerHierarchy(activeScreen?.widgets ?? [], widgetLabel).forEach(collectTreeKeys);
    const nextForScreen = collapsed
      ? [...new Set([...collapsedGroups, ...activeKeys])]
      : collapsedGroups.filter((id) => !activeKeys.has(id));
    const next = { ...collapsedByScreen, [activeScreenId]: nextForScreen };
    setCollapsedByScreen(next);
    try {
      localStorage.setItem(collapsedStorageKey(project.id), JSON.stringify(next));
    } catch (error) {
      console.error("Could not save the layer-tree collapse state.", error);
    }
  };

  const setWidgetsProperty = (widgets: Widget[], patch: Partial<Widget>) => {
    if (!activeScreen || widgets.length === 0) return;
    const ids = new Set(widgets.map((widget) => widget.id));
    editProject((current) => ({
      ...current,
      screens: current.screens.map((screen) =>
        screen.id !== activeScreen.id
          ? screen
          : {
              ...screen,
              widgets: screen.widgets.map((widget) =>
                ids.has(widget.id) ? { ...widget, ...patch } : widget,
              ),
            },
      ),
    }));
    if (patch.visible === false || patch.locked === true) {
      const current = useStore.getState();
      current.select(current.selectedIds.filter((id) => !ids.has(id)));
    }
  };

  const setAllVisibility = () => {
    const widgets = activeScreen?.widgets ?? [];
    setWidgetsProperty(widgets, { visible: widgets.some((widget) => !widget.visible) });
  };

  const setAllLockState = () => {
    const widgets = activeScreen?.widgets ?? [];
    setWidgetsProperty(widgets, { locked: !widgets.every((widget) => widget.locked) });
  };

  const reorderCategoryGroups = (
    draggedId: string,
    targetId: string,
    edge: "before" | "after",
  ) => {
    const visibleIds = layerGroups.map((group) => group.id);
    const defaultOrder = layerMode === "category"
      ? [...LAYER_CATEGORIES]
      : buildLayerGroups(
          activeScreen?.widgets ?? [],
          layerMode,
          [],
          (type) => getShapeToolDefinition(type)?.label ?? type,
        ).map((group) => group.id);
    updateLayerPreferences((current) => ({
      ...current,
      groupOrder: {
        ...current.groupOrder,
        [layerMode]: reorderLayerGroupIds(
          current.groupOrder[layerMode] ?? defaultOrder,
          visibleIds,
          draggedId,
          targetId,
          edge,
        ),
      },
    }));
  };

  const categoryDragOver = (event: DragEvent<HTMLDivElement>, groupId: string) => {
    const isCategoryReorder = draggedCategoryId !== null && draggedCategoryId !== groupId;
    const isWidgetMove = draggedCategoryId === null &&
      draggedLayerIds.length > 0 &&
      layerMode === "category";
    if (!isCategoryReorder && !isWidgetMove) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const bounds = event.currentTarget.getBoundingClientRect();
    const edge = event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
    setCategoryDropIndicator({ id: groupId, edge });
    const tree = layerTreeRef.current;
    if (tree) {
      const treeBounds = tree.getBoundingClientRect();
      const topDistance = event.clientY - treeBounds.top;
      const bottomDistance = treeBounds.bottom - event.clientY;
      if (topDistance < 28) tree.scrollTop -= Math.max(1, Math.ceil((28 - topDistance) / 28 * 6));
      else if (bottomDistance < 28) tree.scrollTop += Math.max(1, Math.ceil((28 - bottomDistance) / 28 * 6));
    }
  };

  const categoryDrop = (event: DragEvent<HTMLDivElement>, groupId: string) => {
    event.preventDefault();
    event.stopPropagation();
    const edge = categoryDropIndicator?.id === groupId ? categoryDropIndicator.edge : "before";
    if (draggedCategoryId) {
      reorderCategoryGroups(draggedCategoryId, groupId, edge);
    } else if (layerMode === "category" && draggedLayerIds.length > 0) {
      const category = LAYER_CATEGORIES.find((categoryId) => categoryId === groupId);
      if (!category) return;
      const ids = new Set(draggedLayerIds);
      editProject((current) => ({
        ...current,
        screens: current.screens.map((screen) =>
          screen.id !== activeScreenId
            ? screen
            : {
                ...screen,
                widgets: screen.widgets.map((widget) =>
                  ids.has(widget.id)
                    ? { ...widget, layerCategory: category }
                    : widget,
                ),
              },
        ),
      }));
    }
    setDraggedLayerIds([]);
    setDraggedCategoryId(null);
    setCategoryDropIndicator(null);
  };

  const navigateLayerTree = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (
      event.target !== event.currentTarget &&
      event.target instanceof HTMLElement &&
      event.target.closest("button, input")
    ) return;
    const collapseKey = event.currentTarget.dataset.collapseKey;
    const widgetId = event.currentTarget.dataset.widgetId;
    const widget = widgetId ? activeScreen?.widgets.find((item) => item.id === widgetId) : undefined;
    const expanded = event.currentTarget.getAttribute("aria-expanded") === "true";
    const currentIndex = Number(event.currentTarget.dataset.entryIndex);
    const getDepth = (index: number) => {
      const entry = layerEntries[index];
      return entry?.kind === "node" ? entry.depth : 0;
    };
    const focusEntry = (index: number) => {
      const list = layerTreeRef.current;
      if (!list || index < 0 || index >= layerEntries.length) return;
      const row = list.querySelector<HTMLElement>(`[data-entry-index="${index}"]`);
      if (row) {
        row.focus();
        return;
      }
      const top = index * LAYER_ROW_HEIGHT;
      list.scrollTop = Math.max(0, top - Math.floor(list.clientHeight / 2));
      setLayerScrollTop(list.scrollTop);
      window.requestAnimationFrame(() => {
        list.querySelector<HTMLElement>(`[data-entry-index="${index}"]`)?.focus();
      });
    };
    const consumeTreeKey = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    if (event.key === "Enter") {
      consumeTreeKey();
      const groupId = event.currentTarget.dataset.groupId;
      if (collapseKey) {
        toggleGroup(widgetId ?? groupId?.replace(/^semantic:/, "") ?? collapseKey, collapseKey);
      } else if (groupId) {
        toggleGroup(groupId);
      } else if (widget) {
        beginWidgetRename(widget);
      }
      return;
    }
    if (event.key === " " && widget) {
      consumeTreeKey();
      setWidgetProperty(widget.id, { visible: !widget.visible });
      if (widget.visible && selectedIds.includes(widget.id)) {
        useStore.getState().select(selectedIds.filter((id) => id !== widget.id));
      }
      return;
    }
    if (event.key === "ArrowRight" && collapseKey) {
      consumeTreeKey();
      if (!expanded) {
        toggleGroup(widgetId ?? collapseKey.replace(/^semantic:/, ""), collapseKey);
      } else {
        if (getDepth(currentIndex + 1) === getDepth(currentIndex) + 1) {
          focusEntry(currentIndex + 1);
        }
      }
      return;
    }
    if (event.key === "ArrowLeft") {
      consumeTreeKey();
      if (collapseKey && expanded) {
        toggleGroup(widgetId ?? collapseKey.replace(/^semantic:/, ""), collapseKey);
      } else {
        const currentLevel = Number(event.currentTarget.getAttribute("aria-level") ?? 1);
        let parentIndex = currentIndex - 1;
        while (parentIndex >= 0 && getDepth(parentIndex) + 1 >= currentLevel) parentIndex -= 1;
        if (parentIndex >= 0) focusEntry(parentIndex);
      }
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    consumeTreeKey();
    const nextIndex = event.key === "ArrowDown"
      ? Math.min(layerEntries.length - 1, currentIndex + 1)
      : Math.max(0, currentIndex - 1);
    focusEntry(nextIndex);
  };

  const updateScreenOrder = (draggedId: string, targetId: string, edge: "before" | "after") => {
    editProject((current) => ({
      ...current,
      screens: reorderScreens(current.screens, draggedId, targetId, edge),
    }));
  };

  const screenDragOver = (event: DragEvent<HTMLDivElement>, screenId: string) => {
    if (!draggedScreenId || draggedScreenId === screenId) return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const edge = event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
    event.currentTarget.dataset.dropEdge = edge;
  };

  const screenDrop = (event: DragEvent<HTMLDivElement>, screenId: string) => {
    event.preventDefault();
    const edge = event.currentTarget.dataset.dropEdge === "after" ? "after" : "before";
    if (draggedScreenId) updateScreenOrder(draggedScreenId, screenId, edge);
    setDraggedScreenId(null);
    delete event.currentTarget.dataset.dropEdge;
  };

  const clearAutoExpandTimer = () => {
    if (autoExpandTimerRef.current !== null) {
      window.clearTimeout(autoExpandTimerRef.current);
      autoExpandTimerRef.current = null;
    }
    autoExpandTargetRef.current = null;
  };

  const layerDragOver = (
    event: DragEvent<HTMLElement>,
    targetId: string,
    canContain = false,
    collapseKey = canContain ? `container:${targetId}` : null,
  ) => {
    if (draggedLayerIds.length === 0 || draggedLayerIds.includes(targetId)) return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const offset = event.clientY - bounds.top;
    const edge = canContain && offset > bounds.height * 0.2 && offset < bounds.height * 0.8
      ? "inside"
      : offset < bounds.height / 2 ? "before" : "after";
    setDropIndicator({ id: targetId, edge });
    const tree = layerTreeRef.current;
    if (tree) {
      const treeBounds = tree.getBoundingClientRect();
      const topDistance = event.clientY - treeBounds.top;
      const bottomDistance = treeBounds.bottom - event.clientY;
      if (topDistance < 28) tree.scrollTop -= Math.max(1, Math.ceil((28 - topDistance) / 28 * 6));
      else if (bottomDistance < 28) tree.scrollTop += Math.max(1, Math.ceil((28 - bottomDistance) / 28 * 6));
    }
    if (edge === "inside" && canContain && collapseKey) {
      if (collapsedGroups.includes(collapseKey) && autoExpandTargetRef.current !== targetId) {
        if (autoExpandTimerRef.current !== null) window.clearTimeout(autoExpandTimerRef.current);
        autoExpandTargetRef.current = targetId;
        autoExpandTimerRef.current = window.setTimeout(() => {
          toggleGroup(targetId, collapseKey);
          autoExpandTimerRef.current = null;
          autoExpandTargetRef.current = null;
        }, 500);
      } else if (!collapsedGroups.includes(collapseKey) && autoExpandTargetRef.current !== targetId) {
        clearAutoExpandTimer();
      }
    } else if (autoExpandTimerRef.current !== null) {
      window.clearTimeout(autoExpandTimerRef.current);
      autoExpandTimerRef.current = null;
      autoExpandTargetRef.current = null;
    }
  };

  const layerDrop = (event: DragEvent<HTMLElement>, targetId: string, groupId?: string) => {
    event.preventDefault();
    event.stopPropagation();
    if (!activeScreen || draggedLayerIds.length === 0) {
      clearAutoExpandTimer();
      return;
    }
    clearAutoExpandTimer();
    if (draggedLayerIds.includes(targetId)) {
      setDraggedLayerIds([]);
      setDropIndicator(null);
      return;
    }
    if (groupId) {
      if (wouldCreateLayerCycle(activeScreen.widgets, draggedLayerIds, groupId)) {
        setDraggedLayerIds([]);
        setDropIndicator(null);
        return;
      }
      if (draggedLayerIds.every((id) =>
        activeScreen.widgets.find((widget) => widget.id === id)?.groupId === groupId,
      )) {
        setDraggedLayerIds([]);
        setDropIndicator(null);
        return;
      }
      editProject((current) => ({
        ...current,
        screens: current.screens.map((screen) =>
          screen.id !== activeScreen.id
            ? screen
            : {
                ...screen,
                widgets: screen.widgets.map((widget) =>
                  draggedLayerIds.includes(widget.id) ? { ...widget, groupId } : widget,
                ),
              },
        ),
      }));
    } else if (dropIndicator?.id === targetId && dropIndicator.edge !== "inside") {
      editProject((current) => ({
        ...current,
        screens: current.screens.map((screen) =>
          screen.id !== activeScreen.id
            ? screen
            : (() => {
                const target = screen.widgets.find((widget) => widget.id === targetId);
                const reordered = reorderWidgetSet(
                  screen.widgets,
                  draggedLayerIds,
                  targetId,
                  dropIndicator.edge === "after" ? "after" : "before",
                );
                return {
                  ...screen,
                  widgets: reordered.map((widget) =>
                    draggedLayerIds.includes(widget.id)
                      ? { ...widget, groupId: target?.groupId }
                      : widget,
                  ),
                };
              })(),
        ),
      }));
    }
    setDraggedLayerIds([]);
    setDropIndicator(null);
  };

  const beginWidgetRename = (widget: Widget) => {
    setRenamingWidgetId(widget.id);
    setRenameDraft(widgetLabel(widget));
  };

  const finishWidgetRename = (widgetId: string) => {
    if (cancelWidgetRenameRef.current) {
      cancelWidgetRenameRef.current = false;
      setRenamingWidgetId(null);
      return;
    }
    const name = renameDraft.trim().slice(0, 120);
    if (name && activeScreen?.widgets.find((widget) => widget.id === widgetId)?.name !== name) {
      setWidgetProperty(widgetId, { name });
    }
    setRenamingWidgetId(null);
  };

  const renderWidgetRow = (
    widget: Widget,
    entry: FlattenedLayerTreeEntry,
    entryIndex: number,
  ) => {
    const selected = selectedIds.includes(widget.id);
    const label = widgetLabel(widget);
    const container = isLayerContainer(widget);
    const hasChildren = entry.node.children.length > 0;
    const collapseKey = getLayerTreeCollapseKey(entry.node);
    const indentation = Math.min(entry.depth + 1, 5) * 16;
    const childBadge = getContainerBadge(widget, entry.node.children.length);
    const ownedChildIds = entry.node.children
      .filter((child) => visibleLayerNodeIds.has(child.id))
      .map(layerNodeDomId)
      .join(" ");
    const invalidDrop = container &&
      draggedLayerIds.length > 0 &&
      wouldCreateLayerCycle(activeScreen?.widgets ?? [], draggedLayerIds, widget.id);
    return (
      <div
        key={widget.id}
        id={`layer-row-${widget.id}`}
        data-widget-id={widget.id}
        data-entry-index={entryIndex}
        className={`layer-row${entry.depth > 0 ? " is-nested" : ""}${container ? " is-container" : ""}${selected ? " is-selected" : ""}${hoveredWidgetId === widget.id ? " is-canvas-hovered" : ""}${widget.locked ? " is-locked" : ""}${!widget.visible ? " is-hidden" : ""}${invalidDrop ? " is-invalid-drop" : ""}${["symbol", "symbol-instance", "symbolInstance"].includes(widget.type) ? " is-symbol" : ""}${recentWidgetIds.has(widget.id) ? " is-new" : ""}${dropIndicator?.id === widget.id ? ` drop-${dropIndicator.edge}` : ""}`}
        role="treeitem"
        tabIndex={selected || hoveredWidgetId === widget.id || entry.depth === 0 ? 0 : -1}
        aria-level={entry.depth + 2}
        aria-selected={selected}
        aria-posinset={entry.position}
        aria-setsize={entry.siblingCount}
        aria-owns={ownedChildIds || undefined}
        aria-expanded={container ? (hasChildren ? !entry.collapsed : false) : undefined}
        data-collapse-key={collapseKey ?? undefined}
        data-depth={entry.depth + 1}
        style={{
          paddingLeft: `${indentation}px`,
          "--layer-accent": categoryAccent(widget),
        } as CSSProperties & { "--layer-accent": string }}
        draggable={!renamingWidgetId}
        onKeyDown={navigateLayerTree}
        onMouseEnter={() => useStore.getState().setLayerHoveredWidget(widget.id)}
        onMouseLeave={() => {
          if (useStore.getState().hoveredLayerWidgetId === widget.id) {
            useStore.getState().setLayerHoveredWidget(null);
          }
        }}
        onDragStart={(event) => {
          const sourceIds = selectedIds.includes(widget.id) ? selectedIds : [widget.id];
          const sourceWidgets = (activeScreen?.widgets ?? []).filter((item) =>
            sourceIds.includes(item.id),
          );
          setDraggedLayerIds(sourceWidgets.map((item) => item.id));
          beginLayerDrag(event, sourceWidgets, label);
        }}
        onDragOver={(event) => layerDragOver(event, widget.id, container)}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            clearAutoExpandTimer();
          }
        }}
        onDrop={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const offset = event.clientY - bounds.top;
          const dropInside = container && offset > bounds.height * 0.2 && offset < bounds.height * 0.8;
          layerDrop(event, widget.id, dropInside ? widget.id : undefined);
        }}
        onDragEnd={() => {
          setActiveLayerDragPayload(null);
          setDraggedLayerIds([]);
          setDropIndicator(null);
          clearAutoExpandTimer();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          setMenu({ kind: "layer", id: widget.id, x: event.clientX, y: event.clientY });
        }}
      >
        {renamingWidgetId === widget.id ? (
          <input
            className="layer-rename-input"
            aria-label="Layer name"
            autoFocus
            value={renameDraft}
            onChange={(event) => setRenameDraft(event.target.value)}
            onBlur={() => finishWidgetRename(widget.id)}
            onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
              if (event.key === "Enter") finishWidgetRename(widget.id);
              if (event.key === "Escape") {
                cancelWidgetRenameRef.current = true;
                setRenamingWidgetId(null);
                event.currentTarget.blur();
              }
            }}
          />
        ) : (
          <button
            className="layer-select"
            aria-label={`Select ${label}`}
            aria-pressed={selected}
            onDoubleClick={() => beginWidgetRename(widget)}
            onClick={(event) => {
              if (widget.locked) return;
              const current = useStore.getState().selectedIds;
              useStore.getState().select(
                event.shiftKey
                  ? current.includes(widget.id)
                    ? current.filter((id) => id !== widget.id)
                    : [...current, widget.id]
                  : [widget.id],
              );
            }}
          >
            <span
              className={`layer-tree-guide layer-tree-screen-guide${entry.node.id === lastLayerNodeId ? " is-last-path" : ""}`}
              style={{ left: "8px" }}
              aria-hidden="true"
            />
            {entry.ancestorContinues.map((continues, index) => (
              <span
                key={index}
                className={`layer-tree-guide${continues ? "" : " is-last-path"}`}
                style={{ left: `${Math.min(index + 1, 4) * 16 + 8}px` }}
                aria-hidden="true"
              />
            ))}
            {layerMode === "z-order" && (
              <span
                className={`layer-tree-guide layer-screen-guide${entry.node.id === lastLayerNodeId ? " is-last-path" : ""}`}
                style={{ left: "8px" }}
                aria-hidden="true"
              />
            )}
            <span
              className={`layer-tree-branch${entry.isLastChild ? " is-last" : ""}`}
              style={{ left: `${Math.min(entry.depth, 4) * 16 + 8}px` }}
              aria-hidden="true"
            />
            {container && collapseKey ? (
              <button
                className="layer-expand-toggle"
                aria-label={hasChildren
                  ? `${entry.collapsed ? "Expand" : "Collapse"} ${label}`
                  : `${label} is empty`}
                aria-expanded={hasChildren ? !entry.collapsed : false}
                disabled={!hasChildren}
                onClick={(event) => {
                  event.stopPropagation();
                  if (!hasChildren) return;
                  if (event.altKey) {
                    setTreeCollapsed(entry.node, !entry.collapsed);
                  } else {
                    toggleGroup(widget.id, collapseKey);
                  }
                }}
                onContextMenu={(event) => {
                  if (!hasChildren) return;
                  event.preventDefault();
                  event.stopPropagation();
                  setMenu({ kind: "layer", id: widget.id, x: event.clientX, y: event.clientY });
                }}
              >
                {!hasChildren
                  ? <CircleSlash size={14} aria-label="Empty container" />
                  : entry.collapsed
                    ? <ChevronRight size={13} />
                    : <ChevronDown size={13} />}
              </button>
            ) : (
              <span className="layer-chevron-spacer" aria-hidden="true" />
            )}
            <WidgetIcon type={widget.type} />
            <span className="layer-name">{label}</span>
            {container && (
              <span
                className="layer-child-count"
                aria-label={childBadge}
              >
                {entry.collapsed ? `(${childBadge})` : childBadge}
              </span>
            )}
            {recentWidgetIds.has(widget.id) && (
              <Sparkles className="layer-new-icon" size={13} aria-label="Just created" />
            )}
            {invalidDrop && (
              <AlertTriangle className="layer-invalid-drop-icon" size={16} aria-label="Invalid drop target" />
            )}
          </button>
        )}
        <button
          className="layer-visibility"
          aria-label={`${widget.visible ? "Hide" : "Show"} ${label}`}
          aria-pressed={!widget.visible}
          title={widget.visible ? "Hide layer" : "Show layer"}
          onClick={() => {
            setWidgetProperty(widget.id, { visible: !widget.visible });
            if (widget.visible && selected) {
              useStore.getState().select(selectedIds.filter((id) => id !== widget.id));
            }
          }}
        >
          {widget.visible ? <Eye size={13} /> : <EyeOff size={13} />}
        </button>
        <button
          className="layer-lock"
          aria-label={`${widget.locked ? "Unlock" : "Lock"} ${label}`}
          aria-pressed={widget.locked}
          title={widget.locked ? "Unlock layer" : "Lock layer"}
          onClick={() => {
            setWidgetProperty(widget.id, { locked: !widget.locked });
            if (!widget.locked && selected) {
              useStore.getState().select(selectedIds.filter((id) => id !== widget.id));
            }
          }}
        >
          {widget.locked ? <Lock size={13} /> : <Unlock size={13} />}
        </button>
      </div>
    );
  };

  const selectedGroup = categoryMenu
    ? layerGroups.find((group) => group.id === categoryMenu.id)
    : undefined;
  const menuLayerWidget = menu?.kind === "layer"
    ? activeScreen?.widgets.find((widget) => widget.id === menu.id)
    : undefined;
  const menuLayerNode = menuLayerWidget
    ? findLayerTreeNode(
        buildLayerHierarchy(activeScreen?.widgets ?? [], widgetLabel),
        menuLayerWidget.id,
      )
    : undefined;
  const selectedGroupAllVisible = selectedGroup?.widgets.some((widget) => widget.visible) ?? false;
  const semanticGroups = [...new Set(
    activeScreen?.widgets.map((widget) => widget.groupId).filter((id): id is string => Boolean(id)) ?? [],
  )];

  const moveSelectedIntoGroup = (groupId: string | undefined) => {
    if (!activeScreen || selectedIds.length === 0) return;
    const selected = new Set(selectedIds);
    editProject((current) => ({
      ...current,
      screens: current.screens.map((screen) =>
        screen.id !== activeScreen.id
          ? screen
          : {
              ...screen,
              widgets: screen.widgets.map((widget) =>
                selected.has(widget.id) ? { ...widget, groupId } : widget,
              ),
            },
      ),
    }));
    setMovePickerOpen(false);
  };

  const moveSelectedToCategory = (category: LayerCategoryId) => {
    if (!activeScreen || selectedIds.length === 0) return;
    const selected = new Set(selectedIds);
    editProject((current) => ({
      ...current,
      screens: current.screens.map((screen) =>
        screen.id !== activeScreen.id
          ? screen
          : {
              ...screen,
              widgets: screen.widgets.map((widget) =>
                selected.has(widget.id)
                  ? {
                      ...widget,
                      layerCategory: getLayerCategory(widget.type) === category
                        ? undefined
                        : category,
                    }
                  : widget,
              ),
            },
      ),
    }));
    setMovePickerOpen(false);
  };

  const moveSelectedToCanvasCenter = () => {
    if (!activeScreen || selectedIds.length === 0) return;
    const selected = activeScreen.widgets.filter((widget) => selectedIds.includes(widget.id));
    if (selected.length === 0) return;
    const left = Math.min(...selected.map((widget) => widget.x));
    const top = Math.min(...selected.map((widget) => widget.y));
    const right = Math.max(...selected.map((widget) => widget.x + widget.width));
    const bottom = Math.max(...selected.map((widget) => widget.y + widget.height));
    const targetX = ((activeScreen.device?.width ?? DEFAULT_DEVICE_PRESET.viewport.width) - (right - left)) / 2;
    const targetY = ((activeScreen.device?.height ?? DEFAULT_DEVICE_PRESET.viewport.height) - (bottom - top)) / 2;
    const dx = targetX - left;
    const dy = targetY - top;
    const ids = new Set(selectedIds);
    editProject((current) => ({
      ...current,
      screens: current.screens.map((screen) =>
        screen.id !== activeScreen.id
          ? screen
          : {
              ...screen,
              widgets: screen.widgets.map((widget) =>
                ids.has(widget.id)
                  ? { ...widget, x: widget.x + dx, y: widget.y + dy }
                  : widget,
              ),
            },
      ),
    }));
    setMovePickerOpen(false);
  };

  return (
    <>
      <section className="sidebar-section pages-section" aria-label="Screens">
        <div className="section-label">
          <span>SCREENS</span>
          <button
            className="icon-button small-icon"
            aria-label="Add screen"
            title="Add screen"
            onClick={() => setScreenPickerOpen(true)}
          >
            <Plus size={15} />
          </button>
        </div>
        <div
          className="screen-list"
          role="listbox"
          aria-label="Screens"
          ref={screenListRef}
          onScroll={(event) => setScreenScrollTop(event.currentTarget.scrollTop)}
        >
          {screenVirtualizedRange.topSpacerHeight > 0 && (
            <div style={{ height: screenVirtualizedRange.topSpacerHeight }} aria-hidden="true" />
          )}
          {visibleScreens.map((screen, visibleIndex) => {
            const screenIndex = screenVirtualizedRange.start + visibleIndex;
            const device = screen.device ?? toScreenDevice(DEFAULT_DEVICE_PRESET);
            const deviceName = screen.device?.presetId === "custom"
              ? "Custom size"
              : findDevicePreset(device.presetId)?.name ?? "Desktop";
            const dimensions = `${device.width} × ${device.height}`;
            const normalizedDeviceName = deviceName.toLowerCase().replace(/[×\s]/g, "");
            const deviceDetails = normalizedDeviceName.includes(dimensions.toLowerCase().replace(/[×\s]/g, ""))
              ? deviceName
              : `${deviceName} · ${dimensions}`;
            const screenTooltip = `${screen.name} · ${deviceDetails}`;
            return (
              <div
                className={`page-item${screen.id === activeScreenId ? " selected" : ""}${screen.id === draggedScreenId ? " is-dragging" : ""}`}
                key={screen.id}
                role="option"
                tabIndex={0}
                data-screen-index={screenIndex}
                aria-selected={screen.id === activeScreenId}
                aria-current={screen.id === activeScreenId ? "page" : undefined}
                title={screenTooltip}
                draggable={renamingScreenId !== screen.id}
                onClick={() => useStore.getState().setActiveScreen(screen.id)}
                onDoubleClick={() => startScreenRename(screen)}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget || renamingScreenId === screen.id) return;
                  if (
                    event.key === "ArrowDown" ||
                    event.key === "ArrowUp" ||
                    event.key === "Home" ||
                    event.key === "End"
                  ) {
                    event.preventDefault();
                    const nextIndex = event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? project.screens.length - 1
                        : Math.max(
                            0,
                            Math.min(
                              project.screens.length - 1,
                              screenIndex + (event.key === "ArrowDown" ? 1 : -1),
                            ),
                          );
                    const focusNextScreen = () => {
                      screenListRef.current
                        ?.querySelector<HTMLElement>(`[data-screen-index="${nextIndex}"]`)
                        ?.focus();
                    };
                    const nextOption = screenListRef.current
                      ?.querySelector<HTMLElement>(`[data-screen-index="${nextIndex}"]`);
                    if (nextOption) {
                      nextOption.focus();
                    } else {
                      if (screenListRef.current) {
                        screenListRef.current.scrollTop = nextIndex * SCREEN_ROW_HEIGHT;
                      }
                      window.requestAnimationFrame(() =>
                        window.requestAnimationFrame(focusNextScreen),
                      );
                    }
                  } else if (event.key === "Enter") {
                    event.preventDefault();
                    useStore.getState().setActiveScreen(screen.id);
                  } else if (event.key === "Delete") {
                    event.preventDefault();
                    deleteScreen(screen.id);
                  }
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setMenu({ kind: "screen", id: screen.id, x: event.clientX, y: event.clientY });
                }}
                onDragStart={(event) => {
                  setDraggedScreenId(screen.id);
                  beginScreenDrag(event, screen);
                  event.dataTransfer.effectAllowed = "copyMove";
                  event.dataTransfer.dropEffect = "move";
                }}
                onDragOver={(event) => screenDragOver(event, screen.id)}
                onDrop={(event) => screenDrop(event, screen.id)}
                onDragEnd={(event) => {
                  setActiveLayerDragPayload(null);
                  setDraggedScreenId(null);
                  delete event.currentTarget.dataset.dropEdge;
                }}
              >
                <div className="page-item-heading">
                  <ScreenIcon category={screenIconCategory(screen.device)} size={16} />
                  {renamingScreenId === screen.id ? (
                    <input
                      className="screen-rename-input"
                      aria-label="Screen name"
                      autoFocus
                      value={renameDraft}
                      onChange={(event) => setRenameDraft(event.target.value)}
                      onBlur={() => finishScreenRename(screen.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") finishScreenRename(screen.id);
                        if (event.key === "Escape") {
                          cancelScreenRenameRef.current = true;
                          setRenamingScreenId(null);
                          event.currentTarget.blur();
                        }
                        event.stopPropagation();
                      }}
                      onClick={(event) => event.stopPropagation()}
                    />
                  ) : (
                    <span className="page-item-name">{screen.name}</span>
                  )}
                  {screen.id === project.startScreenId && (
                    <span className="start-screen-badge" title="Start screen">Start</span>
                  )}
                  {screen.id === activeScreenId && (
                    <span className="screen-active-check" title="Active screen">
                      <Check size={12} aria-hidden="true" />
                    </span>
                  )}
                </div>
                <span className="page-item-device">
                  {deviceDetails}
                </span>
                <ScreenThumbnail
                  screen={screen}
                  breakpointId={screen.id === activeScreenId ? activeBreakpointId : null}
                />
              </div>
            );
          })}
          {screenVirtualizedRange.bottomSpacerHeight > 0 && (
            <div style={{ height: screenVirtualizedRange.bottomSpacerHeight }} aria-hidden="true" />
          )}
        </div>
      </section>

      <section className="sidebar-section layers-section" aria-label="Layers">
        <div className="layer-tree-toolbar">
          <div className="layer-tree-title">
            <span>LAYERS</span>
            <span className="layer-count">
              {activeScreen?.widgets.length ?? 0} items
            </span>
          </div>
          <div className="layer-tree-controls">
            <button
              className="layer-tree-action"
              disabled={!activeScreen?.widgets.length}
              aria-label={activeScreen?.widgets.some((widget) => !widget.visible) ? "Show all layers" : "Hide all layers"}
              title={activeScreen?.widgets.some((widget) => !widget.visible) ? "Show all layers" : "Hide all layers"}
              onClick={setAllVisibility}
            >
              {activeScreen?.widgets.some((widget) => !widget.visible) ? <Eye size={13} /> : <EyeOff size={13} />}
            </button>
            <button
              className="layer-tree-action"
              disabled={!activeScreen?.widgets.length}
              aria-label={activeScreen?.widgets.every((widget) => widget.locked) ? "Unlock all layers" : "Lock all layers"}
              title={activeScreen?.widgets.every((widget) => widget.locked) ? "Unlock all layers" : "Lock all layers"}
              onClick={setAllLockState}
            >
              {activeScreen?.widgets.every((widget) => widget.locked) ? <Unlock size={13} /> : <Lock size={13} />}
            </button>
            <select
              className="layer-view-mode"
              aria-label="Layer view mode"
              value={layerMode}
              onChange={(event) => updateLayerPreferences((current) => ({
                ...current,
                mode: event.target.value as LayerViewMode,
              }))}
            >
              {LAYER_VIEW_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {mode === "category" ? "By Category" : mode === "z-order" ? "Hierarchy" : "By Type"}
                </option>
              ))}
            </select>
          </div>
        </div>
        <label className="layer-search">
          <Search size={13} aria-hidden="true" />
          <input
            aria-label="Search layers"
            type="search"
            placeholder="Search layers"
            value={categorySearch}
            onChange={(event) => setCategorySearch(event.target.value)}
          />
          {categorySearch && (
            <button
              className="layer-search-clear"
              aria-label="Clear layer search"
              onClick={() => setCategorySearch("")}
            >
              <X size={12} />
            </button>
          )}
        </label>
        {activeScreen && (
          activeScreen.widgets.length === 0 || visibleLayerEntries.length > 0
        ) ? (
          <div
            className="layer-list"
            role="tree"
            aria-label="Widget layers"
            ref={layerTreeRef}
            onScroll={(event) => {
              setLayerScrollTop(event.currentTarget.scrollTop);
              setLayerViewportHeight(event.currentTarget.clientHeight);
            }}
            onDragOver={(event) => {
              if (event.target === event.currentTarget && draggedLayerIds.length > 0) {
                event.preventDefault();
              }
            }}
            onDrop={(event) => {
              if (
                event.target !== event.currentTarget ||
                !activeScreen ||
                draggedLayerIds.length === 0
              ) return;
              event.preventDefault();
              const groupId = crypto.randomUUID();
              const ids = new Set(draggedLayerIds);
              editProject((current) => ({
                ...current,
                screens: current.screens.map((screen) =>
                  screen.id !== activeScreen.id
                    ? screen
                    : {
                        ...screen,
                        widgets: screen.widgets.map((widget) =>
                          ids.has(widget.id) ? { ...widget, groupId } : widget,
                        ),
                      },
                ),
              }));
              setDraggedLayerIds([]);
              setDropIndicator(null);
            }}
          >
            <div
              className="layer-screen-root"
              role="treeitem"
              tabIndex={-1}
              aria-level={1}
              aria-label={`Screen: ${activeScreen.name}`}
              data-screen-id={activeScreen.id}
            >
              <ScreenIcon category={screenIconCategory(activeScreen.device)} size={16} />
              <span className="layer-screen-name">{activeScreen.name}</span>
              <span className="layer-child-count">
                {activeScreen.widgets.length} items
              </span>
              <span className="layer-screen-kind">Screen</span>
            </div>
            {activeScreen.widgets.length === 0 && (
              <div className="sidebar-empty-state layer-tree-empty">
                <Layers2 size={16} />
                <span>Empty screen — add a widget.</span>
              </div>
            )}
            <div className="layer-virtual-spacer" style={{ height: virtualizedRange.topSpacerHeight }} aria-hidden="true" />
            {visibleLayerEntries.map((entry, visibleIndex) => {
              const entryIndex = virtualizedRange.start + visibleIndex;
              if (entry.kind === "node" && entry.node.kind === "widget" && entry.node.widget) {
                return renderWidgetRow(entry.node.widget, entry, entryIndex);
              }
              if (entry.kind === "node") {
                const node = entry.node;
                const groupId = node.groupId ?? node.id;
                const members = node.children.flatMap((child) => child.widget ? [child.widget] : []);
                const allMembers: Widget[] = [];
                const collectMembers = (current: LayerTreeNode) => {
                  if (current.widget) allMembers.push(current.widget);
                  current.children.forEach(collectMembers);
                };
                node.children.forEach(collectMembers);
                const allVisible = allMembers.length > 0 && allMembers.every((member) => member.visible);
                const allLocked = allMembers.length > 0 && allMembers.every((member) => member.locked);
                const collapseKey = getLayerTreeCollapseKey(node) ?? `semantic:${groupId}`;
                const invalidDrop = draggedLayerIds.length > 0 &&
                  members.some((member) => draggedLayerIds.includes(member.id));
                const indentation = Math.min(entry.depth + 1, 5) * 16;
                return (
                  <div
                    key={node.id}
                    className={`layer-group-row${entry.depth > 0 ? " is-nested" : ""}${allLocked ? " is-locked" : ""}${!allVisible ? " is-hidden" : ""}${hoveredWidgetId && allMembers.some((member) => member.id === hoveredWidgetId) ? " is-canvas-hovered" : ""}${dropIndicator?.id === groupId ? ` drop-${dropIndicator.edge}` : ""}${dropIndicator?.id === groupId && draggedLayerIds.length > 0 ? invalidDrop ? " is-invalid-drop" : " is-drop-target" : ""}`}
                    role="treeitem"
                    tabIndex={entry.depth === 0 ? 0 : -1}
                    data-entry-index={entryIndex}
                    id={`layer-group-${groupId}`}
                    aria-level={entry.depth + 2}
                    aria-label={`Group, ${node.descendantCount} children`}
                    aria-expanded={!entry.collapsed}
                    aria-posinset={entry.position}
                    aria-setsize={entry.siblingCount}
                    aria-owns={
                      node.children
                        .filter((child) => visibleLayerNodeIds.has(child.id))
                        .map(layerNodeDomId)
                        .join(" ") || undefined
                    }
                    data-group-id={groupId}
                    data-collapse-key={collapseKey}
                    data-depth={entry.depth + 1}
                    style={{
                      paddingLeft: `${indentation}px`,
                      "--layer-accent": node.children[0]?.widget
                        ? categoryAccent(node.children[0].widget)
                        : LAYER_CATEGORY_DEFINITIONS[node.category].badge,
                    } as CSSProperties & { "--layer-accent": string }}
                    onKeyDown={navigateLayerTree}
                    onMouseEnter={() => members[0] && useStore.getState().setLayerHoveredWidget(members[0].id)}
                    onMouseLeave={() => {
                      if (members[0] && useStore.getState().hoveredLayerWidgetId === members[0].id) {
                        useStore.getState().setLayerHoveredWidget(null);
                      }
                    }}
                    onClick={() => toggleGroup(groupId, collapseKey)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setMenu({ kind: "group", id: groupId, x: event.clientX, y: event.clientY });
                    }}
                    draggable
                    onDragStart={(event) => {
                      setDraggedLayerIds(members.map((member) => member.id));
                      beginLayerDrag(event, members, "Group");
                    }}
                    onDragEnd={() => {
                      setActiveLayerDragPayload(null);
                      setDraggedLayerIds([]);
                      setDropIndicator(null);
                      clearAutoExpandTimer();
                    }}
                    onDragOver={(event) => layerDragOver(event, groupId, true, collapseKey)}
                    onDragLeave={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                        clearAutoExpandTimer();
                      }
                    }}
                    onDrop={(event) => layerDrop(event, groupId, groupId)}
                  >
                    <span
                      className={`layer-tree-guide layer-tree-screen-guide${node.id === lastLayerNodeId ? " is-last-path" : ""}`}
                      style={{ left: "8px" }}
                      aria-hidden="true"
                    />
                    {entry.ancestorContinues.map((continues, index) => (
                      <span
                        key={index}
                        className={`layer-tree-guide${continues ? "" : " is-last-path"}`}
                        style={{ left: `${Math.min(index + 1, 4) * 16 + 8}px` }}
                        aria-hidden="true"
                      />
                    ))}
                    <span
                      className={`layer-tree-branch${entry.isLastChild ? " is-last" : ""}`}
                      style={{ left: `${Math.min(entry.depth, 4) * 16 + 8}px` }}
                      aria-hidden="true"
                    />
                    <button
                      className="layer-group-toggle"
                      aria-label={`${entry.collapsed ? "Expand" : "Collapse"} ${node.label}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (event.altKey) setTreeCollapsed(node, !entry.collapsed);
                        else toggleGroup(groupId, collapseKey);
                      }}
                    >
                      {entry.collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                    </button>
                    <Folder size={14} aria-hidden="true" />
                    <span className="layer-group-name">{node.label}</span>
                    <span className="layer-group-count" aria-label={`${node.descendantCount} children`}>
                      {node.descendantCount} {node.descendantCount === 1 ? "child" : "children"}
                    </span>
                    <button
                      className="layer-visibility"
                      aria-label={`${allVisible ? "Hide" : "Show"} ${node.label}`}
                      aria-pressed={!allVisible}
                      title={allVisible ? "Hide group" : "Show group"}
                      onClick={(event) => {
                        event.stopPropagation();
                        setWidgetsProperty(allMembers, { visible: !allVisible });
                      }}
                    >
                      {allVisible ? <Eye size={13} /> : <EyeOff size={13} />}
                    </button>
                    <button
                      className="layer-lock"
                      aria-label={`${allLocked ? "Unlock" : "Lock"} ${node.label}`}
                      aria-pressed={allLocked}
                      title={allLocked ? "Unlock group" : "Lock group"}
                      onClick={(event) => {
                        event.stopPropagation();
                        setWidgetsProperty(allMembers, { locked: !allLocked });
                      }}
                    >
                      {allLocked ? <Lock size={13} /> : <Unlock size={13} />}
                    </button>
                    {invalidDrop && <AlertTriangle className="layer-invalid-drop-icon" size={16} aria-label="Invalid drop target" />}
                    <button
                      className="layer-tree-action"
                      aria-label="Group options"
                      onClick={(event) => {
                        event.stopPropagation();
                        setMenu({ kind: "group", id: groupId, x: event.clientX, y: event.clientY });
                      }}
                    >
                      <MoreHorizontal size={13} />
                    </button>
                  </div>
                );
              }
              const { group, collapsed, visibleCount } = entry;
              const { id: groupId, widgets } = group;
              const category = LAYER_CATEGORY_DEFINITIONS[group.category];
              const displayNameKey = layerGroupNameKey(layerMode, groupId);
              const currentLabel = layerPreferences.groupNames[displayNameKey] ?? group.label;
              const isRenaming = renamingGroupId === groupId;
              return (
                <CategoryHeader
                  key={groupId}
                  category={category}
                  groupId={groupId}
                  entryIndex={entryIndex}
                  label={isRenaming ? renameGroupDraft : currentLabel}
                  count={visibleCount}
                  collapsed={collapsed}
                  dropEdge={categoryDropIndicator?.id === groupId ? categoryDropIndicator.edge : undefined}
                  isDropTarget={
                    layerMode === "category" &&
                    draggedCategoryId === null &&
                    draggedLayerIds.length > 0 &&
                    categoryDropIndicator?.id === groupId
                  }
                  onToggle={() => toggleGroup(groupId)}
                  onMenu={(event) => setCategoryMenu({
                    id: groupId,
                    x: event.clientX,
                    y: event.clientY,
                  })}
                  onDragStart={(event) => {
                    setDraggedCategoryId(groupId);
                    setDraggedLayerIds(widgets.map((widget) => widget.id));
                    beginLayerDrag(event, widgets, group.label);
                    event.dataTransfer.setData("text/plain", `layer-group:${groupId}`);
                  }}
                  onDragOver={(event) => categoryDragOver(event, groupId)}
                  onDrop={(event) => categoryDrop(event, groupId)}
                  onDragEnd={() => {
                    setActiveLayerDragPayload(null);
                    setDraggedCategoryId(null);
                    setDraggedLayerIds([]);
                    setCategoryDropIndicator(null);
                  }}
                  onKeyDown={navigateLayerTree}
                  {...(isRenaming ? {
                    onRename: setRenameGroupDraft,
                    onRenameCommit: (name: string) => {
                      const normalized = name.trim().slice(0, 60);
                      if (normalized) {
                        updateLayerPreferences((current) => ({
                          ...current,
                          groupNames: { ...current.groupNames, [displayNameKey]: normalized },
                        }));
                      }
                      setRenamingGroupId(null);
                    },
                  } : {})}
                />
              );
            })}
            <div className="layer-virtual-spacer" style={{ height: virtualizedRange.bottomSpacerHeight }} aria-hidden="true" />
          </div>
        ) : (
          <div className="sidebar-empty-state">
            <Layers2 size={16} />
            <span>{categorySearch ? "No layers match your search." : "Empty screen — add a widget."}</span>
          </div>
        )}
      </section>

      {categoryMenu && selectedGroup && (
        <div
          className="tree-context-menu"
          role="menu"
          style={{
            left: Math.min(categoryMenu.x, window.innerWidth - 190),
            top: Math.min(categoryMenu.y, window.innerHeight - 180),
          }}
        >
          <button role="menuitem" onClick={() => {
            const nameKey = layerGroupNameKey(layerMode, selectedGroup.id);
            setRenameGroupDraft(layerPreferences.groupNames[nameKey] ?? selectedGroup.label);
            setRenamingGroupId(selectedGroup.id);
            setCategoryMenu(null);
          }}>
            <MoreHorizontal size={14} /> Rename
          </button>
          <button role="menuitem" onClick={() => {
            setWidgetsProperty(selectedGroup.widgets, { visible: !selectedGroupAllVisible });
            setCategoryMenu(null);
          }}>
            {selectedGroupAllVisible ? <EyeOff size={14} /> : <Eye size={14} />}
            {selectedGroupAllVisible ? "Hide" : "Show"}
          </button>
          <button role="menuitem" onClick={() => {
            setAllGroupsCollapsed(true);
            setCategoryMenu(null);
          }}>
            <ChevronDown size={14} /> Collapse All
          </button>
          <button role="menuitem" onClick={() => {
            setAllGroupsCollapsed(false);
            setCategoryMenu(null);
          }}>
            <ChevronRight size={14} /> Expand All
          </button>
        </div>
      )}

      {menu && (
        <div
          className="tree-context-menu"
          role="menu"
          style={{ left: Math.min(menu.x, window.innerWidth - 190), top: Math.min(menu.y, window.innerHeight - 180) }}
        >
          {menu.kind === "screen" && (
            <>
              <button role="menuitem" onClick={() => {
                const screen = project.screens.find((item) => item.id === menu.id);
                if (screen) startScreenRename(screen);
                setMenu(null);
              }}>
                <MoreHorizontal size={14} /> Rename screen
              </button>
              <button role="menuitem" onClick={() => {
                setDeviceTargetScreenId(menu.id);
                setScreenPickerOpen(true);
                setMenu(null);
              }}>
                <Monitor size={14} /> Change device…
              </button>
              <button role="menuitem" onClick={() => {
                const screen = project.screens.find((item) => item.id === menu.id);
                if (!screen) return;
                const copy = duplicateScreen(screen);
                editProject((current) => ({
                  ...current,
                  screens: [...current.screens, copy],
                }));
                useStore.getState().setActiveScreen(copy.id);
                setMenu(null);
              }}>
                <FilePlus2 size={14} /> Duplicate screen
              </button>
              <button role="menuitem" onClick={() => {
                editProject((current) => ({ ...current, startScreenId: menu.id }));
                useStore.getState().setActiveScreen(menu.id);
                setMenu(null);
              }}>
                <PanelTop size={14} /> Set as start screen
              </button>
              <button role="menuitem" disabled={project.screens.length <= 1} onClick={() => deleteScreen(menu.id)}>
                <X size={14} /> Delete screen
              </button>
            </>
          )}
          {menu.kind === "layer" && (
            <>
              {menuLayerWidget && isLayerContainer(menuLayerWidget) && menuLayerNode?.children.length ? (
                <>
                  <button role="menuitem" onClick={() => {
                    setTreeCollapsed(menuLayerNode, false);
                    setMenu(null);
                  }}>
                    <ChevronDown size={14} /> Expand all
                  </button>
                  <button role="menuitem" onClick={() => {
                    setTreeCollapsed(menuLayerNode, true);
                    setMenu(null);
                  }}>
                    <ChevronRight size={14} /> Collapse all
                  </button>
                </>
              ) : null}
              <button role="menuitem" onClick={() => {
                const widget = activeScreen?.widgets.find((item) => item.id === menu.id);
                if (widget) beginWidgetRename(widget);
                setMenu(null);
              }}>
                <MoreHorizontal size={14} /> Rename layer
              </button>
              <button role="menuitem" onClick={() => duplicateWidget(menu.id)}>
                <FilePlus2 size={14} /> Duplicate layer
              </button>
              <button role="menuitem" onClick={() => deleteWidgets([menu.id])}>
                <X size={14} /> Delete layer
              </button>
            </>
          )}
          {menu.kind === "group" && (
            <>
              <button role="menuitem" onClick={() => toggleGroup(menu.id, `semantic:${menu.id}`)}>
                <Folder size={14} /> Toggle group
              </button>
              <button role="menuitem" onClick={() => {
                if (!activeScreen) return;
                editProject((current) => ({
                  ...current,
                  screens: current.screens.map((screen) =>
                    screen.id !== activeScreen.id
                      ? screen
                      : {
                          ...screen,
                          widgets: screen.widgets.map((widget) =>
                            widget.groupId === menu.id
                              ? { ...widget, groupId: undefined }
                              : widget,
                          ),
                        },
                  ),
                }));
                setMenu(null);
              }}>
                <X size={14} /> Ungroup
              </button>
            </>
          )}
        </div>
      )}

      {movePickerOpen && (
        <div
          className="move-picker-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setMovePickerOpen(false);
          }}
        >
          <section
            className="move-picker"
            role="dialog"
            aria-modal="true"
            aria-labelledby="move-picker-title"
          >
            <div className="move-picker-heading">
              <div>
                <h2 id="move-picker-title">Move to…</h2>
                <p>{selectedIds.length} selected layer{selectedIds.length === 1 ? "" : "s"}</p>
              </div>
              <button aria-label="Close move picker" onClick={() => setMovePickerOpen(false)}>
                <X size={15} />
              </button>
            </div>
            <div className="move-picker-options">
              <button onClick={moveSelectedToCanvasCenter}>
                <Monitor size={15} />
                <span>Canvas center</span>
                <kbd>Enter</kbd>
              </button>
              {semanticGroups.map((groupId, index) => (
                <button key={groupId} onClick={() => moveSelectedIntoGroup(groupId)}>
                  <Folder size={15} />
                  <span>Group {index + 1}</span>
                </button>
              ))}
              {LAYER_CATEGORIES.map((categoryId) => (
                <button key={categoryId} onClick={() => moveSelectedToCategory(categoryId)}>
                  <Layers2 size={15} />
                  <span>{LAYER_CATEGORY_DEFINITIONS[categoryId].label}</span>
                </button>
              ))}
              <button onClick={() => moveSelectedIntoGroup(undefined)}>
                <Layers2 size={15} />
                <span>Ungroup / root</span>
              </button>
            </div>
          </section>
        </div>
      )}

      <DevicePicker
        mode={deviceTargetScreenId ? "change" : "create"}
        open={screenPickerOpen}
        currentDevice={
          deviceTargetScreenId
            ? project.screens.find((screen) => screen.id === deviceTargetScreenId)?.device
            : undefined
        }
        onClose={() => {
          setScreenPickerOpen(false);
          setDeviceTargetScreenId(null);
        }}
        onCreate={addScreen}
        onChange={changeScreenDevice}
      />
    </>
  );
}
