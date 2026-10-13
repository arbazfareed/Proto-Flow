import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  ChevronDown,
  ChevronRight,
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
  Unlock,
  X,
} from "lucide-react";
import { getShapeToolDefinition } from "../canvas/shapeTools";
import { DEFAULT_DEVICE_PRESET, findDevicePreset, toScreenDevice } from "../devices/catalog";
import { DevicePicker } from "../devices/DevicePicker";
import type { ScreenDevice } from "../devices/types";
import { reorderScreens, reorderWidgets } from "../project/layers";
import type { Project, Screen, Widget } from "../project/schema";
import { useStore } from "../store";

type MenuState =
  | { kind: "screen" | "layer" | "group"; id: string; x: number; y: number }
  | null;

type DropIndicator = { id: string; edge: "before" | "after" } | null;

function collapsedStorageKey(projectId: string): string {
  return `protoflow:collapsed-layer-groups:${projectId}`;
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
  const [draggedLayerId, setDraggedLayerId] = useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<DropIndicator>(null);
  const [collapsedByScreen, setCollapsedByScreen] = useState(() =>
    readCollapsedGroups(project.id),
  );
  const cancelScreenRenameRef = useRef(false);
  const cancelWidgetRenameRef = useRef(false);
  const layerTreeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCollapsedByScreen(readCollapsedGroups(project.id));
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
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
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
  }, [activeScreen, selectedIds]);

  const collapsedGroups = collapsedByScreen[activeScreenId] ?? [];
  const layerTree = useMemo(() => {
    const widgets = activeScreen?.widgets ?? [];
    const groups = new Map<string, Widget[]>();
    for (const widget of widgets) {
      if (!widget.groupId) continue;
      const members = groups.get(widget.groupId) ?? [];
      members.push(widget);
      groups.set(widget.groupId, members);
    }
    for (const members of groups.values()) {
      members.sort((first, second) => second.zIndex - first.zIndex);
    }
    const groupOrder = [...groups.entries()].sort(
      (first, second) =>
        Math.max(...second[1].map((widget) => widget.zIndex)) -
        Math.max(...first[1].map((widget) => widget.zIndex)),
    );
    const ungrouped = widgets
      .filter((widget) => !widget.groupId)
      .sort((first, second) => second.zIndex - first.zIndex);
    return { groups: groupOrder, ungrouped };
  }, [activeScreen]);

  const addScreen = (device: ScreenDevice) => {
    const name = device.presetId === "custom"
      ? `Custom ${device.width} × ${device.height}`
      : findDevicePreset(device.presetId)?.name ?? `Screen ${project.screens.length + 1}`;
    const screen: Screen = {
      id: crypto.randomUUID(),
      name,
      device,
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

  const toggleGroup = (groupId: string) => {
    const nextForScreen = collapsedGroups.includes(groupId)
      ? collapsedGroups.filter((id) => id !== groupId)
      : [...collapsedGroups, groupId];
    const next = { ...collapsedByScreen, [activeScreenId]: nextForScreen };
    setCollapsedByScreen(next);
    try {
      localStorage.setItem(collapsedStorageKey(project.id), JSON.stringify(next));
    } catch (error) {
      console.error("Could not save the layer-tree collapse state.", error);
    }
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
    if (!draggedLayerId || draggedLayerId === targetId) return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const edge = event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
    setDropIndicator({ id: targetId, edge });
    const tree = layerTreeRef.current;
    if (tree) {
      const treeBounds = tree.getBoundingClientRect();
      if (event.clientY < treeBounds.top + 24) tree.scrollTop -= 12;
      else if (event.clientY > treeBounds.bottom - 24) tree.scrollTop += 12;
    }
    if (canContain && event.currentTarget.classList.contains("layer-group-row")) return;
  };

  const layerDrop = (event: DragEvent<HTMLElement>, targetId: string, groupId?: string) => {
    event.preventDefault();
    event.stopPropagation();
    if (!activeScreen || !draggedLayerId) return;
    if (groupId) {
      setWidgetProperty(draggedLayerId, { groupId });
    } else if (dropIndicator?.id === targetId) {
      editProject((current) => ({
        ...current,
        screens: current.screens.map((screen) =>
          screen.id !== activeScreen.id
            ? screen
            : {
                ...screen,
                widgets: reorderWidgets(
                  screen.widgets,
                  draggedLayerId,
                  targetId,
                  dropIndicator.edge,
                ),
              },
        ),
      }));
    }
    setDraggedLayerId(null);
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
    const Icon = definition?.icon ?? Layers2;
    const selected = selectedIds.includes(widget.id);
    const label = widgetLabel(widget);
    return (
      <div
        key={widget.id}
        className={`layer-row${nested ? " is-nested" : ""}${selected ? " is-selected" : ""}${widget.locked ? " is-locked" : ""}${dropIndicator?.id === widget.id ? ` drop-${dropIndicator.edge}` : ""}`}
        draggable={!renamingWidgetId}
        onDragStart={(event) => {
          setDraggedLayerId(widget.id);
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", widget.id);
        }}
        onDragOver={(event) => layerDragOver(event, widget.id)}
        onDrop={(event) => layerDrop(event, widget.id)}
        onDragEnd={() => {
          setDraggedLayerId(null);
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
            <Icon size={14} aria-hidden="true" />
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
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", screen.id);
            }}
            onDragOver={(event) => screenDragOver(event, screen.id)}
            onDrop={(event) => screenDrop(event, screen.id)}
            onDragEnd={(event) => {
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
        <div className="section-label">
          <span>LAYERS</span>
          <span className="layer-count">{activeScreen?.widgets.length ?? 0}</span>
        </div>
        {activeScreen && activeScreen.widgets.length > 0 ? (
          <div className="layer-list" aria-label="Widget layers" ref={layerTreeRef}>
            {layerTree.groups.map(([groupId, members]) => {
              const collapsed = collapsedGroups.includes(groupId);
              const groupSelected = members.some((widget) => selectedIds.includes(widget.id));
              return (
                <div className="layer-group" key={groupId}>
                  <div
                    className={`layer-group-row${dropIndicator?.id === groupId ? ` drop-${dropIndicator.edge}` : ""}`}
                    onDragOver={(event) => layerDragOver(event, groupId, true)}
                    onDrop={(event) => layerDrop(event, groupId, groupId)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setMenu({ kind: "group", id: groupId, x: event.clientX, y: event.clientY });
                    }}
                  >
                    <button
                      className="layer-group-toggle"
                      aria-expanded={!collapsed}
                      aria-label={`${collapsed ? "Expand" : "Collapse"} layer group`}
                      onClick={() => toggleGroup(groupId)}
                    >
                      {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                      <Folder size={14} />
                      <span>Group</span>
                      <span className="layer-type">{members.length}</span>
                    </button>
                    {groupSelected && (
                      <button
                        className="layer-group-select"
                        aria-label="Select group layers"
                        onClick={(event) =>
                          useStore.getState().select(
                            event.shiftKey
                              ? [...new Set([...selectedIds, ...members.map((item) => item.id)])]
                              : members.map((item) => item.id),
                          )
                        }
                      >
                        <Layers2 size={13} />
                      </button>
                    )}
                  </div>
                  {!collapsed && members.map((widget) => renderWidgetRow(widget, true))}
                </div>
              );
            })}
            {layerTree.ungrouped.map((widget) => renderWidgetRow(widget))}
          </div>
        ) : (
          <div className="sidebar-empty-state">
            <Layers2 size={16} />
            <span>Widgets will appear here as you add them.</span>
          </div>
        )}
      </section>

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
