import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  ChevronDown,
  ChevronRight,
  CircleX,
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
  Unlock,
  X,
} from "lucide-react";
import { getShapeToolDefinition } from "../canvas/shapeTools";
import { DEFAULT_DEVICE_PRESET, findDevicePreset, toScreenDevice } from "../devices/catalog";
import { DevicePicker } from "../devices/DevicePicker";
import type { ScreenDevice } from "../devices/types";
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
import { WidgetThumbnail } from "./WidgetThumbnail";
import { WidgetIcon } from "./widgetIcons";

type MenuState =
  | { kind: "screen" | "layer" | "group"; id: string; x: number; y: number }
  | null;

type DropIndicator = { id: string; edge: "before" | "after" } | null;
type LayerTreeEntry =
  | { kind: "category"; group: LayerGroup; collapsed: boolean }
  | { kind: "group"; id: string; members: Widget[]; collapsed: boolean }
  | { kind: "widget"; widget: Widget; nested: boolean };
const LAYER_ROW_HEIGHT = 30;

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
  const value = widget.props.label ?? widget.props.text ?? widget.props.fileName;
  if (typeof value === "string" && value.trim()) return value.trim();
  return getShapeToolDefinition(widget.type)?.label ?? widget.type;
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
  const sourceThumbnail =
    event.currentTarget.querySelector<HTMLImageElement>(".layer-thumbnail img") ??
    event.currentTarget.closest(".layer-group")?.querySelector<HTMLImageElement>(".layer-thumbnail img");
  if (sourceThumbnail) {
    const thumbnail = sourceThumbnail.cloneNode() as HTMLImageElement;
    Object.assign(thumbnail.style, { width: "64px", height: "64px", objectFit: "contain" });
    ghost.append(thumbnail);
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
  caption.textContent = `${label}${widgets.length > 1 ? `  +${widgets.length - 1}` : ""}`;
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
  const preview = document.createElement("span");
  Object.assign(preview.style, {
    display: "grid",
    width: "64px",
    height: "64px",
    placeItems: "center",
    border: "1px solid #625486",
    borderRadius: "4px",
    background: "#302a3c",
    fontSize: "24px",
  });
  preview.textContent = "FRAME";
  ghost.append(preview, document.createTextNode(screen.name));
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
  const selectedIds = useStore((state) => state.selectedIds);
  const activeScreen = project.screens.find((screen) => screen.id === activeScreenId);
  const [menu, setMenu] = useState<MenuState>(null);
  const [renamingScreenId, setRenamingScreenId] = useState<string | null>(null);
  const [renamingWidgetId, setRenamingWidgetId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [screenPickerOpen, setScreenPickerOpen] = useState(false);
  const [deviceTargetScreenId, setDeviceTargetScreenId] = useState<string | null>(null);
  const [draggedScreenId, setDraggedScreenId] = useState<string | null>(null);
  const [draggedLayerIds, setDraggedLayerIds] = useState<string[]>([]);
  const [dropIndicator, setDropIndicator] = useState<DropIndicator>(null);
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
  const [recentWidgetIds, setRecentWidgetIds] = useState<Set<string>>(() => new Set());
  const cancelScreenRenameRef = useRef(false);
  const cancelWidgetRenameRef = useRef(false);
  const layerTreeRef = useRef<HTMLDivElement>(null);
  const previousWidgetIdsRef = useRef<{ screenId: string; ids: Set<string> } | null>(null);
  const recentWidgetTimersRef = useRef(new Map<string, number>());

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
  const layerEntries = useMemo<LayerTreeEntry[]>(() => {
    const entries: LayerTreeEntry[] = [];
    for (const group of layerGroups) {
      const collapsed = collapsedGroups.includes(layerGroupCollapseKey(layerMode, group.id));
      if (layerMode !== "z-order") {
        entries.push({ kind: "category", group, collapsed });
      }
      if (!collapsed) {
        const visitedGroups = new Set<string>();
        for (const widget of group.widgets) {
          if (!widget.groupId) {
            entries.push({ kind: "widget", widget, nested: layerMode !== "z-order" });
            continue;
          }
          if (visitedGroups.has(widget.groupId)) continue;
          visitedGroups.add(widget.groupId);
          const members = group.widgets.filter((item) => item.groupId === widget.groupId);
          const semanticCollapseKey = `semantic:${widget.groupId}`;
          const groupCollapsed = collapsedGroups.includes(semanticCollapseKey);
          entries.push({
            kind: "group",
            id: widget.groupId,
            members,
            collapsed: groupCollapsed,
          });
          if (!groupCollapsed) {
            entries.push(...members.map((member) => ({
              kind: "widget" as const,
              widget: member,
              nested: true,
            })));
          }
        }
      }
    }
    return entries;
  }, [collapsedGroups, layerGroups, layerMode]);
  const virtualizedRange = getVirtualizedRange(
    layerEntries.length,
    layerScrollTop,
    layerViewportHeight,
    LAYER_ROW_HEIGHT,
  );
  const visibleLayerEntries = layerEntries.slice(virtualizedRange.start, virtualizedRange.end);

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

  const setAllGroupsCollapsed = (collapsed: boolean) => {
    const activeKeys = new Set(
      buildLayerGroups(
        activeScreen?.widgets ?? [],
        layerMode,
        [],
        (type) => getShapeToolDefinition(type)?.label ?? type,
      ).map((group) => layerGroupCollapseKey(layerMode, group.id)),
    );
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
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const groupId = event.currentTarget.dataset.groupId;
      if (groupId?.startsWith("semantic:")) {
        toggleGroup(groupId.slice("semantic:".length), groupId);
      } else if (groupId) {
        toggleGroup(groupId);
      }
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const treeItems = [...(layerTreeRef.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [])];
    const currentIndex = treeItems.indexOf(event.currentTarget);
    const nextIndex = event.key === "ArrowDown"
      ? Math.min(treeItems.length - 1, currentIndex + 1)
      : Math.max(0, currentIndex - 1);
    treeItems[nextIndex]?.focus();
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

  const layerDragOver = (
    event: DragEvent<HTMLElement>,
    targetId: string,
    canContain = false,
  ) => {
    if (draggedLayerIds.length === 0 || draggedLayerIds.includes(targetId)) return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const edge = event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
    setDropIndicator({ id: targetId, edge });
    const tree = layerTreeRef.current;
    if (tree) {
      const treeBounds = tree.getBoundingClientRect();
      const topDistance = event.clientY - treeBounds.top;
      const bottomDistance = treeBounds.bottom - event.clientY;
      if (topDistance < 28) tree.scrollTop -= Math.max(1, Math.ceil((28 - topDistance) / 28 * 6));
      else if (bottomDistance < 28) tree.scrollTop += Math.max(1, Math.ceil((28 - bottomDistance) / 28 * 6));
    }
    if (canContain && event.currentTarget.classList.contains("layer-group-row")) return;
  };

  const layerDrop = (event: DragEvent<HTMLElement>, targetId: string, groupId?: string) => {
    event.preventDefault();
    event.stopPropagation();
    if (!activeScreen || draggedLayerIds.length === 0) return;
    if (draggedLayerIds.includes(targetId)) {
      setDraggedLayerIds([]);
      setDropIndicator(null);
      return;
    }
    if (groupId) {
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
    } else if (dropIndicator?.id === targetId) {
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
                  dropIndicator.edge,
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

  const renderWidgetRow = (widget: Widget, nested = false) => {
    const definition = getShapeToolDefinition(widget.type);
    const selected = selectedIds.includes(widget.id);
    const label = widgetLabel(widget);
    return (
      <div
        key={widget.id}
        className={`layer-row${nested ? " is-nested" : ""}${selected ? " is-selected" : ""}${widget.locked ? " is-locked" : ""}${!widget.visible ? " is-hidden" : ""}${["symbol", "symbol-instance", "symbolInstance"].includes(widget.type) ? " is-symbol" : ""}${recentWidgetIds.has(widget.id) ? " is-new" : ""}${dropIndicator?.id === widget.id ? ` drop-${dropIndicator.edge}` : ""}`}
        role="treeitem"
        tabIndex={-1}
        aria-selected={selected}
        draggable={!renamingWidgetId}
        onDragStart={(event) => {
          const sourceIds = selectedIds.includes(widget.id) ? selectedIds : [widget.id];
          const sourceWidgets = (activeScreen?.widgets ?? []).filter((item) =>
            sourceIds.includes(item.id),
          );
          setDraggedLayerIds(sourceWidgets.map((item) => item.id));
          beginLayerDrag(event, sourceWidgets, label);
        }}
        onDragOver={(event) => layerDragOver(event, widget.id)}
        onDrop={(event) => layerDrop(event, widget.id)}
        onDragEnd={() => {
          setActiveLayerDragPayload(null);
          setDraggedLayerIds([]);
          setDropIndicator(null);
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
            <span className="layer-chevron-spacer" aria-hidden="true" />
            <WidgetThumbnail widget={widget} />
            <WidgetIcon type={widget.type} />
            <span className="layer-copy">
              <span className="layer-name">{label}</span>
              <span className="layer-type">{definition?.label ?? widget.type}</span>
            </span>
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
        {project.screens.map((screen) => (
          <div
            className={`page-item${screen.id === activeScreenId ? " selected" : ""}${screen.id === draggedScreenId ? " is-dragging" : ""}`}
            key={screen.id}
            aria-current={screen.id === activeScreenId ? "page" : undefined}
            draggable={renamingScreenId !== screen.id}
            onClick={() => useStore.getState().setActiveScreen(screen.id)}
            onDoubleClick={() => startScreenRename(screen)}
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
            <span className="page-thumb"><span /></span>
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
                }}
                onClick={(event) => event.stopPropagation()}
              />
            ) : (
              <span>{screen.name}</span>
            )}
            {screen.device && (
              <span
                className="page-device-size"
                title={`${findDevicePreset(screen.device.presetId)?.name ?? "Custom"} · ${screen.device.width} × ${screen.device.height} · ${screen.device.dpr}×`}
              >
                {screen.device.width} × {screen.device.height}
              </span>
            )}
            {screen.id === project.startScreenId && (
              <span className="start-screen-badge" title="Start screen">Start</span>
            )}
            <span className="page-count">{screen.widgets.length}</span>
          </div>
        ))}
      </section>

      <section className="sidebar-section layers-section" aria-label="Layers">
        <div className="layer-tree-toolbar">
          <div className="layer-tree-title">
            <span>LAYERS</span>
            <span className="layer-count">{activeScreen?.widgets.length ?? 0}</span>
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
                  {mode === "category" ? "By Category" : mode === "z-order" ? "By Z-Order" : "By Type"}
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
        {activeScreen && activeScreen.widgets.length > 0 && visibleLayerEntries.length > 0 ? (
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
            <div className="layer-virtual-spacer" style={{ height: virtualizedRange.topSpacerHeight }} aria-hidden="true" />
            {visibleLayerEntries.map((entry) => {
              if (entry.kind === "widget") return renderWidgetRow(entry.widget, entry.nested);
              if (entry.kind === "group") {
                const collapseKey = `semantic:${entry.id}`;
                const invalidDrop = draggedLayerIds.length > 0 &&
                  entry.members.some((member) => draggedLayerIds.includes(member.id));
                return (
                  <div
                    key={`semantic-${entry.id}`}
                    className={`layer-group-row${dropIndicator?.id === entry.id ? ` drop-${dropIndicator.edge}` : ""}${dropIndicator?.id === entry.id && draggedLayerIds.length > 0 ? invalidDrop ? " is-invalid-drop" : " is-drop-target" : ""}`}
                    role="treeitem"
                    tabIndex={0}
                    aria-expanded={!entry.collapsed}
                    data-group-id={collapseKey}
                    onKeyDown={navigateLayerTree}
                    onClick={() => toggleGroup(entry.id, collapseKey)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setMenu({ kind: "group", id: entry.id, x: event.clientX, y: event.clientY });
                    }}
                    draggable
                    onDragStart={(event) => {
                      setDraggedLayerIds(entry.members.map((member) => member.id));
                      beginLayerDrag(event, entry.members, "Group");
                    }}
                    onDragEnd={() => {
                      setActiveLayerDragPayload(null);
                      setDraggedLayerIds([]);
                      setDropIndicator(null);
                    }}
                    onDragOver={(event) => layerDragOver(event, entry.id, true)}
                    onDrop={(event) => layerDrop(event, entry.id, entry.id)}
                  >
                    <button
                      className="layer-group-toggle"
                      aria-label={`${entry.collapsed ? "Expand" : "Collapse"} group`}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleGroup(entry.id, collapseKey);
                      }}
                    >
                      {entry.collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                    </button>
                    <Folder size={14} aria-hidden="true" />
                    <span className="layer-group-name">Group</span>
                    <span className="layer-group-count">{entry.members.length}</span>
                    {invalidDrop && <CircleX className="layer-invalid-drop-icon" size={14} aria-label="Invalid drop target" />}
                    <button
                      className="layer-tree-action"
                      aria-label="Group options"
                      onClick={(event) => {
                        event.stopPropagation();
                        setMenu({ kind: "group", id: entry.id, x: event.clientX, y: event.clientY });
                      }}
                    >
                      <MoreHorizontal size={13} />
                    </button>
                  </div>
                );
              }
              const { group, collapsed } = entry;
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
                  label={isRenaming ? renameGroupDraft : currentLabel}
                  count={widgets.length}
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
              <button role="menuitem" onClick={() => toggleGroup(menu.id)}>
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
