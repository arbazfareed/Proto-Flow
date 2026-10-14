import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent } from "react";
import { Group, Layer, Line, Rect, Shape, Stage, Text, Transformer } from "react-konva";
import type Konva from "konva";
import { ArrowDownToLine, FolderOpen, Minus, Plus } from "lucide-react";
import type { Stage as KonvaStage } from "konva/lib/Stage";
import type { Layer as KonvaLayer } from "konva/lib/Layer";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useStore } from "../store";
import {
  getScreenBreakpoints,
  getWidgetsMissingBreakpointOverrides,
  getWidgetsOutsideBreakpointViewport,
  resolveWidgetsForBreakpoint,
  resolveActiveBreakpoint,
  updateWidgetOverride,
} from "../project/responsive";
import { DEFAULT_DEVICE_PRESET, findDevicePreset, toScreenDevice } from "../devices/catalog";
import { DeviceFrame } from "../devices/DeviceFrame";
import {
  getDeviceFrameBounds,
  getSafeAreaBounds,
  getWidgetsOutsideSafeArea,
} from "../devices/frame";
import type { ScreenDevice } from "../devices/types";
import type { Widget, Project, Screen } from "../project/schema";
import {
  createDraggedWidgetCopies,
  getActiveLayerDragPayload,
  LAYER_DRAG_MIME,
  parseLayerDragPayload,
} from "../project/layerDrag";
import {
  clampCanvasZoom,
  fitCanvasBounds,
  getVisibleGridSpacing,
  getWidgetBounds,
  normalizeCanvasViewport,
  worldToScreen,
  zoomAroundPointer,
} from "./navigation";
import { snapWidgetPosition, type CanvasGuide, type CanvasPoint } from "./snapping";
import {
  createShapeWidget,
  getShapeDefinition,
  measureTextBounds,
  renderWidgetShape,
  MAX_WIDGET_TEXT_LENGTH,
  type ShapeTool,
} from "./shapes";
import {
  constrainTransformerBounds,
  getSelectedParentWidgetIds,
  getSelectionBounds,
  getSelectionUpdates,
  getWidgetsInsideBounds,
  type SelectionOperation,
} from "./selection";
import {
  IMAGE_ASSET_THRESHOLD,
  MAX_INLINE_IMAGE_BYTES,
  getImageDataByteSize,
  getInlineImageBytes,
  readImageFile,
  type ImportedImage,
} from "./images";

interface CanvasSize {
  width: number;
  height: number;
}

interface CanvasStageProps {
  onSaveAs: () => void;
  onOpen: () => void;
  onOpenPalette: () => void;
  onNotify: (message: string, isError?: boolean) => void;
  activeTool: ShapeTool | null;
  onToolChange: (tool: ShapeTool | null) => void;
}

interface PendingView {
  zoom: number;
  pan: { x: number; y: number };
}

interface ShapeDraft {
  tool: ShapeTool;
  start: CanvasPoint;
  current: CanvasPoint;
  altKey: boolean;
  preview: Widget;
}

interface SelectionDraft {
  start: CanvasPoint;
  current: CanvasPoint;
}

type WidgetGeometryUpdate = Partial<
  Pick<Widget, "x" | "y" | "width" | "height" | "rotation">
> & { id: string };

interface CanvasDropFeedback {
  x: number;
  y: number;
  targetId: string | null;
  targetType?: string;
  itemCount: number;
  label: string;
}

function duplicateScreenForCanvas(screen: Screen): Screen {
  const widgetIds = new Map<string, string>();
  const groupIds = new Map<string, string>();
  const widgets = screen.widgets.map((widget) => {
    const id = crypto.randomUUID();
    widgetIds.set(widget.id, id);
    if (widget.groupId && !groupIds.has(widget.groupId)) {
      groupIds.set(widget.groupId, crypto.randomUUID());
    }
    return {
      ...structuredClone(widget),
      id,
      groupId: widget.groupId ? groupIds.get(widget.groupId) : undefined,
    };
  });
  return {
    ...structuredClone(screen),
    id: crypto.randomUUID(),
    name: `${screen.name} copy`.slice(0, 120),
    widgets,
    interactionRules: screen.interactionRules.map((rule) => ({
      ...structuredClone(rule),
      id: crypto.randomUUID(),
      actions: rule.actions.map((action) => ({
        ...action,
        target: widgetIds.get(action.target) ?? action.target,
      })),
    })),
  };
}

function getEffectiveScreenWidgets(screen: Screen, breakpointId: string | null): Widget[] {
  const breakpoint = resolveActiveBreakpoint(screen, breakpointId);
  return resolveWidgetsForBreakpoint(
    screen.widgets,
    breakpoint,
    screen.device?.width ?? DEFAULT_DEVICE_PRESET.viewport.width,
    screen.device?.height ?? DEFAULT_DEVICE_PRESET.viewport.height,
  );
}

function commitWidgetGeometry(
  updates: readonly WidgetGeometryUpdate[],
  historySnapshot?: Project,
): void {
  if (updates.length === 0) return;
  const updateById = new Map(updates.map((update) => [update.id, update]));
  const current = useStore.getState();
  const screenId = current.getActiveScreenId();
  const activeScreen = current.project.screens.find((screen) => screen.id === screenId);
  const activeBreakpointId = current.activeBreakpointId;
  const overrideBreakpointId =
    activeBreakpointId &&
    activeScreen &&
    getScreenBreakpoints(activeScreen).some((breakpoint) => breakpoint.id === activeBreakpointId)
      ? activeBreakpointId
      : null;
  const effectiveWidgets = activeScreen
    ? getEffectiveScreenWidgets(activeScreen, overrideBreakpointId)
    : [];
  const project: Project = {
    ...current.project,
    updatedAt: new Date().toISOString(),
    screens: current.project.screens.map((screen) =>
      screen.id !== screenId
        ? screen
        : {
            ...screen,
            breakpoints: screen.id === screenId && overrideBreakpointId
              ? screen.breakpoints ?? [...getScreenBreakpoints(screen)]
              : screen.breakpoints,
            widgets: screen.widgets.map((widget) => {
              const update = updateById.get(widget.id);
              if (!update) return widget;
              const { id, ...geometry } = update;
              const previous = effectiveWidgets.find((item) => item.id === id) ?? widget;
              if (
                (geometry.x === undefined || geometry.x === previous.x) &&
                (geometry.y === undefined || geometry.y === previous.y) &&
                (geometry.width === undefined || geometry.width === previous.width) &&
                (geometry.height === undefined || geometry.height === previous.height) &&
                (geometry.rotation === undefined || geometry.rotation === previous.rotation)
              ) {
                return widget;
              }
              return overrideBreakpointId
                ? updateWidgetOverride(widget, overrideBreakpointId, geometry)
                : { ...widget, ...geometry };
            }),
          },
    ),
  };
  if (project.screens.some((screen, index) =>
    screen.widgets.some((widget, widgetIndex) =>
      widget !== current.project.screens[index]?.widgets[widgetIndex],
    ),
  )) {
    if (historySnapshot) useStore.setState({ project, isDirty: true });
    else current.setProject(project);
  } else if (
    historySnapshot &&
    current.past.at(-1) === historySnapshot
  ) {
    useStore.setState({ past: current.past.slice(0, -1) });
  }
}

function isEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.isContentEditable ||
      target.closest("input, textarea, select, [contenteditable='true']"),
  );
}

function GridLayer({
  size,
  zoom,
  pan,
  gridSize,
  gridStyle,
  visible,
}: {
  size: CanvasSize;
  zoom: number;
  pan: { x: number; y: number };
  gridSize: number;
  gridStyle: "dots" | "lines";
  visible: boolean;
}) {
  if (!visible || size.width === 0 || size.height === 0) return null;

  const left = -pan.x / zoom;
  const top = -pan.y / zoom;
  const right = (size.width - pan.x) / zoom;
  const bottom = (size.height - pan.y) / zoom;
  const spacing = getVisibleGridSpacing(gridSize, zoom);

  return (
    <Layer listening={false} perfectDrawEnabled={false}>
      <Shape
        x={left}
        y={top}
        width={right - left}
        height={bottom - top}
        fill={gridStyle === "dots" ? "#34353b" : undefined}
        perfectDrawEnabled={false}
        sceneFunc={(context, shape) => {
          const firstX = Math.ceil(left / spacing) * spacing;
          const firstY = Math.ceil(top / spacing) * spacing;
          const radius = 0.65 / zoom;

          context.beginPath();
          if (gridStyle === "dots") {
            for (let x = firstX; x <= right; x += spacing) {
              for (let y = firstY; y <= bottom; y += spacing) {
                context.moveTo(x - left + radius, y - top);
                context.arc(x - left, y - top, radius, 0, Math.PI * 2);
              }
            }
          } else {
            for (let x = firstX; x <= right; x += spacing) {
              context.moveTo(x - left, 0);
              context.lineTo(x - left, bottom - top);
            }
            for (let y = firstY; y <= bottom; y += spacing) {
              context.moveTo(0, y - top);
              context.lineTo(right - left, y - top);
            }
          }
          context.fillStrokeShape(shape);
        }}
        stroke={gridStyle === "lines" ? "#34353b" : undefined}
        strokeWidth={gridStyle === "lines" ? 0.45 / zoom : undefined}
      />
    </Layer>
  );
}

function GuideLayer({
  guides,
  size,
  zoom,
  pan,
}: {
  guides: CanvasGuide[];
  size: CanvasSize;
  zoom: number;
  pan: CanvasPoint;
}) {
  if (guides.length === 0) return null;
  const left = -pan.x / zoom;
  const top = -pan.y / zoom;
  const right = (size.width - pan.x) / zoom;
  const bottom = (size.height - pan.y) / zoom;

  return (
    <Layer listening={false} perfectDrawEnabled={false}>
      {guides.map((guide) => (
        <Group key={`${guide.axis}-${guide.coordinate}`} listening={false}>
          <Line
            points={
              guide.axis === "x"
                ? [guide.coordinate, top, guide.coordinate, bottom]
                : [left, guide.coordinate, right, guide.coordinate]
            }
            stroke="#f06ee8"
            strokeWidth={1 / zoom}
            perfectDrawEnabled={false}
          />
          <Text
            x={guide.axis === "x" ? guide.coordinate + 4 / zoom : left + 4 / zoom}
            y={guide.axis === "y" ? guide.coordinate + 4 / zoom : top + 4 / zoom}
            text={`${Math.round(guide.distance)} px`}
            fontSize={10 / zoom}
            padding={3 / zoom}
            fill="#ffffff"
            background="#a34a9c"
            perfectDrawEnabled={false}
          />
        </Group>
      ))}
    </Layer>
  );
}

function WidgetNode({
  widget,
  selected,
  hovered,
  parentHighlighted,
  zoom,
  activeTool,
  position,
  onSelect,
  onHover,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDragBound,
  onEdit,
}: {
  widget: Widget;
  selected: boolean;
  hovered: boolean;
  parentHighlighted: boolean;
  zoom: number;
  activeTool: ShapeTool | null;
  position: CanvasPoint;
  onSelect: (event: { evt: MouseEvent | TouchEvent }) => void;
  onHover: (hovered: boolean) => void;
  onDragStart: () => void;
  onDragMove: (position: CanvasPoint, altKey: boolean) => void;
  onDragEnd: (position: CanvasPoint) => void;
  onDragBound: (position: CanvasPoint) => CanvasPoint;
  onEdit: () => void;
}) {
  return (
    <Group
      id={widget.id}
      x={position.x}
      y={position.y}
      rotation={widget.rotation}
      opacity={widget.opacity}
      visible={widget.visible}
      listening={!widget.locked}
      draggable={!widget.locked && activeTool === null}
      dragBoundFunc={onDragBound}
      onClick={(event) => onSelect(event)}
      onTap={(event) => onSelect(event)}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onDblClick={(event) => {
        event.cancelBubble = true;
        onEdit();
      }}
      onDragStart={onDragStart}
      onDragMove={(event) =>
        onDragMove(
          { x: event.target.x(), y: event.target.y() },
          event.evt instanceof MouseEvent && event.evt.altKey,
        )
      }
      onDragEnd={(event) =>
        onDragEnd({ x: event.target.x(), y: event.target.y() })
      }
    >
      {renderWidgetShape(widget, selected)}
      {(selected || hovered || parentHighlighted) && (
        <Rect
          x={-2 / zoom}
          y={-2 / zoom}
          width={widget.width + 4 / zoom}
          height={widget.height + 4 / zoom}
          fillEnabled={false}
          stroke={selected ? "#bba5ff" : parentHighlighted ? "#63cf9c" : "#68a7ff"}
          strokeWidth={1 / zoom}
          dash={selected ? undefined : [4 / zoom, 3 / zoom]}
          listening={false}
          perfectDrawEnabled={false}
        />
      )}
    </Group>
  );
}

type EditableWidgetText = {
  key: "text" | "label" | "placeholder" | "value";
  value: string;
};

function getEditableWidgetText(widget: Widget): EditableWidgetText | null {
  const keys =
    widget.type === "text"
      ? ["text"]
      : widget.type === "input"
        ? [widget.props.value ? "value" : "placeholder"]
        : ["button", "checkbox", "radio", "toggle"].includes(widget.type)
          ? ["label"]
          : [];
  const key = keys[0] as EditableWidgetText["key"] | undefined;
  if (!key) return null;
  const value = widget.props[key];
  return { key, value: typeof value === "string" ? value : "" };
}

function updateWidgetProps(
  widgetId: string,
  patch: Record<string, unknown>,
): void {
  const current = useStore.getState();
  const screenId = current.getActiveScreenId();
  const screen = current.project.screens.find((item) => item.id === screenId);
  const breakpointId = current.activeBreakpointId;
  const overrideBreakpointId =
    screen &&
    breakpointId &&
    getScreenBreakpoints(screen).some((breakpoint) => breakpoint.id === breakpointId);
  const resolvedOverrideBreakpointId = overrideBreakpointId ? breakpointId : null;
  const project: Project = {
    ...current.project,
    updatedAt: new Date().toISOString(),
    screens: current.project.screens.map((screen) =>
      screen.id !== screenId
        ? screen
        : {
            ...screen,
            breakpoints: resolvedOverrideBreakpointId
              ? screen.breakpoints ?? [...getScreenBreakpoints(screen)]
              : screen.breakpoints,
            widgets: screen.widgets.map((widget) =>
              widget.id === widgetId
                ? resolvedOverrideBreakpointId
                  ? updateWidgetOverride(widget, resolvedOverrideBreakpointId, {
                      props: { ...widget.props, ...patch },
                    })
                  : { ...widget, props: { ...widget.props, ...patch } }
                : widget,
            ),
          },
    ),
  };
  current.setProject(project);
}

export function CanvasStage({
  onSaveAs,
  onOpen,
  onOpenPalette,
  onNotify,
  activeTool,
  onToolChange,
}: CanvasStageProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<KonvaStage>(null);
  const contentLayerRef = useRef<KonvaLayer>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const imageTargetRef = useRef<string | null>(null);
  const cancelEditRef = useRef(false);
  const panGestureRef = useRef<{ pointerId: number; x: number; y: number } | null>(
    null,
  );
  const spacePressedRef = useRef(false);
  const currentViewRef = useRef<PendingView>({
    zoom: useStore.getState().zoom,
    pan: useStore.getState().pan,
  });
  const pendingViewRef = useRef<PendingView | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const dragFeedbackFrameRef = useRef<number | null>(null);
  const pendingDragFeedbackRef = useRef<CanvasDropFeedback | null>(null);
  const [size, setSize] = useState<CanvasSize>({ width: 0, height: 0 });
  const [spacePressed, setSpacePressed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [previewPositions, setPreviewPositions] = useState<Record<string, CanvasPoint>>({});
  const [guides, setGuides] = useState<CanvasGuide[]>([]);
  const [shapeDraft, setShapeDraft] = useState<ShapeDraft | null>(null);
  const [selectionDraft, setSelectionDraft] = useState<SelectionDraft | null>(null);
  const [canvasDropFeedback, setCanvasDropFeedback] = useState<CanvasDropFeedback | null>(null);
  const [editing, setEditing] = useState<{
    widgetId: string;
    key: EditableWidgetText["key"];
    value: string;
  } | null>(null);
  const [editValue, setEditValue] = useState("");
  const altHeldRef = useRef(false);
  const pendingGuidesRef = useRef<CanvasGuide[]>([]);
  const dragStartPositionsRef = useRef<Map<string, CanvasPoint> | null>(null);
  const dragPrimaryIdRef = useRef<string | null>(null);
  const dragHistorySnapshotRef = useRef<Project | null>(null);
  const transformHistorySnapshotRef = useRef<Project | null>(null);
  const guideTimerRef = useRef<number | null>(null);
  const lastFitKeyRef = useRef("");
  const activeToolRef = useRef<ShapeTool | null>(activeTool);
  const lastPointerWorldRef = useRef<CanvasPoint>({ x: 0, y: 0 });
  const zoom = useStore((state) => state.zoom);
  const pan = useStore((state) => state.pan);
  const gridSize = useStore((state) => state.gridSize);
  const gridStyle = useStore((state) => state.gridStyle);
  const gridVisible = useStore((state) => state.gridVisible);
  const snapEnabled = useStore((state) => state.snapEnabled);
  const showDeviceFrame = useStore((state) => state.showDeviceFrame);
  const showSafeArea = useStore((state) => state.showSafeArea);
  const statusBarTheme = useStore((state) => state.statusBarTheme);
  const statusBarTimeMode = useStore((state) => state.statusBarTimeMode);
  const showBattery = useStore((state) => state.showBattery);
  const showSignal = useStore((state) => state.showSignal);
  const activeScreen = useStore((state) =>
    state.project.screens.find((screen) => screen.id === state.getActiveScreenId()),
  );
  const activeBreakpointId = useStore((state) => state.activeBreakpointId);
  const selectedIds = useStore((state) => state.selectedIds);
  const hoveredWidgetId = useStore((state) => state.hoveredWidgetId);
  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);
  const activeBreakpoint = activeScreen
    ? resolveActiveBreakpoint(activeScreen, activeBreakpointId)
    : undefined;
  const baseScreenWidgets = activeScreen?.widgets ?? [];
  const screenWidgets = activeScreen && activeBreakpoint
    ? resolveWidgetsForBreakpoint(
        baseScreenWidgets,
        activeBreakpoint,
        activeScreen.device?.width ?? DEFAULT_DEVICE_PRESET.viewport.width,
        activeScreen.device?.height ?? DEFAULT_DEVICE_PRESET.viewport.height,
      )
    : [...baseScreenWidgets].sort((first, second) => first.zIndex - second.zIndex);
  const selectedParentWidgetIds = useMemo(
    () => getSelectedParentWidgetIds(screenWidgets, selectedIds),
    [screenWidgets, selectedIds],
  );
  const baseDevice: ScreenDevice =
    activeScreen?.device ?? toScreenDevice(DEFAULT_DEVICE_PRESET);
  const activeDevice: ScreenDevice = activeBreakpoint
    ? {
        ...baseDevice,
        width: activeBreakpoint.width,
        height: activeBreakpoint.height,
        insets: {
          top: Math.min(baseDevice.insets.top, Math.max(0, activeBreakpoint.height - 1)),
          bottom: Math.min(baseDevice.insets.bottom, Math.max(0, activeBreakpoint.height - 1)),
          left: Math.min(baseDevice.insets.left, Math.max(0, activeBreakpoint.width - 1)),
          right: Math.min(baseDevice.insets.right, Math.max(0, activeBreakpoint.width - 1)),
        },
      }
    : baseDevice;
  const activeDevicePreset = findDevicePreset(activeDevice.presetId);
  const safeAreaBounds = getSafeAreaBounds(activeDevice);
  const widgetsOutsideSafeArea = getWidgetsOutsideSafeArea(screenWidgets, activeDevice);
  const widgetsOutsideBreakpointViewport = activeBreakpoint
    ? getWidgetsOutsideBreakpointViewport(screenWidgets, activeBreakpoint)
    : [];
  const widgetsMissingBreakpointOverrides = activeBreakpoint
    ? getWidgetsMissingBreakpointOverrides(screenWidgets, activeBreakpoint.id)
    : [];
  const selectedWidgets = screenWidgets.filter((widget) =>
    selectedIds.includes(widget.id),
  );
  const selectionBounds = getSelectionBounds(selectedWidgets);

  useEffect(() => {
    const transformer = transformerRef.current;
    const stage = stageRef.current;
    if (!transformer || !stage) return;
    transformer.nodes(
      selectedWidgets
        .filter((widget) => !widget.locked && widget.visible)
        .map((widget) => stage.findOne(`#${widget.id}`))
        .filter((node): node is Konva.Node => node !== undefined),
    );
    contentLayerRef.current?.batchDraw();
  }, [selectedIds, activeScreen?.widgets]);

  const commitViewOnFrame = useCallback((view: PendingView) => {
    pendingViewRef.current = view;
    if (animationFrameRef.current !== null) return;

    animationFrameRef.current = window.requestAnimationFrame(() => {
      animationFrameRef.current = null;
      const pendingView = pendingViewRef.current;
      if (!pendingView) return;
      pendingViewRef.current = null;
      useStore.setState({ zoom: pendingView.zoom, pan: pendingView.pan });
    });
  }, []);

  const applyView = useCallback(
    (view: PendingView) => {
      const normalizedView = {
        zoom: clampCanvasZoom(view.zoom),
        pan: view.pan,
      };
      currentViewRef.current = normalizedView;
      stageRef.current?.setAttrs({
        x: normalizedView.pan.x,
        y: normalizedView.pan.y,
        scaleX: normalizedView.zoom,
        scaleY: normalizedView.zoom,
      });
      stageRef.current?.batchDraw();
      commitViewOnFrame(normalizedView);
    },
    [commitViewOnFrame],
  );

  useEffect(() => {
    if (size.width === 0 || size.height === 0) return;
    const frameBounds = getDeviceFrameBounds(
      activeDevice,
      activeDevicePreset?.frameChrome?.bezel ?? 0,
      showDeviceFrame,
    );
    const fitKey = [
      activeScreen?.id ?? "",
      activeDevice.presetId,
      activeDevice.width,
      activeDevice.height,
      activeDevicePreset?.frameChrome?.bezel ?? 0,
      showDeviceFrame,
    ].join(":");
    if (lastFitKeyRef.current === fitKey) return;
    lastFitKeyRef.current = fitKey;
    applyView(fitCanvasBounds(frameBounds, size, 40));
  }, [
    activeDevice,
    activeDevicePreset?.frameChrome?.bezel,
    activeScreen?.id,
    applyView,
    showDeviceFrame,
    size,
  ]);

  const getPointerWorldPosition = useCallback((): CanvasPoint | null => {
    const stage = stageRef.current;
    const pointer = stage?.getPointerPosition();
    if (!stage || !pointer) return null;
    return stage.getAbsoluteTransform().copy().invert().point(pointer);
  }, []);

  const createWidgetAt = useCallback(
    (
      type: ShapeTool,
      position: CanvasPoint,
      bounds?: { width: number; height: number; points?: number[] },
      altKey = altHeldRef.current,
    ): string | null => {
      const current = useStore.getState();
      const screen = current.project.screens.find(
        (item) => item.id === current.getActiveScreenId(),
      );
      const device = screen?.device ?? toScreenDevice(DEFAULT_DEVICE_PRESET);
      if (!screen) return null;

      const definition = getShapeDefinition(type);
      if (!definition) return null;
      let width = bounds?.width ?? definition.width;
      let height = bounds?.height ?? definition.height;
      let props = { ...definition.props };
      if (bounds?.points) props.points = bounds.points;

      if (type === "text") {
        const text = typeof props.text === "string" ? props.text : "Text";
        const fontSize = typeof props.fontSize === "number" ? props.fontSize : 24;
        const fontFamily =
          typeof props.fontFamily === "string" ? props.fontFamily : "Arial";
        const fontWeight =
          typeof props.fontWeight === "string" ? props.fontWeight : "normal";
        const lineHeight =
          typeof props.lineHeight === "number" ? props.lineHeight : 1.2;
        if (!bounds) {
          const measured = measureTextBounds(
            text,
            fontFamily,
            fontSize,
            fontWeight,
            lineHeight,
          );
          width = measured.width;
          height = measured.height;
        } else {
          props.autoSize = false;
        }
      }

      const widget = createShapeWidget(type, position.x, position.y, width, height, props);
      if (type === "button" && typeof window !== "undefined") {
        const accent = getComputedStyle(document.documentElement)
          .getPropertyValue("--accent-strong")
          .trim();
        if (/^#[\da-f]{3,8}$/i.test(accent)) {
          widget.style.fill = accent;
          widget.style.stroke = accent;
        }
      }
      const siblings = screen.widgets.map((item) => ({
        id: item.id,
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
      }));
      const snap = snapWidgetPosition(
        {
          id: widget.id,
          x: widget.x,
          y: widget.y,
          width: widget.width,
          height: widget.height,
        },
        siblings,
        current.gridSize,
        current.snapEnabled,
        altKey,
        getSafeAreaBounds(device),
      );
      widget.x = snap.position.x;
      widget.y = snap.position.y;
      widget.zIndex = screen.widgets.reduce(
        (highest, item) => Math.max(highest, item.zIndex),
        -1,
      ) + 1;

      current.setProject({
        ...current.project,
        updatedAt: new Date().toISOString(),
        screens: current.project.screens.map((item) =>
          item.id === screen.id
            ? { ...item, widgets: [...item.widgets, widget] }
            : item,
        ),
      });
      useStore.getState().select([widget.id]);

      if (guideTimerRef.current !== null) {
        window.clearTimeout(guideTimerRef.current);
      }
      setGuides(snap.guides);
      guideTimerRef.current = window.setTimeout(() => {
        guideTimerRef.current = null;
        setGuides([]);
      }, 900);
      return widget.id;
    },
    [],
  );

  const applyImportedImage = useCallback(
    async (
      image: ImportedImage,
      position: CanvasPoint,
      targetWidgetId: string | null = null,
      notifySuccess = true,
    ): Promise<boolean> => {
      if (targetWidgetId) {
        const target = useStore
          .getState()
          .project.screens.some((screen) =>
            screen.widgets.some(
              (widget) => widget.id === targetWidgetId && widget.type === "image",
            ),
          );
        if (!target) {
          onNotify("Select an image widget before replacing its image.", true);
          return false;
        }
      }
      const current = useStore.getState();
      let assetPath: string | undefined;
      const existingInlineImages = current.project.screens.flatMap((screen) =>
        screen.widgets
          .filter((widget) => widget.type === "image" && widget.id !== targetWidgetId)
          .map((widget) => widget.props.src)
          .filter((source): source is string => typeof source === "string"),
      );
      const inlineBytes = getInlineImageBytes(existingInlineImages);
      const imageBytes = getImageDataByteSize(image.src);
      const needsExternalAsset =
        imageBytes >= IMAGE_ASSET_THRESHOLD ||
        inlineBytes + imageBytes > MAX_INLINE_IMAGE_BYTES;
      if (needsExternalAsset && current.filePath && isTauri()) {
        try {
          assetPath = await invoke<string>("save_image_asset", {
            projectPath: current.filePath,
            mime: image.mime,
            base64: image.src.slice(image.src.indexOf(",") + 1),
          });
        } catch (error) {
          onNotify(
            error instanceof Error ? error.message : "Could not save the image asset.",
            true,
          );
          return false;
        }
      }

      const imageWidgetId =
        targetWidgetId ?? createWidgetAt("image", position);
      if (!imageWidgetId) return false;
      updateWidgetProps(imageWidgetId, {
        src: assetPath ? undefined : image.src,
        mime: image.mime,
        fileName: image.name,
        assetPath,
      });
      useStore.getState().select([imageWidgetId]);
      if (notifySuccess) {
        onNotify(
          assetPath ? "Image added to the project assets." : "Image added.",
        );
      }
      return true;
    },
    [createWidgetAt, onNotify],
  );

  const handleImageFile = useCallback(
    async (
      file: File,
      position: CanvasPoint,
      targetWidgetId: string | null = null,
    ) => {
      try {
        const image = await readImageFile(file);
        await applyImportedImage(image, position, targetWidgetId);
      } catch (error) {
        onNotify(
          error instanceof Error ? error.message : "Could not load the selected image.",
          true,
        );
      }
    },
    [applyImportedImage, onNotify],
  );

  const openImagePicker = useCallback((widgetId: string) => {
    imageTargetRef.current = widgetId;
    if (imageInputRef.current) {
      imageInputRef.current.value = "";
      imageInputRef.current.click();
    }
  }, []);

  const beginWidgetTextEdit = useCallback(
    (widget: Widget) => {
      if (widget.type === "image") {
        openImagePicker(widget.id);
        return;
      }
      const editable = getEditableWidgetText(widget);
      if (!editable) return;
      setEditing({ widgetId: widget.id, ...editable });
      setEditValue(editable.value.slice(0, MAX_WIDGET_TEXT_LENGTH));
    },
    [openImagePicker],
  );

  const commitWidgetTextEdit = useCallback(() => {
    if (!editing) return;
    updateWidgetProps(editing.widgetId, { [editing.key]: editValue });
    setEditing(null);
  }, [editValue, editing]);

  const cancelWidgetTextEdit = useCallback(() => {
    cancelEditRef.current = true;
    setEditing(null);
  }, []);

  const getWorldPositionFromClient = useCallback(
    (clientX: number, clientY: number): CanvasPoint => {
      const bounds = surfaceRef.current?.getBoundingClientRect();
      if (!bounds) return { x: 0, y: 0 };
      return {
        x: (clientX - bounds.left - currentViewRef.current.pan.x) / currentViewRef.current.zoom,
        y: (clientY - bounds.top - currentViewRef.current.pan.y) / currentViewRef.current.zoom,
      };
    },
    [],
  );

  const getCanvasDropTarget = useCallback((clientX: number, clientY: number): string | null => {
    const surface = surfaceRef.current;
    const stage = stageRef.current;
    if (!surface || !stage) return null;
    const bounds = surface.getBoundingClientRect();
    const node = stage.getIntersection({
      x: clientX - bounds.left,
      y: clientY - bounds.top,
    });
    let current: Konva.Node | null = node;
    while (current) {
      const id = current.id();
      if (id && screenWidgets.some((widget) => widget.id === id)) return id;
      current = current.getParent();
    }
    return null;
  }, [screenWidgets]);

  const updateCanvasDropFeedback = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    const bounds = surfaceRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const payload = getActiveLayerDragPayload() ??
      parseLayerDragPayload(event.dataTransfer.getData(LAYER_DRAG_MIME));
    const targetId = getCanvasDropTarget(event.clientX, event.clientY);
    const screenDrop = payload?.kind === "screen";
    pendingDragFeedbackRef.current = {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
      targetId: screenDrop ? null : targetId,
      targetType: screenDrop ? undefined : screenWidgets.find((widget) => widget.id === targetId)?.type,
      itemCount: payload?.kind === "widgets" ? payload.widgetIds.length : 1,
      label: payload?.kind === "widgets"
        ? screenWidgets.find((widget) => widget.id === payload.widgetIds[0])?.name ??
          screenWidgets.find((widget) => widget.id === payload.widgetIds[0])?.type ?? "Layer"
        : "Screen",
    };
    if (dragFeedbackFrameRef.current !== null) return;
    dragFeedbackFrameRef.current = window.requestAnimationFrame(() => {
      dragFeedbackFrameRef.current = null;
      setCanvasDropFeedback(pendingDragFeedbackRef.current);
    });
  }, [getCanvasDropTarget]);

  const clearCanvasDropFeedback = useCallback(() => {
    if (dragFeedbackFrameRef.current !== null) {
      window.cancelAnimationFrame(dragFeedbackFrameRef.current);
      dragFeedbackFrameRef.current = null;
    }
    pendingDragFeedbackRef.current = null;
    setCanvasDropFeedback(null);
  }, []);

  const handleLayerDrop = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes(LAYER_DRAG_MIME)) return false;
    event.preventDefault();
    clearCanvasDropFeedback();
    if (event.ctrlKey || event.metaKey) return true;
    const payload = parseLayerDragPayload(event.dataTransfer.getData(LAYER_DRAG_MIME));
    if (!payload) return true;

    const current = useStore.getState();
    if (payload.kind === "screen") {
      const source = current.project.screens.find((screen) => screen.id === payload.screenId);
      if (!source) return true;
      const duplicate = duplicateScreenForCanvas(source);
      current.setProject({
        ...current.project,
        updatedAt: new Date().toISOString(),
        screens: [...current.project.screens, duplicate],
      });
      useStore.getState().setActiveScreen(duplicate.id);
      return true;
    }

    const screenId = current.getActiveScreenId();
    const screen = current.project.screens.find((item) => item.id === screenId);
    if (!screen) return true;
    const sourceWidgets = screen.widgets.filter((widget) => payload.widgetIds.includes(widget.id));
    if (sourceWidgets.length !== payload.widgetIds.length) return true;
    if (
      event.altKey &&
      sourceWidgets.some((widget) =>
        ["symbol", "symbol-instance", "symbolInstance"].includes(widget.type),
      )
    ) {
      onNotify("Linked symbol instances are not supported by the current project schema.", true);
      return true;
    }
    const position = getWorldPositionFromClient(event.clientX, event.clientY);
    let copies = createDraggedWidgetCopies(
      sourceWidgets,
      position,
      Math.max(0, ...screen.widgets.map((widget) => widget.zIndex)),
    );
    const targetId = getCanvasDropTarget(event.clientX, event.clientY);
    let selected = copies;
    let nextWidgets = [...screen.widgets, ...copies];
    if (targetId && !sourceWidgets.some((widget) => widget.id === targetId)) {
      const target = screen.widgets.find((widget) => widget.id === targetId);
      if (target) {
        if (["group", "frame", "panel", "dynamic-panel", "dynamicPanel", "repeater", "card", "modal", "overlay"].includes(target.type)) {
          copies = copies.map((widget) => ({ ...widget, groupId: target.id }));
          selected = copies;
          nextWidgets = [...screen.widgets, ...copies];
        } else {
          const replacement = {
            ...copies[0],
            id: target.id,
            name: target.name,
            x: target.x,
            y: target.y,
            width: target.width,
            height: target.height,
            rotation: target.rotation,
            opacity: target.opacity,
            visible: target.visible,
            locked: target.locked,
            zIndex: target.zIndex,
            overrides: target.overrides,
            cascadeMode: target.cascadeMode,
            constraints: target.constraints,
          };
          selected = [replacement, ...copies.slice(1)];
          nextWidgets = screen.widgets.map((widget) =>
            widget.id === targetId ? replacement : widget,
          ).concat(copies.slice(1));
        }
      }
    }
    current.setProject({
      ...current.project,
      updatedAt: new Date().toISOString(),
      screens: current.project.screens.map((item) =>
        item.id === screenId ? { ...item, widgets: nextWidgets } : item,
      ),
    });
    useStore.getState().select(selected.map((widget) => widget.id));
    return true;
  }, [clearCanvasDropFeedback, getCanvasDropTarget, getWorldPositionFromClient, onNotify]);

  useEffect(() => {
    const cancelDropFeedback = (event: KeyboardEvent) => {
      if (event.key === "Escape") clearCanvasDropFeedback();
    };
    const finishNativeDrag = () => clearCanvasDropFeedback();
    window.addEventListener("keydown", cancelDropFeedback);
    window.addEventListener("dragend", finishNativeDrag);
    return () => {
      window.removeEventListener("keydown", cancelDropFeedback);
      window.removeEventListener("dragend", finishNativeDrag);
      if (dragFeedbackFrameRef.current !== null) {
        window.cancelAnimationFrame(dragFeedbackFrameRef.current);
      }
    };
  }, [clearCanvasDropFeedback]);

  const handleDroppedImagePaths = useCallback(
    async (paths: string[], position: CanvasPoint) => {
      if (paths.length === 0) return;
      let importedCount = 0;
      for (const [index, path] of paths.entries()) {
        try {
          const image = await invoke<{
            name: string;
            mime: string;
            size: number;
            base64: string;
          }>("read_dropped_image", { path });
          const imported = await applyImportedImage(
            {
              name: image.name,
              mime: image.mime,
              size: image.size,
              src: `data:${image.mime};base64,${image.base64}`,
            },
            { x: position.x + index * 24, y: position.y + index * 24 },
            null,
            false,
          );
          if (imported) importedCount += 1;
        } catch (error) {
          const name = path.split(/[\\/]/).at(-1) ?? path;
          onNotify(
            `${name}: ${error instanceof Error ? error.message : "Could not import the dropped image."}`,
            true,
          );
        }
      }
      if (importedCount > 0) {
        onNotify(`${importedCount} image${importedCount === 1 ? "" : "s"} added.`);
      }
    },
    [applyImportedImage, onNotify],
  );

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type !== "drop") return;
        const bounds = surfaceRef.current?.getBoundingClientRect();
        if (!bounds) return;
        const clientX = event.payload.position.x / window.devicePixelRatio;
        const clientY = event.payload.position.y / window.devicePixelRatio;
        if (
          clientX < bounds.left ||
          clientX > bounds.right ||
          clientY < bounds.top ||
          clientY > bounds.bottom
        ) {
          return;
        }
        void handleDroppedImagePaths(
          event.payload.paths,
          getWorldPositionFromClient(clientX, clientY),
        );
      })
      .then((stopListening) => {
        unlisten = stopListening;
      })
      .catch((error: unknown) => {
        onNotify(
          error instanceof Error
            ? error.message
            : "Could not listen for dropped image files.",
          true,
        );
      });
    return () => unlisten?.();
  }, [getWorldPositionFromClient, handleDroppedImagePaths, onNotify]);

  const finishDrawing = useCallback(
    (draft: ShapeDraft, end: CanvasPoint) => {
      const deltaX = end.x - draft.start.x;
      const deltaY = end.y - draft.start.y;
      const dragged = Math.max(Math.abs(deltaX), Math.abs(deltaY)) >= 3;
      let bounds: { width: number; height: number; points?: number[] } | undefined;
      let position = draft.start;

      if (dragged) {
        const width = Math.max(1, Math.abs(deltaX));
        const height = Math.max(1, Math.abs(deltaY));
        position = {
          x: Math.min(draft.start.x, end.x),
          y: Math.min(draft.start.y, end.y),
        };
        bounds = { width, height };
        if (draft.tool === "line" || draft.tool === "arrow") {
          bounds.points = [
            deltaX < 0 ? width : 0,
            deltaY < 0 ? height : 0,
            deltaX < 0 ? 0 : width,
            deltaY < 0 ? 0 : height,
          ];
        }
      }

      createWidgetAt(draft.tool, position, bounds, draft.altKey);
      setShapeDraft(null);
      onToolChange(null);
    },
    [createWidgetAt, onToolChange],
  );

  const handleShapePointerDown = useCallback(
    (event: { evt: MouseEvent | TouchEvent; target: unknown; cancelBubble: boolean }) => {
      const stage = stageRef.current;
      if (!stage) return;
      const position = getPointerWorldPosition();
      if (!position) return;
      lastPointerWorldRef.current = position;
      const tool = activeToolRef.current;
      if (!tool) {
        if (event.target === stage) {
          useStore.getState().clearSelection();
          setSelectionDraft({ start: position, current: position });
        }
        return;
      }
      if (event.evt instanceof MouseEvent && event.evt.button !== 0) return;

      const definition = getShapeDefinition(tool);
      if (!definition) return;
      event.cancelBubble = true;
      setShapeDraft({
        tool,
        start: position,
        current: position,
        altKey: "altKey" in event.evt && Boolean(event.evt.altKey),
        preview: createShapeWidget(tool, position.x, position.y),
      });
    },
    [getPointerWorldPosition],
  );

  const handleShapePointerMove = useCallback(() => {
    const position = getPointerWorldPosition();
    if (!position) return;
    lastPointerWorldRef.current = position;
    setSelectionDraft((draft) => draft ? { ...draft, current: position } : draft);
    setShapeDraft((draft) => {
      if (!draft) return draft;
      const deltaX = position.x - draft.start.x;
      const deltaY = position.y - draft.start.y;
      const width = Math.max(1, Math.abs(deltaX));
      const height = Math.max(1, Math.abs(deltaY));
      const preview = {
        ...draft.preview,
        x: Math.min(draft.start.x, position.x),
        y: Math.min(draft.start.y, position.y),
        width,
        height,
        props:
          draft.tool === "line" || draft.tool === "arrow"
            ? {
                ...draft.preview.props,
                points: [
                  deltaX < 0 ? width : 0,
                  deltaY < 0 ? height : 0,
                  deltaX < 0 ? 0 : width,
                  deltaY < 0 ? 0 : height,
                ],
              }
            : draft.preview.props,
      };
      return { ...draft, current: position, preview };
    });
  }, [getPointerWorldPosition]);

  const handleShapePointerUp = useCallback(() => {
    const draft = shapeDraft;
    const position = getPointerWorldPosition();
    if (draft && position) {
      finishDrawing(draft, position);
      return;
    }
    if (!selectionDraft || !position) return;
    const dx = position.x - selectionDraft.start.x;
    const dy = position.y - selectionDraft.start.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) >= 3) {
      useStore.getState().select(
        getWidgetsInsideBounds(screenWidgets, {
          x: selectionDraft.start.x,
          y: selectionDraft.start.y,
          width: dx,
          height: dy,
        }),
      );
    }
    setSelectionDraft(null);
  }, [finishDrawing, getPointerWorldPosition, screenWidgets, selectionDraft, shapeDraft]);

  const applySelectionOperation = useCallback((operation: SelectionOperation) => {
    const current = useStore.getState();
    const screen = current.project.screens.find(
      (item) => item.id === current.getActiveScreenId(),
    );
    const selected = screen
      ? getEffectiveScreenWidgets(screen, current.activeBreakpointId)
          .filter((widget) => current.selectedIds.includes(widget.id) && !widget.locked)
      : [];
    const updates = getSelectionUpdates(selected, operation);
    commitWidgetGeometry(updates);
  }, []);

  useEffect(() => {
    const shortcuts: Record<string, ShapeTool> = {
      r: "rectangle",
      o: "ellipse",
      t: "text",
      l: "line",
      b: "button",
      i: "input",
      m: "image",
      c: "checkbox",
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || isEditingTarget(event.target)) {
        return;
      }
      if (event.key === "Escape" && activeToolRef.current) {
        onToolChange(null);
        setShapeDraft(null);
        event.preventDefault();
        return;
      }
      if (
        (event.key === "Delete" || event.key === "Backspace") &&
        !activeToolRef.current
      ) {
        const current = useStore.getState();
        if (current.selectedIds.length === 0) return;
        const selected = new Set(
          current.project.screens
            .find((screen) => screen.id === current.getActiveScreenId())
            ?.widgets.filter((widget) => current.selectedIds.includes(widget.id) && !widget.locked)
            .map((widget) => widget.id),
        );
        if (selected.size === 0) return;
        transformerRef.current?.nodes([]);
        contentLayerRef.current?.batchDraw();
        current.setProject({
          ...current.project,
          updatedAt: new Date().toISOString(),
          screens: current.project.screens.map((screen) =>
            screen.id === current.getActiveScreenId()
              ? {
                  ...screen,
                  widgets: screen.widgets.filter((widget) => !selected.has(widget.id)),
                }
              : screen,
          ),
        });
        current.clearSelection();
        event.preventDefault();
        return;
      }
      if (
        !activeToolRef.current &&
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
      ) {
        const current = useStore.getState();
        const screen = current.project.screens.find(
          (item) => item.id === current.getActiveScreenId(),
        );
        const selected = screen
          ? getEffectiveScreenWidgets(screen, current.activeBreakpointId)
              .filter((widget) => current.selectedIds.includes(widget.id) && !widget.locked)
          : [];
        if (selected.length === 0) return;
        const distance = event.shiftKey ? 10 : 1;
        const delta = {
          x: event.key === "ArrowLeft" ? -distance : event.key === "ArrowRight" ? distance : 0,
          y: event.key === "ArrowUp" ? -distance : event.key === "ArrowDown" ? distance : 0,
        };
        commitWidgetGeometry(
          selected.map((widget) => ({
            id: widget.id,
            x: widget.x + delta.x,
            y: widget.y + delta.y,
          })),
        );
        event.preventDefault();
        return;
      }
      const key = event.key.toLowerCase();
      const tool = event.shiftKey
        ? key === "r"
          ? "radio"
          : key === "t"
            ? "toggle"
            : undefined
        : shortcuts[key];
      if (!tool) return;
      event.preventDefault();
      createWidgetAt(tool, lastPointerWorldRef.current);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [createWidgetAt, onToolChange]);

  useEffect(
    () => () => {
      if (guideTimerRef.current !== null) window.clearTimeout(guideTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const nextSize = normalizeCanvasViewport(entry.contentRect);
      setSize((previous) =>
        previous.width === nextSize.width && previous.height === nextSize.height
          ? previous
          : nextSize,
      );
    });

    resizeObserver.observe(surface);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    const setAltHeld = (event: KeyboardEvent) => {
      if (event.key === "Alt") altHeldRef.current = event.type === "keydown";
    };
    const clearAltHeld = () => {
      altHeldRef.current = false;
    };
    window.addEventListener("keydown", setAltHeld);
    window.addEventListener("keyup", setAltHeld);
    window.addEventListener("blur", clearAltHeld);
    return () => {
      window.removeEventListener("keydown", setAltHeld);
      window.removeEventListener("keyup", setAltHeld);
      window.removeEventListener("blur", clearAltHeld);
    };
  }, []);

  useEffect(() => {
    currentViewRef.current = { zoom, pan };
    stageRef.current?.setAttrs({
      x: pan.x,
      y: pan.y,
      scaleX: zoom,
      scaleY: zoom,
    });
    stageRef.current?.batchDraw();
  }, [zoom, pan]);

  useEffect(
    () => () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    const resetSpacePan = () => {
      spacePressedRef.current = false;
      setSpacePressed(false);
      setIsPanning(false);
      panGestureRef.current = null;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || isEditingTarget(event.target)) return;
      event.preventDefault();
      if (event.repeat) return;
      spacePressedRef.current = true;
      setSpacePressed(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      resetSpacePan();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", resetSpacePan);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", resetSpacePan);
    };
  }, []);

  useEffect(() => {
    const onFitShortcut = (event: KeyboardEvent) => {
      if (
        !(event.ctrlKey || event.metaKey) ||
        event.shiftKey ||
        isEditingTarget(event.target)
      ) {
        return;
      }

      const key = event.key;
      if (key !== "0" && key !== "1") return;
      event.preventDefault();

      const store = useStore.getState();
      const screen = store.project.screens.find(
        (item) => item.id === store.getActiveScreenId(),
      );
      const device = screen?.device ?? toScreenDevice(DEFAULT_DEVICE_PRESET);
      const widgets = screen?.widgets ?? [];
      const bounds =
        key === "1"
          ? getWidgetBounds(
              widgets.filter((widget) => store.selectedIds.includes(widget.id)),
            )
          : getWidgetBounds(widgets);
      if (key === "1" && !bounds) return;

      const viewport = size;
      if (viewport.width === 0 || viewport.height === 0) return;
      applyView(
        key === "1" && bounds
          ? fitCanvasBounds(bounds, viewport)
          : fitCanvasBounds(
              getDeviceFrameBounds(
                device,
                findDevicePreset(device.presetId)?.frameChrome?.bezel ?? 0,
                showDeviceFrame,
              ),
              viewport,
              40,
            ),
      );
    };

    window.addEventListener("keydown", onFitShortcut);
    return () => window.removeEventListener("keydown", onFitShortcut);
  }, [applyView, showDeviceFrame, size]);

  const handleWheel = useCallback(
    (event: { evt: WheelEvent; target: { getStage: () => KonvaStage | null } }) => {
      const nativeEvent = event.evt;
      if (!(nativeEvent.ctrlKey || nativeEvent.metaKey)) return;
      nativeEvent.preventDefault();

      const stage = event.target.getStage();
      const pointer = stage?.getPointerPosition();
      if (!pointer) return;

      const currentView = currentViewRef.current;
      const zoomFactor = Math.pow(1.01, -nativeEvent.deltaY);
      applyView(
        zoomAroundPointer(currentView, pointer, currentView.zoom * zoomFactor),
      );
    },
    [applyView],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const isMiddleButton = event.button === 1;
      const isSpaceDrag = event.button === 0 && spacePressedRef.current;
      const targetIsControl =
        event.target instanceof Element &&
        Boolean(
          event.target.closest(
            "button, a, input, textarea, select, [role='button']",
          ),
        );
      if (
        (!isMiddleButton && !isSpaceDrag) ||
        isEditingTarget(event.target) ||
        targetIsControl
      ) {
        return;
      }

      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      panGestureRef.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      };
      setIsPanning(true);
    },
    [],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const gesture = panGestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;

      event.preventDefault();
      const deltaX = event.clientX - gesture.x;
      const deltaY = event.clientY - gesture.y;
      panGestureRef.current = {
        ...gesture,
        x: event.clientX,
        y: event.clientY,
      };
      const currentView = currentViewRef.current;
      applyView({
        zoom: currentView.zoom,
        pan: {
          x: currentView.pan.x + deltaX,
          y: currentView.pan.y + deltaY,
        },
      });
    },
    [applyView],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const gesture = panGestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      panGestureRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      setIsPanning(false);
    },
    [],
  );

  return (
    <div
      ref={surfaceRef}
      className={`canvas-stage-surface${spacePressed ? " is-space-ready" : ""}${isPanning ? " is-panning" : ""}${activeTool ? " is-drawing" : ""}`}
      data-canvas-zoom={zoom}
      data-canvas-pan-x={pan.x}
      data-canvas-pan-y={pan.y}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onLostPointerCapture={handlePointerUp}
      onAuxClick={(event) => {
        if (event.button === 1) event.preventDefault();
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes(LAYER_DRAG_MIME)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = event.ctrlKey || event.metaKey ? "none" : "copy";
          updateCanvasDropFeedback(event);
          return;
        }
        if (!isTauri() && event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
        }
      }}
      onDrop={(event) => {
        if (handleLayerDrop(event)) return;
        clearCanvasDropFeedback();
        if (isTauri() || event.dataTransfer.files.length === 0) return;
        event.preventDefault();
        const position = getWorldPositionFromClient(event.clientX, event.clientY);
        lastPointerWorldRef.current = position;
        void handleImageFile(event.dataTransfer.files[0], position);
      }}
    >
      {canvasDropFeedback && (
        <>
          {(() => {
            const target = screenWidgets.find((widget) => widget.id === canvasDropFeedback.targetId);
            if (!target) return null;
            const position = worldToScreen(target, { zoom, pan });
            return (
              <div
                className="canvas-drop-target"
                data-testid="canvas-drop-target"
                style={{
                  left: position.x,
                  top: position.y,
                  width: target.width * zoom,
                  height: target.height * zoom,
                }}
              />
            );
          })()}
          <div
            className="canvas-drop-insertion"
            aria-hidden="true"
            style={{ left: canvasDropFeedback.x, top: canvasDropFeedback.y }}
          />
          <div
            className="canvas-drop-preview"
            data-testid="canvas-drop-preview"
            style={{ left: canvasDropFeedback.x + 12, top: canvasDropFeedback.y + 12 }}
          >
            <span className="canvas-drop-thumbnail">
              {canvasDropFeedback.itemCount > 1 ? `+${canvasDropFeedback.itemCount}` : <FolderOpen size={18} />}
            </span>
            <span>
              {canvasDropFeedback.targetType &&
              ["group", "frame", "panel", "dynamic-panel", "dynamicPanel", "repeater", "card", "modal", "overlay"].includes(canvasDropFeedback.targetType)
                ? `Add to ${canvasDropFeedback.targetType}`
                : canvasDropFeedback.targetId
                  ? "Replace widget"
                  : `Create ${canvasDropFeedback.label}`}
              {canvasDropFeedback.itemCount > 1 ? ` · ${canvasDropFeedback.itemCount} layers` : ""}
            </span>
          </div>
        </>
      )}
      <input
        ref={imageInputRef}
        className="canvas-image-file-input"
        type="file"
        accept=".png,.jpg,.jpeg,.svg,.webp,image/png,image/jpeg,image/svg+xml,image/webp"
        aria-label="Choose an image file"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          const targetId = imageTargetRef.current;
          imageTargetRef.current = null;
          if (!file) return;
          const target = targetId
            ? screenWidgets.find((widget) => widget.id === targetId)
            : undefined;
          const position = target
            ? { x: target.x, y: target.y }
            : lastPointerWorldRef.current;
          void handleImageFile(file, position, targetId);
        }}
      />
      {size.width > 0 && size.height > 0 && (
        <Stage
          ref={stageRef}
          width={size.width}
          height={size.height}
          x={pan.x}
          y={pan.y}
          scaleX={zoom}
          scaleY={zoom}
          onWheel={handleWheel}
          onMouseDown={handleShapePointerDown}
          onMouseMove={handleShapePointerMove}
          onMouseUp={handleShapePointerUp}
          onTouchStart={handleShapePointerDown}
          onTouchMove={handleShapePointerMove}
          onTouchEnd={handleShapePointerUp}
        >
          <GridLayer
            size={size}
            zoom={zoom}
            pan={pan}
            gridSize={gridSize}
            gridStyle={gridStyle}
            visible={gridVisible}
          />
          <DeviceFrame
            device={activeDevice}
            preset={activeDevicePreset}
            widgets={screenWidgets}
            showFrame={showDeviceFrame}
            showSafeArea={showSafeArea}
            statusBarTheme={statusBarTheme}
            statusBarTimeMode={statusBarTimeMode}
            showBattery={showBattery}
            showSignal={showSignal}
          />
          <Layer
            ref={contentLayerRef}
            clipX={0}
            clipY={0}
            clipWidth={activeDevice.width}
            clipHeight={activeDevice.height}
            perfectDrawEnabled={false}
          >
            {screenWidgets.map((widget) => {
              const snapPosition = (position: CanvasPoint, altKey = altHeldRef.current) =>
                snapWidgetPosition(
                  {
                    id: widget.id,
                    x: position.x,
                    y: position.y,
                    width: widget.width,
                    height: widget.height,
                  },
                  screenWidgets
                    .filter((sibling) => !useStore.getState().selectedIds.includes(sibling.id))
                    .map((sibling) => ({
                      id: sibling.id,
                      x: sibling.x,
                      y: sibling.y,
                      width: sibling.width,
                      height: sibling.height,
                    })),
                  gridSize,
                  snapEnabled,
                  altKey,
                  safeAreaBounds,
                );
              return (
                <WidgetNode
                  key={widget.id}
                  widget={widget}
                  selected={selectedIds.includes(widget.id)}
                  hovered={hoveredWidgetId === widget.id}
                  parentHighlighted={selectedParentWidgetIds.has(widget.id)}
                  zoom={zoom}
                  activeTool={activeTool}
                  position={
                    previewPositions[widget.id] ?? { x: widget.x, y: widget.y }
                  }
                  onEdit={() => beginWidgetTextEdit(widget)}
                  onHover={(hovered) =>
                    useStore.getState().setCanvasHoveredWidget(hovered ? widget.id : null)
                  }
                  onSelect={(event) => {
                    if (widget.locked) return;
                    const selected = useStore.getState().selectedIds;
                    if (event.evt.shiftKey) {
                      useStore.getState().select(
                        selected.includes(widget.id)
                          ? selected.filter((id) => id !== widget.id)
                          : [...selected, widget.id],
                      );
                    } else {
                      useStore.getState().select([widget.id]);
                    }
                  }}
                  onDragStart={() => {
                    let current = useStore.getState();
                    if (!current.selectedIds.includes(widget.id)) {
                      current.select([widget.id]);
                      current = useStore.getState();
                    }
                    const movableIds = current.selectedIds.filter((id) =>
                      current.project.screens
                        .find((screen) => screen.id === current.getActiveScreenId())
                        ?.widgets.some((item) => item.id === id && !item.locked),
                    );
                    if (!movableIds.includes(widget.id)) return;
                    const positions = new Map<string, CanvasPoint>();
                    for (const id of movableIds) {
                      const node = stageRef.current?.findOne(`#${id}`);
                      const item = screenWidgets.find((candidate) => candidate.id === id);
                      if (!item) continue;
                      positions.set(id, node ? { x: node.x(), y: node.y() } : { x: item.x, y: item.y });
                    }
                    dragStartPositionsRef.current = positions;
                    dragPrimaryIdRef.current = widget.id;
                    dragHistorySnapshotRef.current = current.project;
                    current.pushHistory(current.project);
                  }}
                  onDragBound={(position) => {
                    const stageTransform = stageRef.current?.getAbsoluteTransform();
                    if (!stageTransform) return position;
                    const stagePosition = stageTransform
                      .copy()
                      .invert()
                      .point(position);
                    const result = snapPosition(stagePosition);
                    pendingGuidesRef.current = result.guides;
                    return stageTransform.point(result.position);
                  }}
                  onDragMove={(position, altKey) => {
                    const starts = dragStartPositionsRef.current;
                    const primaryStart = starts?.get(widget.id);
                    if (starts && primaryStart && dragPrimaryIdRef.current === widget.id) {
                      const delta = {
                        x: position.x - primaryStart.x,
                        y: position.y - primaryStart.y,
                      };
                      const nextPositions: Record<string, CanvasPoint> = {};
                      for (const [id, start] of starts) {
                        const next = { x: start.x + delta.x, y: start.y + delta.y };
                        nextPositions[id] = next;
                        if (id === widget.id) continue;
                        stageRef.current?.findOne(`#${id}`)?.position(next);
                      }
                      setPreviewPositions(nextPositions);
                    } else {
                      setPreviewPositions((current) => ({
                        ...current,
                        [widget.id]: position,
                      }));
                    }
                    setGuides(altKey ? [] : pendingGuidesRef.current);
                  }}
                  onDragEnd={() => {
                    const starts = dragStartPositionsRef.current;
                    const snapshot = dragHistorySnapshotRef.current ?? undefined;
                    const updates: WidgetGeometryUpdate[] = [];
                    if (starts) {
                      for (const id of starts.keys()) {
                        const node = stageRef.current?.findOne(`#${id}`);
                        if (node) updates.push({ id, x: node.x(), y: node.y() });
                      }
                    }
                    commitWidgetGeometry(updates, snapshot);
                    dragStartPositionsRef.current = null;
                    dragPrimaryIdRef.current = null;
                    dragHistorySnapshotRef.current = null;
                    setPreviewPositions({});
                    setGuides([]);
                  }}
                />
              );
            })}
            <Transformer
              ref={transformerRef}
              enabledAnchors={[
                "top-left",
                "top-center",
                "top-right",
                "middle-left",
                "middle-right",
                "bottom-left",
                "bottom-center",
                "bottom-right",
              ]}
              rotateEnabled
              rotateAnchorOffset={30}
              rotationSnapTolerance={5}
              keepRatio={false}
              shiftBehavior="default"
              anchorSize={7}
              anchorCornerRadius={2}
              anchorFill="#ffffff"
              anchorStroke="#9a7cf4"
              anchorStrokeWidth={1}
              borderStroke="#9a7cf4"
              borderStrokeWidth={1}
              boundBoxFunc={(oldBox, newBox) =>
                constrainTransformerBounds(oldBox, newBox) === oldBox
                  ? oldBox
                  : newBox
              }
              onTransformStart={() => {
                const current = useStore.getState();
                current.clearGeometryPreview();
                transformHistorySnapshotRef.current = current.project;
                current.pushHistory(current.project);
              }}
              onTransform={() => {
                const current = useStore.getState();
                const screen = current.project.screens.find(
                  (item) => item.id === current.getActiveScreenId(),
                );
                const widgets = screen
                  ? getEffectiveScreenWidgets(screen, current.activeBreakpointId).filter(
                      (item) =>
                        current.selectedIds.includes(item.id) &&
                        !item.locked &&
                        item.visible,
                    )
                  : [];
                const preview: Record<
                  string,
                  Pick<Widget, "x" | "y" | "width" | "height" | "rotation">
                > = {};
                for (const item of widgets) {
                  const node = stageRef.current?.findOne(`#${item.id}`);
                  if (!node) continue;
                  preview[item.id] = {
                    x: node.x(),
                    y: node.y(),
                    width: Math.max(4, item.width * Math.abs(node.scaleX())),
                    height: Math.max(4, item.height * Math.abs(node.scaleY())),
                    rotation: node.rotation(),
                  };
                }
                current.setGeometryPreview(preview);
              }}
              onTransformEnd={() => {
                const snapshot = transformHistorySnapshotRef.current ?? undefined;
                const current = useStore.getState();
                const screen = current.project.screens.find(
                  (item) => item.id === current.getActiveScreenId(),
                );
                const selected = screen
                  ? getEffectiveScreenWidgets(screen, current.activeBreakpointId).filter(
                    (item) => current.selectedIds.includes(item.id) && !item.locked && item.visible,
                  )
                  : [];
                const updates: WidgetGeometryUpdate[] = [];
                for (const item of selected) {
                  const node = stageRef.current?.findOne(`#${item.id}`);
                  if (!node) continue;
                  const scaleX = node.scaleX();
                  const scaleY = node.scaleY();
                  updates.push({
                    id: item.id,
                    x: node.x(),
                    y: node.y(),
                    width: Math.max(4, item.width * Math.abs(scaleX)),
                    height: Math.max(4, item.height * Math.abs(scaleY)),
                    rotation: node.rotation(),
                  });
                  node.scale({ x: 1, y: 1 });
                }
                commitWidgetGeometry(updates, snapshot);
                current.clearGeometryPreview();
                transformHistorySnapshotRef.current = null;
              }}
              perfectDrawEnabled={false}
            />
          </Layer>
          {selectionDraft && (
            <Layer listening={false} perfectDrawEnabled={false}>
              <Rect
                x={Math.min(selectionDraft.start.x, selectionDraft.current.x)}
                y={Math.min(selectionDraft.start.y, selectionDraft.current.y)}
                width={Math.abs(selectionDraft.current.x - selectionDraft.start.x)}
                height={Math.abs(selectionDraft.current.y - selectionDraft.start.y)}
                fill="#9a7cf4"
                opacity={0.12}
                stroke="#a98df5"
                strokeWidth={1 / zoom}
                listening={false}
                perfectDrawEnabled={false}
              />
            </Layer>
          )}
          {shapeDraft && (
            <Layer listening={false} perfectDrawEnabled={false}>
              <Group
                x={shapeDraft.preview.x}
                y={shapeDraft.preview.y}
                opacity={0.55}
                listening={false}
              >
                {renderWidgetShape(shapeDraft.preview, false)}
              </Group>
            </Layer>
          )}
          <GuideLayer guides={guides} size={size} zoom={zoom} pan={pan} />
        </Stage>
      )}
      {(widgetsOutsideBreakpointViewport.length > 0 ||
        widgetsOutsideSafeArea.length > 0 ||
        widgetsMissingBreakpointOverrides.length > 0) && (
        <div className="canvas-warnings" aria-live="polite">
          {widgetsOutsideBreakpointViewport.length > 0 && (
            <div className="responsive-viewport-warning" role="status">
              {widgetsOutsideBreakpointViewport.length}{" "}
              {widgetsOutsideBreakpointViewport.length === 1 ? "widget overflows" : "widgets overflow"} the {activeBreakpoint?.name} viewport
            </div>
          )}
          {widgetsOutsideSafeArea.length > 0 && (
            <div className="device-safe-area-warning" role="status">
              {widgetsOutsideSafeArea.length}{" "}
              {widgetsOutsideSafeArea.length === 1 ? "widget is" : "widgets are"} outside the safe area
            </div>
          )}
          {widgetsMissingBreakpointOverrides.length > 0 && (
            <div className="responsive-override-warning" role="status">
              {widgetsMissingBreakpointOverrides.length} important{" "}
              {widgetsMissingBreakpointOverrides.length === 1 ? "widget needs" : "widgets need"} an override at {activeBreakpoint?.name}
            </div>
          )}
        </div>
      )}
      {selectionBounds && selectedWidgets.length > 1 && (
        <div
          className="selection-actions"
          role="toolbar"
          aria-label="Selection alignment tools"
          style={{
            left: Math.max(12, Math.min(size.width - 12, pan.x + (selectionBounds.x + selectionBounds.width / 2) * zoom)),
            top: Math.max(8, pan.y + selectionBounds.y * zoom - 46),
          }}
        >
          {([
            ["align-left", "Align left", "L"],
            ["align-center", "Align horizontal centers", "C"],
            ["align-right", "Align right", "R"],
            ["align-top", "Align top", "T"],
            ["align-middle", "Align vertical centers", "M"],
            ["align-bottom", "Align bottom", "B"],
            ["distribute-horizontal", "Distribute horizontally", "↔"],
            ["distribute-vertical", "Distribute vertically", "↕"],
            ["match-width", "Match width", "W"],
            ["match-height", "Match height", "H"],
          ] as const).map(([operation, title, label]) => (
            <button
              key={operation}
              className="selection-action"
              type="button"
              aria-label={title}
              title={title}
              disabled={
                selectedWidgets.filter((widget) => !widget.locked).length < 2 ||
                (operation.startsWith("distribute-") &&
                  selectedWidgets.filter((widget) => !widget.locked).length < 3)
              }
              onClick={() => applySelectionOperation(operation)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {screenWidgets.length === 0 && !showDeviceFrame && (
        <div className="canvas-empty-state">
          <div className="empty-icon-wrap"><span className="empty-canvas-mark">PF</span></div>
          <span className="eyebrow">YOUR CANVAS IS READY</span>
          <h1>A little room to think.</h1>
          <p>Choose a shape tool above to start your prototype, or open an existing project.</p>
          <div className="canvas-empty-actions">
            <button className="button button-primary" onClick={onSaveAs}><ArrowDownToLine size={15} /> Save your project</button>
            <button className="button button-secondary" onClick={onOpen}><FolderOpen size={15} /> Open a project</button>
          </div>
          <div className="empty-shortcut"><span>Press</span> <button className="shortcut-link" onClick={onOpenPalette}>Ctrl K</button> <span>to see all actions</span></div>
        </div>
      )}
      {editing && (() => {
        const widget = screenWidgets.find((item) => item.id === editing.widgetId);
        if (!widget) return null;
        const toggleLabel = widget.type === "toggle" && editing.key === "label";
        const screenPosition = worldToScreen(
          { x: widget.x + (toggleLabel ? widget.width + 10 : 0), y: widget.y },
          { zoom, pan },
        );
        const left = screenPosition.x;
        const top = screenPosition.y;
        const width = Math.max(80, widget.width * zoom * (toggleLabel ? 1 : 1));
        const height = Math.max(28, widget.height * zoom);
        return (
          <textarea
            className="canvas-inline-editor"
            aria-label={`Edit ${widget.type} text`}
            style={{
              left,
              top,
              width,
              height,
              transform: `rotate(${widget.rotation}deg)`,
              fontFamily: typeof widget.props.fontFamily === "string" ? widget.props.fontFamily : "Arial",
              fontSize: `${(typeof widget.props.fontSize === "number" ? widget.props.fontSize : 14) * zoom}px`,
              lineHeight: String(typeof widget.props.lineHeight === "number" ? widget.props.lineHeight : 1.2),
            }}
            maxLength={MAX_WIDGET_TEXT_LENGTH}
            value={editValue}
            autoFocus
            onChange={(event) => setEditValue(event.currentTarget.value.slice(0, MAX_WIDGET_TEXT_LENGTH))}
            onMouseDown={(event) => event.stopPropagation()}
            onBlur={() => {
              if (cancelEditRef.current) {
                cancelEditRef.current = false;
                return;
              }
              commitWidgetTextEdit();
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                cancelWidgetTextEdit();
              } else if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                commitWidgetTextEdit();
              }
            }}
          />
        );
      })()}
      <div className="canvas-zoom-controls" role="group" aria-label="Canvas zoom controls">
        <button
          className="icon-button small-icon"
          title="Zoom out"
          aria-label="Zoom out"
          disabled={zoom <= 0.1}
          onClick={() =>
            applyView(
              zoomAroundPointer(
                currentViewRef.current,
                { x: size.width / 2, y: size.height / 2 },
                zoom - 0.1,
              ),
            )
          }
        >
          <Minus size={14} />
        </button>
        <span className="canvas-zoom-value" aria-live="polite">
          {Math.round(zoom * 100)}%
        </span>
        <button
          className="icon-button small-icon"
          title="Zoom in"
          aria-label="Zoom in"
          disabled={zoom >= 4}
          onClick={() =>
            applyView(
              zoomAroundPointer(
                currentViewRef.current,
                { x: size.width / 2, y: size.height / 2 },
                zoom + 0.1,
              ),
            )
          }
        >
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
}
