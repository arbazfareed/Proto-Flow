import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent, FormEvent } from "react";
import { Circle, Group, Layer, Line, Rect, Stage, Text, Transformer } from "react-konva";
import type Konva from "konva";
import {
  ArrowDownToLine,
  FolderOpen,
  Hand,
  Link2,
  LoaderCircle,
  Maximize2,
  Minus,
  Plus,
  X,
} from "lucide-react";
import type { Stage as KonvaStage } from "konva/lib/Stage";
import type { Layer as KonvaLayer } from "konva/lib/Layer";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useStore } from "../store";
import { getAutoLayoutPositions } from "../project/widgetLayout";
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
  getWidgetViewportOverflow,
  getWidgetsOutsideSafeArea,
} from "../devices/frame";
import type { ScreenDevice } from "../devices/types";
import type { SymbolDefinition, Widget, Project, Screen } from "../project/schema";
import {
  collectWidgetsDeep,
  addWidgetsToPanelState,
  flattenActivePanelWidgets,
  flattenRepeaterTemplateWidgets,
  getPanelStates,
  mapWidgetsDeep,
  mergeActivePanelWidgets,
} from "../project/dynamicPanels";
import { mergeActiveRepeaterWidgets } from "../project/repeaters";
import {
  clearExpressionCache,
  evaluateExpression,
  EXPRESSION_FUNCTIONS,
} from "../project/expressions";
import { getRepeaterDataset } from "../project/repeaters";
import {
  createDraggedWidgetCopies,
  getActiveLayerDragPayload,
  LAYER_DRAG_MIME,
  parseLayerDragPayload,
} from "../project/layerDrag";
import {
  ELEMENT_DRAG_MIME,
  OPEN_IMAGE_URL_EVENT,
  parseElementDragPayload,
} from "./elementDrag";
import {
  getSelectedContainingParentId,
  isWidgetContainedBy,
  isWidgetContainer,
  syncWidgetGroupIdsToContainment,
} from "../project/layers";
import {
  copyWidgetStyle,
  copyWidgetsToClipboard,
  createWidgetCopies,
  getCopiedWidgetStyle,
  pasteWidgetStyle,
  readWidgetClipboard,
  reorderWidgetSelection,
} from "../project/widgetClipboard";
import {
  createSymbolDefinition,
  createSymbolInstance,
  expandSymbolInstance,
  replaceWidgetsWithSymbolInstance,
  swapSymbolReference,
} from "../project/symbols";
import { getLayerAccentColor } from "../layout/layerGrouping";
import { SymbolNameDialog } from "../layout/SymbolNameDialog";
import {
  clampCanvasZoom,
  fitCanvasBounds,
  getVisibleGridSpacing,
  getWidgetBounds,
  normalizeCanvasViewport,
  worldToScreen,
  zoomAroundPointer,
  getCanvasViewportBounds,
  intersectsCanvasViewport,
} from "./navigation";
import { snapWidgetPosition, type CanvasGuide, type CanvasPoint } from "./snapping";
import {
  createShapeWidget,
  getShapeDefinition,
  measureTextBounds,
  MAX_WIDGET_TEXT_LENGTH,
  renderWidgetShape,
  type ShapeTool,
} from "./shapes";
import { RichTextEditor } from "./RichTextEditor";
import { richTextRunsToPlainText } from "../project/richText";
import { normalizeListItems } from "./styleInspector";
import { getShapeToolDefinition } from "./shapeTools";
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
  readImageUrl,
  type ImportedImage,
} from "./images";
import { getVariableCompletions } from "../project/variables";

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
  elementTool?: ShapeTool;
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

function getCanvasWidgets(screen: Screen, repeaterId: string | null = null): Widget[] {
  const widgets = flattenActivePanelWidgets(screen.widgets);
  if (!repeaterId) return widgets;
  const repeater = collectWidgetsDeep(widgets).find((widget) =>
    widget.id === repeaterId && widget.type === "repeater",
  );
  return repeater
    ? [...widgets, ...flattenRepeaterTemplateWidgets(repeater, repeater.x, repeater.y)]
    : widgets;
}

function getEffectiveScreenWidgets(
  screen: Screen,
  breakpointId: string | null,
  repeaterId: string | null = null,
): Widget[] {
  const breakpoint = resolveActiveBreakpoint(screen, breakpointId);
  return resolveWidgetsForBreakpoint(
    getCanvasWidgets(screen, repeaterId),
    breakpoint,
    screen.device?.width ?? DEFAULT_DEVICE_PRESET.viewport.width,
    screen.device?.height ?? DEFAULT_DEVICE_PRESET.viewport.height,
    screen.compactLayout,
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
    ? getEffectiveScreenWidgets(activeScreen, overrideBreakpointId, current.activeRepeaterEdit)
    : [];
  const project: Project = {
    ...current.project,
    updatedAt: new Date().toISOString(),
    screens: current.project.screens.map((screen) => {
      if (screen.id !== screenId) return screen;
      const effectiveById = new Map(effectiveWidgets.map((widget) => [widget.id, widget]));
      const nextWidgets = mapWidgetsDeep(screen.widgets, (widget) => {
        const update = updateById.get(widget.id);
        const previous = effectiveById.get(widget.id);
        if (!update || !previous) return widget;
        const { id, ...geometry } = update;
        const storedGeometry = current.activeRepeaterEdit &&
          previous?.groupId === current.activeRepeaterEdit
          ? {
              ...geometry,
              x: geometry.x === undefined ? undefined : geometry.x - (effectiveById.get(current.activeRepeaterEdit)?.x ?? 0),
              y: geometry.y === undefined ? undefined : geometry.y - (effectiveById.get(current.activeRepeaterEdit)?.y ?? 0),
            }
          : geometry;
        if (
          (geometry.x === undefined || geometry.x === previous.x) &&
          (geometry.y === undefined || geometry.y === previous.y) &&
          (geometry.width === undefined || geometry.width === previous.width) &&
          (geometry.height === undefined || geometry.height === previous.height) &&
          (geometry.rotation === undefined || geometry.rotation === previous.rotation)
        ) return widget;
        return overrideBreakpointId
          ? updateWidgetOverride(widget, overrideBreakpointId, storedGeometry)
          : { ...widget, ...storedGeometry };
      });
      const updatedEffectiveWidgets = syncWidgetGroupIdsToContainment(
        getEffectiveScreenWidgets({ ...screen, widgets: nextWidgets }, overrideBreakpointId),
      );
      const groupIdById = new Map(updatedEffectiveWidgets.map((widget) => [widget.id, widget.groupId]));
      return {
        ...screen,
        breakpoints: overrideBreakpointId
          ? screen.breakpoints ?? [...getScreenBreakpoints(screen)]
          : screen.breakpoints,
        widgets: mapWidgetsDeep(nextWidgets, (widget) => {
          if (!groupIdById.has(widget.id)) return widget;
          const groupId = groupIdById.get(widget.id);
          return widget.groupId === groupId ? widget : { ...widget, groupId };
        }),
      };
    }),
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
  const zoomBucket = Math.pow(2, Math.round(Math.log2(zoom) * 4) / 4);
  const [pattern, setPattern] = useState<{ image: HTMLImageElement; scale: number } | null>(null);
  useEffect(() => {
    const pixelRatio = window.devicePixelRatio || 1;
    const tile = document.createElement("canvas");
    tile.width = Math.max(1, Math.ceil(spacing * pixelRatio));
    tile.height = tile.width;
    const context = tile.getContext("2d");
    if (!context) {
      console.error("Could not create the canvas grid pattern.");
      setPattern(null);
      return;
    }
    context.scale(pixelRatio, pixelRatio);
    context.strokeStyle = "#34353b";
    context.fillStyle = "#34353b";
    if (gridStyle === "dots") {
      context.beginPath();
      context.arc(spacing / 2, spacing / 2, 0.65 / zoomBucket, 0, Math.PI * 2);
      context.fill();
    } else {
      context.lineWidth = 0.45 / zoomBucket;
      context.beginPath();
      context.moveTo(0, 0);
      context.lineTo(0, spacing);
      context.moveTo(0, 0);
      context.lineTo(spacing, 0);
      context.stroke();
    }
    const image = new Image();
    image.onload = () => setPattern({ image, scale: 1 / pixelRatio });
    image.onerror = () => {
      console.error("Could not load the canvas grid pattern.");
      setPattern(null);
    };
    image.src = tile.toDataURL();
    return () => {
      image.onload = null;
      image.onerror = null;
    };
  }, [gridStyle, spacing, zoomBucket]);

  return (
    <Layer listening={false} perfectDrawEnabled={false}>
      <Rect
        x={left}
        y={top}
        width={right - left}
        height={bottom - top}
        fillPatternImage={pattern?.image}
        fillPatternRepeat="repeat"
        fillPatternScaleX={pattern?.scale}
        fillPatternScaleY={pattern?.scale}
        fillPatternOffsetX={-(((left % spacing) + spacing) % spacing)}
        fillPatternOffsetY={-(((top % spacing) + spacing) % spacing)}
        perfectDrawEnabled={false}
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

function CanvasPerformanceOverlay({
  nodeCount,
  culledNodeCount,
  activePanelCount,
  repeaterRowCount,
}: {
  nodeCount: number;
  culledNodeCount: number;
  activePanelCount: number;
  repeaterRowCount: number;
}) {
  const [frame, setFrame] = useState({ fps: 0, frameTime: 0 });

  useEffect(() => {
    let animationFrame = 0;
    let previousFrameTime = performance.now();
    let intervalStart = previousFrameTime;
    let intervalFrames = 0;
    const measure = (timestamp: number) => {
      intervalFrames += 1;
      const frameTime = timestamp - previousFrameTime;
      previousFrameTime = timestamp;
      if (timestamp - intervalStart >= 500) {
        setFrame({
          fps: (intervalFrames * 1000) / (timestamp - intervalStart),
          frameTime,
        });
        intervalFrames = 0;
        intervalStart = timestamp;
      }
      animationFrame = window.requestAnimationFrame(measure);
    };
    animationFrame = window.requestAnimationFrame(measure);
    return () => window.cancelAnimationFrame(animationFrame);
  }, []);

  return (
    <output className="canvas-performance-overlay" data-testid="canvas-performance-overlay">
      <span>{frame.fps.toFixed(0)} FPS</span>
      <span>{frame.frameTime.toFixed(1)} ms</span>
      <span>{nodeCount} nodes</span>
      <span>{culledNodeCount} culled</span>
      <span>{activePanelCount} panels</span>
      <span>{repeaterRowCount} repeater rows</span>
    </output>
  );
}

function WidgetNode({
  widget,
  selected,
  hovered,
  hoverAccent,
  overflowed,
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
  onContextMenu,
  symbolDefinition,
}: {
  widget: Widget;
  selected: boolean;
  hovered: boolean;
  hoverAccent: string;
  overflowed: boolean;
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
  onContextMenu: (event: Konva.KonvaEventObject<MouseEvent>) => void;
  symbolDefinition?: SymbolDefinition;
}) {
  const noteTooltipText = widget.notes?.description.slice(0, 100) ||
    widget.notes?.requirementId ||
    widget.notes?.tags.join(", ") ||
    "";
  const noteTooltipWidth = Math.min(
    260 / zoom,
    Math.max(140 / zoom, noteTooltipText.length * 6 / zoom + 12 / zoom),
  );
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
      onContextMenu={onContextMenu}
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
      {symbolDefinition ? (
        <>
          <Rect
            width={widget.width}
            height={widget.height}
            fill="#000000"
            opacity={0.001}
            stroke="#a78bfa"
            strokeWidth={1 / zoom}
            perfectDrawEnabled={false}
          />
          <Group
            scaleX={widget.width / symbolDefinition.width}
            scaleY={widget.height / symbolDefinition.height}
            listening={false}
          >
            {symbolDefinition.widgets
              .slice()
              .sort((first, second) => first.zIndex - second.zIndex)
              .map((masterWidget) => {
                const symbolOverrides = widget.props.symbolOverrides;
                const overrides: Record<string, unknown> =
                  typeof symbolOverrides === "object" && symbolOverrides !== null &&
                    !Array.isArray(symbolOverrides)
                    ? symbolOverrides as Record<string, unknown>
                    : {};
                const override = overrides[masterWidget.id];
                const overrideRecord: Record<string, unknown> =
                  typeof override === "object" && override !== null && !Array.isArray(override)
                    ? override as Record<string, unknown>
                    : {};
                const overrideProps: Record<string, unknown> =
                  typeof overrideRecord.props === "object" && overrideRecord.props !== null &&
                    !Array.isArray(overrideRecord.props)
                    ? overrideRecord.props as Record<string, unknown>
                    : {};
                const overrideStyle: Record<string, unknown> =
                  typeof overrideRecord.style === "object" && overrideRecord.style !== null &&
                    !Array.isArray(overrideRecord.style)
                    ? overrideRecord.style as Record<string, unknown>
                    : {};
                const renderedWidget =
                  Object.keys(overrideProps).length > 0 || Object.keys(overrideStyle).length > 0
                  ? {
                      ...masterWidget,
                      props: { ...masterWidget.props, ...overrideProps },
                      style: { ...masterWidget.style, ...overrideStyle },
                    }
                  : masterWidget;
                return (
                  <Group
                    key={masterWidget.id}
                    x={masterWidget.x}
                    y={masterWidget.y}
                    rotation={masterWidget.rotation}
                    opacity={masterWidget.opacity}
                    visible={masterWidget.visible}
                    listening={false}
                  >
                    {renderWidgetShape(renderedWidget, false)}
                  </Group>
                );
              })}
          </Group>
        </>
      ) : renderWidgetShape(widget, selected)}
      {(selected || hovered || parentHighlighted) && (
        <Rect
          x={-2 / zoom}
          y={-2 / zoom}
          width={widget.width + 4 / zoom}
          height={widget.height + 4 / zoom}
          fillEnabled={false}
          stroke={hovered ? overflowed ? "#ef4444" : hoverAccent : selected ? "#bba5ff" : parentHighlighted ? "#63cf9c" : "#68a7ff"}
          strokeWidth={1 / zoom}
          dash={selected || hovered ? undefined : [4 / zoom, 3 / zoom]}
          listening={false}
          perfectDrawEnabled={false}
        />
      )}
      {widget.notes && (
        <Group listening={false}>
          <Circle
            x={widget.width - 9 / zoom}
            y={-9 / zoom}
            radius={9 / zoom}
            fill={{
              low: "#7196e8",
              medium: "#d5a446",
              high: "#e57945",
              critical: "#e04f59",
            }[widget.notes.priority]}
            stroke="#17181b"
            strokeWidth={1 / zoom}
            perfectDrawEnabled={false}
          />
          <Text
            x={widget.width - 13 / zoom}
            y={-13 / zoom}
            width={8 / zoom}
            height={8 / zoom}
            text="N"
            fontSize={7 / zoom}
            fontStyle="bold"
            fill="#ffffff"
            align="center"
            verticalAlign="middle"
            perfectDrawEnabled={false}
          />
        </Group>
      )}
      {widget.notes && hovered && (
        <Group listening={false} y={widget.height + 5 / zoom}>
          <Rect
            width={noteTooltipWidth}
            height={28 / zoom}
            cornerRadius={4 / zoom}
            fill="#24232b"
            stroke="#7664a7"
            strokeWidth={1 / zoom}
            perfectDrawEnabled={false}
          />
          <Text
            x={6 / zoom}
            y={5 / zoom}
            width={(noteTooltipWidth * zoom - 12) / zoom}
            height={18 / zoom}
            text={noteTooltipText}
            fontSize={10 / zoom}
            fill="#f2eff8"
            ellipsis
            wrap="none"
            perfectDrawEnabled={false}
          />
        </Group>
      )}
    </Group>
  );
}

type EditableWidgetText = {
  key: "text" | "label" | "placeholder" | "value" | "items";
  value: string;
};

function getEditableWidgetText(widget: Widget): EditableWidgetText | null {
  const keys = widget.type === "list"
    ? ["items"]
    : ["text", "heading", "paragraph", "link", "label"].includes(widget.type)
      ? ["text"]
      : widget.type === "input"
        ? [widget.props.value ? "value" : "placeholder"]
        : ["button", "checkbox", "radio", "toggle"].includes(widget.type)
          ? ["label"]
          : [];
  const key = keys[0] as EditableWidgetText["key"] | undefined;
  if (!key) return null;
  if (key === "items") {
    return { key, value: normalizeListItems(widget.props.items).join("\n") };
  }
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
            widgets: screen.widgets.map((widget) => {
              if (widget.id !== widgetId) return widget;
              const props: Record<string, unknown> = {
                ...widget.props,
                ...patch,
                ...(patch.items !== undefined
                  ? { items: normalizeListItems(patch.items) }
                  : {}),
              };
              const text = widget.type === "list"
                ? normalizeListItems(props.items).join("\n")
                : typeof props.text === "string" ? props.text : "";
              const measured = props.autoSize === true
                ? measureTextBounds(
                    text,
                    typeof props.fontFamily === "string" ? props.fontFamily : "Arial",
                    typeof props.fontSize === "number" ? props.fontSize : 24,
                    typeof props.fontWeight === "string" ? props.fontWeight : "normal",
                    typeof props.lineHeight === "number" ? props.lineHeight : 1.2,
                  )
                : null;
              const widgetPatch = {
                props,
                ...(measured ? { width: measured.width, height: measured.height } : {}),
              };
              return resolvedOverrideBreakpointId
                ? updateWidgetOverride(widget, resolvedOverrideBreakpointId, widgetPatch)
                : { ...widget, ...widgetPatch };
            }),
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
  const transformerLayerRef = useRef<KonvaLayer>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const textEditorRef = useRef<HTMLTextAreaElement>(null);
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
  const [panMode, setPanMode] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [previewPositions, setPreviewPositions] = useState<Record<string, CanvasPoint>>({});
  const [guides, setGuides] = useState<CanvasGuide[]>([]);
  const [shapeDraft, setShapeDraft] = useState<ShapeDraft | null>(null);
  const [selectionDraft, setSelectionDraft] = useState<SelectionDraft | null>(null);
  const [canvasDropFeedback, setCanvasDropFeedback] = useState<CanvasDropFeedback | null>(null);
  const [canvasContextMenu, setCanvasContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [symbolNameDialog, setSymbolNameDialog] = useState<string | null>(null);
  const [symbolTextOverrideDialog, setSymbolTextOverrideDialog] = useState<{
    instance: Widget;
    masterWidget: Widget;
    property: "text" | "label";
  } | null>(null);
  const [imageUrlDialogOpen, setImageUrlDialogOpen] = useState(false);
  const [imageUrlDraft, setImageUrlDraft] = useState("");
  const [imageUrlLoading, setImageUrlLoading] = useState(false);
  const [editing, setEditing] = useState<{
    widgetId: string;
    key: EditableWidgetText["key"];
    value: string;
  } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editCursor, setEditCursor] = useState(0);
  const [variableSuggestionIndex, setVariableSuggestionIndex] = useState(0);
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
  const pasteOffsetRef = useRef(0);
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
  const notesOverlay = useStore((state) => state.notesOverlay);
  const activeScreen = useStore((state) =>
    state.project.screens.find((screen) => screen.id === state.getActiveScreenId()),
  );
  const project = useStore((state) => state.project);
  const symbols = useStore((state) => state.project.symbols);
  const activeBreakpointId = useStore((state) => state.activeBreakpointId);
  const activeRepeaterEdit = useStore((state) => state.activeRepeaterEdit);
  const selectedIds = useStore((state) => state.selectedIds);
  const hoveredWidgetId = useStore((state) => state.hoveredWidgetId);
  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);
  useEffect(() => {
    clearExpressionCache();
    return () => clearExpressionCache();
  }, [project.id]);
  const activeBreakpoint = activeScreen
    ? resolveActiveBreakpoint(activeScreen, activeBreakpointId)
    : undefined;
  const baseScreenWidgets = useMemo(
    () => activeScreen ? getCanvasWidgets(activeScreen, activeRepeaterEdit) : [],
    [activeRepeaterEdit, activeScreen],
  );
  const screenWidgets = useMemo(
    () => activeScreen && activeBreakpoint
      ? resolveWidgetsForBreakpoint(
          baseScreenWidgets,
          activeBreakpoint,
          activeScreen.device?.width ?? DEFAULT_DEVICE_PRESET.viewport.width,
          activeScreen.device?.height ?? DEFAULT_DEVICE_PRESET.viewport.height,
          activeScreen.compactLayout,
        )
      : [...baseScreenWidgets].sort((first, second) => first.zIndex - second.zIndex),
    [activeBreakpoint, activeScreen, baseScreenWidgets],
  );
  const autoLayoutPositions = useMemo(
    () => getAutoLayoutPositions(screenWidgets),
    [screenWidgets],
  );
  const canvasViewportBounds = useMemo(
    () => getCanvasViewportBounds(size, { zoom, pan }),
    [pan, size, zoom],
  );
  const renderableWidgets = useMemo(
    () => screenWidgets.filter((widget) =>
      widget.visible &&
      intersectsCanvasViewport(
        {
          x: previewPositions[widget.id]?.x ?? autoLayoutPositions.get(widget.id)?.x ?? widget.x,
          y: previewPositions[widget.id]?.y ?? autoLayoutPositions.get(widget.id)?.y ?? widget.y,
          width: widget.width,
          height: widget.height,
          rotation: widget.rotation,
        },
        canvasViewportBounds,
      ),
    ),
    [autoLayoutPositions, canvasViewportBounds, previewPositions, screenWidgets],
  );
  const renderableWidgetIds = useMemo(
    () => new Set(renderableWidgets.map((widget) => widget.id)),
    [renderableWidgets],
  );
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
  const activePanelCount = useMemo(
    () => screenWidgets.filter((widget) => widget.type === "dynamic-panel").length,
    [screenWidgets],
  );
  const culledNodeCount = useMemo(
    () => screenWidgets.filter((widget) =>
      widget.visible && !renderableWidgetIds.has(widget.id),
    ).length,
    [renderableWidgetIds, screenWidgets],
  );
  const repeaterRowCount = useMemo(
    () => screenWidgets
      .filter((widget) => widget.type === "repeater")
      .reduce((total, widget) => total + getRepeaterDataset(widget).length, 0),
    [screenWidgets],
  );
  const selectedHasSemanticGroup = selectedWidgets.some(
    (widget) =>
      widget.groupId &&
      !baseScreenWidgets.some((candidate) => candidate.id === widget.groupId),
  );
  const selectedHasUnlockedWidget = selectedWidgets.some((widget) => !widget.locked);
  const selectionBounds = getSelectionBounds(selectedWidgets);

  useEffect(() => {
    const transformer = transformerRef.current;
    const stage = stageRef.current;
    if (!transformer || !stage) return;
    transformer.nodes(
      renderableWidgets
        .filter((widget) => !widget.locked && widget.visible)
        .map((widget) => stage.findOne(`#${widget.id}`))
        .filter((node): node is Konva.Node => node !== undefined),
    );
    contentLayerRef.current?.batchDraw();
    transformerLayerRef.current?.batchDraw();
  }, [renderableWidgets, selectedIds]);

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
      dropParentId?: string | null,
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
      if (widget.type === "dynamic-panel") {
        const initialState = { id: crypto.randomUUID(), name: "State 1", widgets: [] };
        widget.props = { ...widget.props, states: [initialState], activeStateId: initialState.id };
      }
      if (widget.type === "repeater") {
        widget.props = {
          ...widget.props,
          rowTemplate: { widgets: [] },
          dataset: [{ title: "Item 1" }, { title: "Item 2" }, { title: "Item 3" }],
          layout: "vertical",
          gap: 8,
          itemBinding: {},
        };
      }
      if (type === "button" && typeof window !== "undefined") {
        const accent = getComputedStyle(document.documentElement)
          .getPropertyValue("--accent-strong")
          .trim();
        if (/^#[\da-f]{3,8}$/i.test(accent)) {
          widget.style.fill = accent;
          widget.style.stroke = accent;
        }
      }
      const visibleWidgets = getCanvasWidgets(screen, current.activeRepeaterEdit);
      const siblings = visibleWidgets.map((item) => ({
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
      const dropParent = dropParentId
        ? visibleWidgets.find((item) => item.id === dropParentId)
        : undefined;
      if (
        dropParent &&
        isWidgetContainer(dropParent) &&
        isWidgetContainedBy(widget, dropParent)
      ) {
        widget.groupId = dropParent.id;
      } else {
        const selectedParentId = getSelectedContainingParentId(
          visibleWidgets,
          current.selectedIds,
          widget,
        );
        if (selectedParentId) widget.groupId = selectedParentId;
      }
      widget.zIndex = visibleWidgets.reduce(
        (highest, item) => Math.max(highest, item.zIndex),
        -1,
      ) + 1;
      const activePanelEdit = current.activePanelEdit;
      const activeRepeaterEdit = current.activeRepeaterEdit;
      const editStateId = activePanelEdit?.stateId;
      const scopedPanel = activePanelEdit
        ? visibleWidgets.find((item) => item.id === activePanelEdit.panelId)
        : undefined;
      const scopedRepeater = (activeRepeaterEdit
        ? visibleWidgets.find((item) => item.id === activeRepeaterEdit)
        : undefined) ?? visibleWidgets
        .filter((item) => item.type === "repeater" && isWidgetContainedBy(widget, item))
        .sort((first, second) => first.width * first.height - second.width * second.height)[0];
      const nextWidgets = scopedRepeater?.type === "repeater"
        ? mergeActiveRepeaterWidgets(
            screen.widgets,
            [...visibleWidgets, { ...widget, groupId: scopedRepeater.id }],
            scopedRepeater.id,
          )
        : scopedPanel?.type === "dynamic-panel" &&
        editStateId &&
        getPanelStates(scopedPanel).some((state) => state.id === editStateId)
        ? addWidgetsToPanelState(
            screen.widgets,
            scopedPanel.id,
            editStateId,
            [{ ...widget, groupId: scopedPanel.id }],
          )
        : syncWidgetGroupIdsToContainment([...screen.widgets, widget]);

      current.setProject({
        ...current.project,
        updatedAt: new Date().toISOString(),
        screens: current.project.screens.map((item) =>
          item.id === screen.id
            ? { ...item, widgets: nextWidgets }
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

  const importImageFromUrl = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (imageUrlLoading) return;
      setImageUrlLoading(true);
      try {
        const image = await readImageUrl(imageUrlDraft);
        const target = selectedIds.length === 1
          ? screenWidgets.find(
              (widget) => widget.id === selectedIds[0] && widget.type === "image",
            )
          : undefined;
        const position = target
          ? { x: target.x, y: target.y }
          : {
              x: Math.max(0, activeDevice.width / 2 - 100),
              y: Math.max(0, activeDevice.height / 2 - 100),
            };
        const imported = await applyImportedImage(image, position, target?.id ?? null);
        if (imported) {
          setImageUrlDialogOpen(false);
          setImageUrlDraft("");
        }
      } catch (error) {
        onNotify(
          error instanceof Error ? error.message : "Could not import the image URL.",
          true,
        );
      } finally {
        setImageUrlLoading(false);
      }
    },
    [
      activeDevice.height,
      activeDevice.width,
      applyImportedImage,
      imageUrlDraft,
      imageUrlLoading,
      onNotify,
      screenWidgets,
      selectedIds,
    ],
  );

  const handleImageFiles = useCallback(
    async (
      files: File[],
      position: CanvasPoint,
      targetWidgetId: string | null = null,
    ) => {
      for (const [index, file] of files.entries()) {
        try {
          const image = await readImageFile(file);
          await applyImportedImage(
            image,
            {
              x: Math.max(0, Math.min(activeDevice.width - 200, position.x + index * 24)),
              y: Math.max(0, Math.min(activeDevice.height - 200, position.y + index * 24)),
            },
            index === 0 ? targetWidgetId : null,
          );
        } catch (error) {
          onNotify(
            `${file.name}: ${error instanceof Error ? error.message : "Could not load the selected image."}`,
            true,
          );
        }
      }
    },
    [activeDevice.height, activeDevice.width, applyImportedImage, onNotify],
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
      const initialValue = editable.value.slice(0, MAX_WIDGET_TEXT_LENGTH);
      setEditing({ widgetId: widget.id, ...editable });
      setEditValue(initialValue);
      setEditCursor(initialValue.length);
      setVariableSuggestionIndex(0);
    },
    [openImagePicker],
  );

  const commitWidgetTextEdit = useCallback(() => {
    if (!editing) return;
    updateWidgetProps(
      editing.widgetId,
      editing.key === "items"
        ? { items: normalizeListItems(editValue) }
        : { [editing.key]: editValue },
    );
    setEditing(null);
  }, [editValue, editing]);

  const variableCompletion = editing && activeScreen
    ? getVariableCompletions(project, activeScreen.id, editValue, editCursor)
    : null;
  const completionVariables = variableCompletion?.variables ?? [];
  const visibleVariableSuggestions = completionVariables.slice(0, 8);
  const insertVariableSuggestion = (name: string) => {
    if (!variableCompletion) return;
    const insertion = `{{${name}}}`;
    const value = `${editValue.slice(0, variableCompletion.start)}${insertion}${editValue.slice(variableCompletion.end)}`;
    const cursor = variableCompletion.start + insertion.length;
    setEditValue(value);
    setEditCursor(cursor);
    setVariableSuggestionIndex(0);
    requestAnimationFrame(() => {
      textEditorRef.current?.focus();
      textEditorRef.current?.setSelectionRange(cursor, cursor);
    });
  };

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
    const elementTool = event.dataTransfer.types.includes(ELEMENT_DRAG_MIME)
      ? parseElementDragPayload(event.dataTransfer.getData(ELEMENT_DRAG_MIME))
      : null;
    const payload = getActiveLayerDragPayload() ??
      parseLayerDragPayload(event.dataTransfer.getData(LAYER_DRAG_MIME));
    const targetId = getCanvasDropTarget(event.clientX, event.clientY);
    const targetWidget = screenWidgets.find((widget) => widget.id === targetId);
    const nestedElementDrop =
      !!elementTool && !!targetWidget && isWidgetContainer(targetWidget);
    const definition = elementTool ? getShapeToolDefinition(elementTool) : undefined;
    const screenDrop = payload?.kind === "screen";
    pendingDragFeedbackRef.current = {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
      targetId: elementTool && !nestedElementDrop ? null : screenDrop ? null : targetId,
      targetType: screenDrop || (elementTool && !nestedElementDrop)
        ? undefined
        : targetWidget?.type,
      itemCount: elementTool ? 1 : payload?.kind === "widgets" ? payload.widgetIds.length : 1,
      label: definition?.label ?? (payload?.kind === "widgets"
        ? screenWidgets.find((widget) => widget.id === payload.widgetIds[0])?.name ??
          screenWidgets.find((widget) => widget.id === payload.widgetIds[0])?.type ?? "Layer"
        : "Screen"),
      elementTool: elementTool ?? undefined,
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

  const handleElementDrop = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes(ELEMENT_DRAG_MIME)) return false;
    event.preventDefault();
    clearCanvasDropFeedback();
    const tool = parseElementDragPayload(event.dataTransfer.getData(ELEMENT_DRAG_MIME));
    if (!tool) return true;
    const position = getWorldPositionFromClient(event.clientX, event.clientY);
    lastPointerWorldRef.current = position;
    createWidgetAt(
      tool,
      position,
      undefined,
      event.altKey,
      getCanvasDropTarget(event.clientX, event.clientY),
    );
    onToolChange(null);
    return true;
  }, [
    clearCanvasDropFeedback,
    createWidgetAt,
    getCanvasDropTarget,
    getWorldPositionFromClient,
    onToolChange,
  ]);

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
          const binary = atob(image.base64);
          const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
          const importedImage = await readImageFile(
            new File([bytes], image.name, { type: image.mime }),
          );
          const imported = await applyImportedImage(
            importedImage,
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
      ? getEffectiveScreenWidgets(screen, current.activeBreakpointId, current.activeRepeaterEdit)
          .filter((widget) => current.selectedIds.includes(widget.id) && !widget.locked)
      : [];
    const updates = getSelectionUpdates(selected, operation);
    commitWidgetGeometry(updates);
  }, []);

  const updateActiveScreenWidgets = useCallback((widgets: Widget[]) => {
    const current = useStore.getState();
    const screenId = current.getActiveScreenId();
    const activeScreen = current.project.screens.find((screen) => screen.id === screenId);
    if (!activeScreen) return;
    const nextWidgets = current.activeRepeaterEdit
      ? mergeActiveRepeaterWidgets(activeScreen.widgets, widgets, current.activeRepeaterEdit)
      : mergeActivePanelWidgets(activeScreen.widgets, widgets, current.activePanelEdit);
    if (nextWidgets === activeScreen.widgets) return;
    current.setProject({
      ...current.project,
      updatedAt: new Date().toISOString(),
      screens: current.project.screens.map((screen) =>
        screen.id === screenId ? { ...screen, widgets: nextWidgets } : screen,
      ),
    });
  }, []);

  const copySelection = useCallback(async (cut = false) => {
    const current = useStore.getState();
    const screen = current.project.screens.find(
      (item) => item.id === current.getActiveScreenId(),
    );
    if (!screen) return;
    const visibleWidgets = getCanvasWidgets(screen, current.activeRepeaterEdit);
    const selected = visibleWidgets.filter((widget) =>
      current.selectedIds.includes(widget.id) && (!cut || !widget.locked),
    );
    if (selected.length === 0) return;
    try {
      const wroteSystemClipboard = await copyWidgetsToClipboard(selected);
      if (!wroteSystemClipboard) {
        onNotify("Copied layers internally; system clipboard access is unavailable.");
      }
    } catch (error) {
      console.error("Could not write ProtoFlow widgets to the system clipboard.", error);
      onNotify("Copied layers internally, but the system clipboard could not be updated.", true);
    }
    if (cut) {
      const ids = new Set(selected.map((widget) => widget.id));
      updateActiveScreenWidgets(visibleWidgets.filter((widget) => !ids.has(widget.id)));
      current.clearSelection();
    }
  }, [onNotify, updateActiveScreenWidgets]);

  const copyStyleSelection = useCallback(() => {
    const current = useStore.getState();
    const screen = current.project.screens.find(
      (item) => item.id === current.getActiveScreenId(),
    );
    const selected = screen ? getCanvasWidgets(screen, current.activeRepeaterEdit).filter((widget) =>
      current.selectedIds.includes(widget.id),
    ) : [];
    if (selected.length !== 1) return;
    copyWidgetStyle(selected[0]);
    onNotify("Style copied. Select one or more widgets and paste the style.");
  }, [onNotify]);

  const pasteStyleSelection = useCallback(() => {
    const copiedStyle = getCopiedWidgetStyle();
    if (!copiedStyle) return;
    const current = useStore.getState();
    const screen = current.project.screens.find(
      (item) => item.id === current.getActiveScreenId(),
    );
    if (!screen) return;
    const visibleWidgets = getCanvasWidgets(screen, current.activeRepeaterEdit);
    const selected = visibleWidgets.filter((widget) =>
      current.selectedIds.includes(widget.id),
    );
    if (selected.length === 0) return;
    const updated = new Map(
      pasteWidgetStyle(copiedStyle, selected).map((widget) => [widget.id, widget]),
    );
    updateActiveScreenWidgets(visibleWidgets.map((widget) => updated.get(widget.id) ?? widget));
  }, [updateActiveScreenWidgets]);

  const pasteSelection = useCallback(async () => {
    try {
      const source = await readWidgetClipboard();
      const current = useStore.getState();
      const screenId = current.getActiveScreenId();
      const screen = current.project.screens.find((item) => item.id === screenId);
      if (!screen) return;
      pasteOffsetRef.current += 20;
      const copies = createWidgetCopies(
        source,
        current.project.screens.flatMap((item) => item.widgets),
        { x: pasteOffsetRef.current, y: pasteOffsetRef.current },
      );
      updateActiveScreenWidgets([...getCanvasWidgets(screen, current.activeRepeaterEdit), ...copies]);
      current.select(copies.map((widget) => widget.id));
    } catch (error) {
      console.error("Could not paste ProtoFlow widgets.", error);
      onNotify(error instanceof Error ? error.message : "Could not paste layers.", true);
    }
  }, [onNotify, updateActiveScreenWidgets]);

  const duplicateSelection = useCallback(() => {
    const current = useStore.getState();
    const screen = current.project.screens.find(
      (item) => item.id === current.getActiveScreenId(),
    );
    if (!screen) return;
    const visibleWidgets = getCanvasWidgets(screen, current.activeRepeaterEdit);
    const selected = visibleWidgets.filter((widget) =>
      current.selectedIds.includes(widget.id),
    );
    if (selected.length === 0) return;
    const copies = createWidgetCopies(
      selected,
      current.project.screens.flatMap((item) => item.widgets),
      { x: 20, y: 20 },
    );
    updateActiveScreenWidgets([...visibleWidgets, ...copies]);
    current.select(copies.map((widget) => widget.id));
  }, [updateActiveScreenWidgets]);

  const deleteSelection = useCallback(() => {
    const current = useStore.getState();
    const screen = current.project.screens.find(
      (item) => item.id === current.getActiveScreenId(),
    );
    if (!screen || current.selectedIds.length === 0) return;
    const deletable = new Set(
      getCanvasWidgets(screen, current.activeRepeaterEdit)
        .filter((widget) => current.selectedIds.includes(widget.id) && !widget.locked)
        .map((widget) => widget.id),
    );
    if (deletable.size === 0) return;
    transformerRef.current?.nodes([]);
    contentLayerRef.current?.batchDraw();
    updateActiveScreenWidgets(getCanvasWidgets(screen, current.activeRepeaterEdit).filter((widget) => !deletable.has(widget.id)));
    current.clearSelection();
  }, [updateActiveScreenWidgets]);

  const changeSelectionZOrder = useCallback((
    action: "forward" | "backward" | "front" | "back",
  ) => {
    const current = useStore.getState();
    const screen = current.project.screens.find(
      (item) => item.id === current.getActiveScreenId(),
    );
    if (!screen) return;
    updateActiveScreenWidgets(
      reorderWidgetSelection(getCanvasWidgets(screen, current.activeRepeaterEdit), current.selectedIds, action),
    );
  }, [updateActiveScreenWidgets]);

  const toggleSelectionLock = useCallback(() => {
    const current = useStore.getState();
    const selected = new Set(current.selectedIds);
    const screen = current.project.screens.find(
      (item) => item.id === current.getActiveScreenId(),
    );
    if (!screen || selected.size === 0) return;
    const visibleWidgets = getCanvasWidgets(screen, current.activeRepeaterEdit);
    const lock = !visibleWidgets
      .filter((widget) => selected.has(widget.id))
      .every((widget) => widget.locked);
    updateActiveScreenWidgets(visibleWidgets.map((widget) =>
      selected.has(widget.id) ? { ...widget, locked: lock } : widget,
    ));
  }, [updateActiveScreenWidgets]);

  const groupSelection = useCallback((ungroup = false) => {
    const current = useStore.getState();
    const selected = new Set(current.selectedIds);
    const screen = current.project.screens.find(
      (item) => item.id === current.getActiveScreenId(),
    );
    if (!screen || selected.size === 0) return;
    if (ungroup) {
      const visibleWidgets = getCanvasWidgets(screen, current.activeRepeaterEdit);
      const groupIds = new Set(visibleWidgets
        .filter((widget) => selected.has(widget.id) && widget.groupId)
        .map((widget) => widget.groupId!));
      updateActiveScreenWidgets(visibleWidgets.map((widget) => {
        if (selected.has(widget.id) && widget.groupId && groupIds.has(widget.groupId)) {
          const { groupId: _groupId, ...rest } = widget;
          return rest;
        }
        return widget;
      }));
      return;
    }
    if (selected.size < 2) return;
    const groupId = crypto.randomUUID();
    updateActiveScreenWidgets(getCanvasWidgets(screen, current.activeRepeaterEdit).map((widget) =>
      selected.has(widget.id) ? { ...widget, groupId } : widget,
    ));
  }, [updateActiveScreenWidgets]);

  const requestCreateSymbolFromSelection = useCallback(() => {
    const current = useStore.getState();
    const screen = current.project.screens.find(
      (item) => item.id === current.getActiveScreenId(),
    );
    if (!screen) return;
    const selected = getCanvasWidgets(screen, current.activeRepeaterEdit).filter((widget) =>
      current.selectedIds.includes(widget.id),
    );
    if (selected.length === 0) return;
    const defaultName = selected.length === 1
      ? selected[0].name ?? selected[0].type
      : `${selected.length} layers`;
    setSymbolNameDialog(defaultName);
    setCanvasContextMenu(null);
  }, []);

  const createSymbolFromSelection = useCallback((name: string) => {
    const current = useStore.getState();
    const screen = current.project.screens.find(
      (item) => item.id === current.getActiveScreenId(),
    );
    if (!screen) return;
    const selected = screen.widgets.filter((widget) =>
      current.selectedIds.includes(widget.id),
    );
    if (selected.length === 0) return;
    try {
      const symbol = createSymbolDefinition(name, selected);
      const selectedIds = new Set(selected.map((widget) => widget.id));
      const instance = createSymbolInstance(
        symbol,
        Math.min(...selected.map((widget) => widget.x)),
        Math.min(...selected.map((widget) => widget.y)),
        0,
      );
      const parentId = selected[0].groupId;
      if (parentId && !selectedIds.has(parentId) &&
        selected.every((widget) => widget.groupId === parentId)) {
        instance.groupId = parentId;
      }
      const replacementWidgets = replaceWidgetsWithSymbolInstance(
        screen.widgets,
        selectedIds,
        instance,
      );
      current.setProject({
        ...current.project,
        updatedAt: new Date().toISOString(),
        symbols: [...current.project.symbols, symbol],
        screens: current.project.screens.map((item) =>
          item.id === screen.id
            ? {
                ...item,
                widgets: replacementWidgets.map((widget, index) => ({
                  ...widget,
                  zIndex: index,
                })),
              }
            : item,
        ),
      });
      useStore.getState().select([instance.id]);
      onNotify(`Created symbol "${symbol.name}".`);
      setSymbolNameDialog(null);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Could not create symbol.", true);
    }
  }, [onNotify]);

  const detachSymbolInstance = useCallback((widgetId: string) => {
    const current = useStore.getState();
    const screen = current.project.screens.find(
      (item) => item.id === current.getActiveScreenId(),
    );
    const instance = screen?.widgets.find((widget) => widget.id === widgetId);
    const symbol = instance?.symbolId
      ? current.project.symbols.find((item) => item.id === instance.symbolId)
      : undefined;
    if (!screen || !instance || !symbol) return;
    const detached = expandSymbolInstance(instance, symbol);
    current.setProject({
      ...current.project,
      updatedAt: new Date().toISOString(),
      screens: current.project.screens.map((item) =>
        item.id !== screen.id
          ? item
          : {
              ...item,
              widgets: item.widgets.flatMap((widget) =>
                widget.id === instance.id ? detached : [widget],
              ),
            },
      ),
    });
    useStore.getState().select(detached.map((widget) => widget.id));
  }, []);

  const swapSymbolInstance = useCallback((widgetId: string, symbolId: string) => {
    const current = useStore.getState();
    const screenId = current.getActiveScreenId();
    const symbol = current.project.symbols.find((item) => item.id === symbolId);
    if (!symbol) return;
    const screen = current.project.screens.find((item) => item.id === screenId);
    if (!screen) return;
    updateActiveScreenWidgets(screen.widgets.map((widget) =>
      widget.id === widgetId && widget.type === "symbol-instance"
        ? swapSymbolReference(widget, symbol)
        : widget,
    ));
  }, [updateActiveScreenWidgets]);

  const setSymbolTextOverride = useCallback((
    instance: Widget,
    masterWidget: Widget,
    property: "text" | "label",
    value: string,
  ) => {
    const previous = instance.props.symbolOverrides;
    const previousOverrides: Record<string, unknown> =
      typeof previous === "object" && previous !== null && !Array.isArray(previous)
        ? previous as Record<string, unknown>
        : {};
    const previousEntry = previousOverrides[masterWidget.id];
    const entry: Record<string, unknown> =
      typeof previousEntry === "object" && previousEntry !== null && !Array.isArray(previousEntry)
        ? previousEntry as Record<string, unknown>
        : {};
    const previousProps =
      typeof entry.props === "object" && entry.props !== null && !Array.isArray(entry.props)
        ? entry.props
        : {};
    updateActiveScreenWidgets((useStore.getState().project.screens.find(
      (screen) => screen.id === useStore.getState().getActiveScreenId(),
    )?.widgets ?? []).map((widget) =>
      widget.id === instance.id
        ? {
            ...widget,
            props: {
              ...widget.props,
              symbolOverrides: {
                ...previousOverrides,
                [masterWidget.id]: {
                  ...entry,
                  props: { ...previousProps, [property]: value },
                },
              },
            },
          }
        : widget,
    ));
  }, [updateActiveScreenWidgets]);

  const handleCanvasWidgetContextMenu = useCallback((
    widgetId: string,
    event: Konva.KonvaEventObject<MouseEvent>,
  ) => {
    event.cancelBubble = true;
    event.evt.preventDefault();
    event.evt.stopPropagation();
    const current = useStore.getState();
    if (!current.selectedIds.includes(widgetId)) current.select([widgetId]);
    setCanvasContextMenu({ x: event.evt.clientX, y: event.evt.clientY });
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
      if (isEditingTarget(event.target)) {
        return;
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        event.altKey &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault();
        requestCreateSymbolFromSelection();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.altKey) {
        const key = event.key.toLowerCase();
        if (key === "c") {
          event.preventDefault();
          copyStyleSelection();
          return;
        }
        if (key === "v") {
          event.preventDefault();
          pasteStyleSelection();
          return;
        }
      }
      if (event.altKey) return;
      if (event.ctrlKey || event.metaKey) {
        const key = event.key.toLowerCase();
        if (key === "c" || key === "x") {
          event.preventDefault();
          void copySelection(key === "x");
          return;
        }
        if (key === "v") {
          event.preventDefault();
          void pasteSelection();
          return;
        }
        if (key === "d") {
          event.preventDefault();
          duplicateSelection();
          return;
        }
        return;
      }
      if (event.key === "Escape" && canvasContextMenu) {
        setCanvasContextMenu(null);
        event.preventDefault();
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
        deleteSelection();
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
          ? getEffectiveScreenWidgets(screen, current.activeBreakpointId, current.activeRepeaterEdit)
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
  }, [
    canvasContextMenu,
    copySelection,
    copyStyleSelection,
    createWidgetAt,
    requestCreateSymbolFromSelection,
    deleteSelection,
    duplicateSelection,
    onToolChange,
    pasteSelection,
    pasteStyleSelection,
  ]);

  useEffect(
    () => () => {
      if (guideTimerRef.current !== null) window.clearTimeout(guideTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!canvasContextMenu) return;
    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest(".canvas-context-menu")
      ) return;
      setCanvasContextMenu(null);
    };
    window.addEventListener("pointerdown", closeOnOutsidePointerDown);
    return () => window.removeEventListener("pointerdown", closeOnOutsidePointerDown);
  }, [canvasContextMenu]);

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
    const openImageUrlDialog = () => setImageUrlDialogOpen(true);
    window.addEventListener(OPEN_IMAGE_URL_EVENT, openImageUrlDialog);
    return () => window.removeEventListener(OPEN_IMAGE_URL_EVENT, openImageUrlDialog);
  }, []);

  useEffect(() => {
    if (activeTool) setPanMode(false);
  }, [activeTool]);

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
      const isSpaceDrag = event.button === 0 && (spacePressedRef.current || panMode);
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
    [panMode],
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
      className={`canvas-stage-surface${spacePressed || panMode ? " is-space-ready" : ""}${panMode ? " is-pan-mode" : ""}${isPanning ? " is-panning" : ""}${activeTool ? " is-drawing" : ""}`}
      data-canvas-zoom={zoom}
      data-canvas-pan-x={pan.x}
      data-canvas-pan-y={pan.y}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onLostPointerCapture={handlePointerUp}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setCanvasContextMenu({ x: event.clientX, y: event.clientY });
      }}
      onAuxClick={(event) => {
        if (event.button === 1) event.preventDefault();
      }}
      onDragOver={(event) => {
        if (
          event.dataTransfer.types.includes(LAYER_DRAG_MIME) ||
          event.dataTransfer.types.includes(ELEMENT_DRAG_MIME)
        ) {
          event.preventDefault();
          event.dataTransfer.dropEffect = event.dataTransfer.types.includes(LAYER_DRAG_MIME) &&
            (event.ctrlKey || event.metaKey)
            ? "none"
            : "copy";
          updateCanvasDropFeedback(event);
          return;
        }
        if (!isTauri() && event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
        }
      }}
      onDrop={(event) => {
        if (handleLayerDrop(event)) return;
        if (handleElementDrop(event)) return;
        clearCanvasDropFeedback();
        if (isTauri() || event.dataTransfer.files.length === 0) return;
        event.preventDefault();
        const position = getWorldPositionFromClient(event.clientX, event.clientY);
        lastPointerWorldRef.current = position;
        void handleImageFiles(Array.from(event.dataTransfer.files), position);
      }}
    >
      {imageUrlDialogOpen && (
        <div
          className="image-url-backdrop"
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !imageUrlLoading) {
              setImageUrlDialogOpen(false);
            }
          }}
        >
          <form
            className="image-url-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="image-url-title"
            onKeyDown={(event) => {
              if (event.key === "Escape" && !imageUrlLoading) {
                setImageUrlDialogOpen(false);
              }
            }}
            onSubmit={(event) => void importImageFromUrl(event)}
          >
            <div className="image-url-dialog-heading">
              <div>
                <span className="image-url-overline">IMAGE SOURCE</span>
                <h2 id="image-url-title">Add image from URL</h2>
              </div>
              <button
                className="icon-button small-icon"
                type="button"
                aria-label="Close image URL dialog"
                disabled={imageUrlLoading}
                onClick={() => setImageUrlDialogOpen(false)}
              >
                <X size={15} />
              </button>
            </div>
            <label className="field-label" htmlFor="image-source-url">
              Image URL
            </label>
            <input
              id="image-source-url"
              className="text-field"
              type="url"
              required
              autoFocus
              value={imageUrlDraft}
              placeholder="https://example.com/image.jpg"
              onChange={(event) => setImageUrlDraft(event.currentTarget.value)}
            />
            <p className="field-hint">
              The image is imported into this project; its URL must allow cross-origin access.
              You can resize it after adding.
            </p>
            <div className="image-url-dialog-actions">
              <button
                className="button button-quiet"
                type="button"
                disabled={imageUrlLoading}
                onClick={() => setImageUrlDialogOpen(false)}
              >
                Cancel
              </button>
              <button
                className="button button-primary"
                type="submit"
                disabled={imageUrlLoading || !imageUrlDraft.trim()}
              >
                {imageUrlLoading ? <LoaderCircle className="is-spinning" size={14} /> : <Link2 size={14} />}
                {imageUrlLoading ? "Importing…" : "Import image"}
              </button>
            </div>
          </form>
        </div>
      )}
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
              {canvasDropFeedback.elementTool ? (
                (() => {
                  const DropIcon = getShapeToolDefinition(canvasDropFeedback.elementTool)?.icon;
                  return DropIcon ? <DropIcon size={18} /> : <FolderOpen size={18} />;
                })()
              ) : canvasDropFeedback.itemCount > 1 ? (
                `+${canvasDropFeedback.itemCount}`
              ) : (
                <FolderOpen size={18} />
              )}
            </span>
            <span>
              {canvasDropFeedback.elementTool && canvasDropFeedback.targetId &&
              canvasDropFeedback.targetType &&
              isWidgetContainer({ type: canvasDropFeedback.targetType })
                ? `Add ${canvasDropFeedback.label} to ${canvasDropFeedback.targetType}`
                : canvasDropFeedback.elementTool
                ? `Create ${canvasDropFeedback.label}`
                : canvasDropFeedback.targetType &&
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
        accept="image/*,.svg"
        multiple
        aria-label="Choose an image file"
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          const targetId = imageTargetRef.current;
          imageTargetRef.current = null;
          if (files.length === 0) return;
          const target = targetId
            ? screenWidgets.find((widget) => widget.id === targetId)
            : undefined;
          const position = target
            ? { x: target.x, y: target.y }
            : {
                x: Math.max(0, (activeDevice.width - 200) / 2),
                y: Math.max(0, (activeDevice.height - 200) / 2),
              };
          void handleImageFiles(files, position, targetId);
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
            visible={intersectsCanvasViewport(
              {
                x: -(showDeviceFrame ? activeDevicePreset?.frameChrome?.bezel ?? 0 : 0),
                y: -(showDeviceFrame
                  ? Math.max(
                      activeDevicePreset?.frameChrome?.bezel ?? 0,
                      activeDevicePreset?.frameChrome?.notch === "browser" ? 30 : 0,
                    )
                  : 0),
                width: activeDevice.width +
                  (showDeviceFrame ? (activeDevicePreset?.frameChrome?.bezel ?? 0) * 2 : 0),
                height: activeDevice.height +
                  (showDeviceFrame ? (activeDevicePreset?.frameChrome?.bezel ?? 0) * 2 : 0) +
                  (showDeviceFrame && activeDevicePreset?.id.startsWith("macbook-") ? 10 : 0),
              },
              canvasViewportBounds,
            )}
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
            visible={renderableWidgets.length > 0}
            perfectDrawEnabled={false}
          >
            {renderableWidgets.map((widget) => {
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
                  hoverAccent={getLayerAccentColor(widget)}
                  overflowed={getWidgetViewportOverflow(widget, activeDevice) > 0}
                  parentHighlighted={selectedParentWidgetIds.has(widget.id)}
                  zoom={zoom}
                  activeTool={activeTool}
                  position={
                    previewPositions[widget.id] ??
                    autoLayoutPositions.get(widget.id) ??
                    { x: widget.x, y: widget.y }
                  }
                  onEdit={() => beginWidgetTextEdit(widget)}
                  symbolDefinition={symbols.find((symbol) => symbol.id === widget.symbolId)}
                  onContextMenu={(event) =>
                    handleCanvasWidgetContextMenu(widget.id, event)
                  }
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
          </Layer>
          <Layer ref={transformerLayerRef} perfectDrawEnabled={false}>
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
                  ? getEffectiveScreenWidgets(screen, current.activeBreakpointId, current.activeRepeaterEdit).filter(
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
                  ? getEffectiveScreenWidgets(screen, current.activeBreakpointId, current.activeRepeaterEdit).filter(
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
          {notesOverlay && (
            <Layer>
              {screenWidgets.filter((widget) =>
                widget.notes && renderableWidgetIds.has(widget.id),
              ).map((widget) => {
                const priorityColor = {
                  low: "#7196e8",
                  medium: "#d5a446",
                  high: "#e57945",
                  critical: "#e04f59",
                }[widget.notes!.priority];
                return (
                  <Group
                    key={`note-pin-${widget.id}`}
                    x={widget.x + widget.width - 8}
                    y={widget.y - 10}
                    onClick={() => {
                      const state = useStore.getState();
                      state.select([widget.id]);
                      state.setInspectorTab("notes");
                    }}
                    onTap={() => {
                      const state = useStore.getState();
                      state.select([widget.id]);
                      state.setInspectorTab("notes");
                    }}
                  >
                    <Circle
                      radius={11}
                      fill={priorityColor}
                      stroke="#fff"
                      strokeWidth={1}
                      shadowColor="#000"
                      shadowBlur={4}
                      shadowOpacity={0.35}
                    />
                    <Text
                      x={-7}
                      y={-7}
                      width={14}
                      height={14}
                      text="N"
                      fontSize={10}
                      fontStyle="bold"
                      fill="#fff"
                      align="center"
                      verticalAlign="middle"
                      listening={false}
                    />
                  </Group>
                );
              })}
            </Layer>
          )}
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
      {import.meta.env.DEV && (
        <CanvasPerformanceOverlay
          nodeCount={screenWidgets.length}
          culledNodeCount={culledNodeCount}
          activePanelCount={activePanelCount}
          repeaterRowCount={repeaterRowCount}
        />
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
        const expressionMatch = /\[\[\s*([A-Za-z_$][\w$]*)?$/.exec(editValue.slice(0, editCursor));
        const expressionQuery = expressionMatch?.[1] ?? "";
        const expressionSuggestions = expressionMatch
          ? [...new Set([
              ...project.variables
                .filter((variable) => variable.scope === "project" || variable.screenId === activeScreen?.id)
                .map((variable) => variable.name),
              ...collectWidgetsDeep(screenWidgets).flatMap((candidate) =>
                [candidate.name, typeof candidate.props.name === "string" ? candidate.props.name : ""],
              ).filter((name): name is string => Boolean(name)),
              "item.field",
              "this.x",
              ...EXPRESSION_FUNCTIONS.map((name) => `${name}(`),
            ])].filter((suggestion) => suggestion.toLowerCase().startsWith(expressionQuery.toLowerCase())).slice(0, 8)
          : [];
        let expressionError = "";
        const liveExpressionPreview = editValue.replace(/\[\[([\s\S]*?)\]\]/g, (whole, source: string) => {
          try {
            const result = evaluateExpression(source.trim(), {
              variables: Object.fromEntries(project.variables.map((variable) => [variable.name, variable.initial])),
              widgets: collectWidgetsDeep(screenWidgets),
              thisWidget: widget,
            });
            return result === null || result === undefined ? "" : String(result);
          } catch (error) {
            expressionError ||= error instanceof Error ? error.message : "Invalid expression.";
            return whole;
          }
        });
        if (widget.type === "text" && widget.props.richText === true) {
          return (
            <RichTextEditor
              label={`Edit ${widget.type} rich text`}
              text={editValue}
              runs={widget.props.richTextRuns}
              contrastBackground={typeof widget.style.fill === "string" ? widget.style.fill : "#ffffff"}
              style={{
                left,
                top: Math.max(0, top - 38),
                width: Math.max(180, width),
                minHeight: height + 38,
                transform: `rotate(${widget.rotation}deg)`,
                transformOrigin: "top left",
                fontFamily: typeof widget.props.fontFamily === "string" ? widget.props.fontFamily : "Arial",
                fontSize: `${(typeof widget.props.fontSize === "number" ? widget.props.fontSize : 14) * zoom}px`,
                lineHeight: String(typeof widget.props.lineHeight === "number" ? widget.props.lineHeight : 1.2),
              }}
              onCommit={(runs) => {
                updateWidgetProps(widget.id, {
                  richTextRuns: runs,
                  text: richTextRunsToPlainText(runs),
                });
                setEditing(null);
              }}
              onCancel={cancelWidgetTextEdit}
            />
          );
        }
        return (
          <>
            <textarea
              ref={textEditorRef}
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
              onChange={(event) => {
                setEditValue(event.currentTarget.value.slice(0, MAX_WIDGET_TEXT_LENGTH));
                setEditCursor(event.currentTarget.selectionStart);
                setVariableSuggestionIndex(0);
              }}
              onClick={(event) => setEditCursor(event.currentTarget.selectionStart)}
              onKeyUp={(event) => setEditCursor(event.currentTarget.selectionStart)}
              onMouseDown={(event) => event.stopPropagation()}
              onBlur={() => {
                if (cancelEditRef.current) {
                  cancelEditRef.current = false;
                  return;
                }
                commitWidgetTextEdit();
              }}
              onKeyDown={(event) => {
                if (visibleVariableSuggestions.length > 0 && event.key === "ArrowDown") {
                  event.preventDefault();
                  setVariableSuggestionIndex((index) =>
                    (index + 1) % visibleVariableSuggestions.length,
                  );
                } else if (visibleVariableSuggestions.length > 0 && event.key === "ArrowUp") {
                  event.preventDefault();
                  setVariableSuggestionIndex((index) =>
                    (index - 1 + visibleVariableSuggestions.length) % visibleVariableSuggestions.length,
                  );
                } else if (
                  visibleVariableSuggestions.length > 0 &&
                  (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey))
                ) {
                  event.preventDefault();
                  const suggestion = visibleVariableSuggestions[variableSuggestionIndex];
                  if (suggestion) insertVariableSuggestion(suggestion.name);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  cancelWidgetTextEdit();
                } else if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  commitWidgetTextEdit();
                }
              }}
            />
            {editValue.includes("[[") && (
              <output
                className={`expression-field-preview canvas-expression-preview${expressionError ? " is-error" : ""}`}
                role={expressionError ? "alert" : "status"}
                style={{ left, top: top + height + 3, width: Math.max(width, 180) }}
              >{expressionError ? `Expression error: ${expressionError}` : `Preview: ${liveExpressionPreview}`}</output>
            )}
            <button
              type="button"
              className="expression-insert-button"
              aria-label="Insert expression"
              style={{ left, top: Math.max(0, top - 28) }}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                const editor = textEditorRef.current;
                const start = editor?.selectionStart ?? editCursor;
                const end = editor?.selectionEnd ?? start;
                const insertion = "[[ ]]";
                const next = `${editValue.slice(0, start)}${insertion}${editValue.slice(end)}`;
                const cursor = start + 3;
                setEditValue(next);
                setEditCursor(cursor);
                requestAnimationFrame(() => {
                  textEditorRef.current?.focus();
                  textEditorRef.current?.setSelectionRange(cursor, cursor);
                });
              }}
            >Insert [[ ]]</button>
            {variableCompletion && visibleVariableSuggestions.length > 0 && (
              <div
                className="variable-completion-popover"
                role="listbox"
                aria-label="Variable suggestions"
                style={{ left, top: top + height + 4, minWidth: Math.min(width, 220) }}
              >
                {visibleVariableSuggestions.map((variable, index) => (
                  <button
                    className={`variable-completion-option${index === variableSuggestionIndex ? " is-active" : ""}`}
                    key={variable.id}
                    type="button"
                    role="option"
                    aria-selected={index === variableSuggestionIndex}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => insertVariableSuggestion(variable.name)}
                  >
                    <span className="variable-token-chip">{variable.name}</span>
                    <small>{variable.type} · {variable.scope}</small>
                  </button>
                ))}
                <div className="variable-completion-hint">Enter or Tab to insert</div>
              </div>
            )}
            {expressionMatch && expressionSuggestions.length > 0 && (
              <div
                className="variable-completion-popover"
                role="listbox"
                aria-label="Expression suggestions"
                style={{ left, top: top + height + 4, minWidth: Math.min(width, 220) }}
              >
                {expressionSuggestions.map((suggestion) => (
                  <button
                    className="variable-completion-option"
                    key={suggestion}
                    type="button"
                    role="option"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      const start = editCursor - expressionMatch[0].length;
                      const insertion = `[[${suggestion}`;
                      const next = `${editValue.slice(0, start)}${insertion}${editValue.slice(editCursor)}`;
                      const cursor = start + insertion.length;
                      setEditValue(next);
                      setEditCursor(cursor);
                      requestAnimationFrame(() => {
                        textEditorRef.current?.focus();
                        textEditorRef.current?.setSelectionRange(cursor, cursor);
                      });
                    }}
                  >{suggestion}</button>
                ))}
                <div className="variable-completion-hint">Expression names and functions</div>
              </div>
            )}
          </>
        );
      })()}
      <div className="canvas-zoom-controls" role="group" aria-label="Canvas view controls">
        <button
          className={`icon-button small-icon${panMode ? " is-active" : ""}`}
          type="button"
          title={panMode ? "Exit canvas pan mode" : "Pan canvas"}
          aria-label={panMode ? "Exit canvas pan mode" : "Pan canvas"}
          aria-pressed={panMode}
          onClick={() => {
            setPanMode((current) => !current);
            onToolChange(null);
          }}
        >
          <Hand size={14} />
        </button>
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
        <button
          className="icon-button small-icon"
          type="button"
          title="Fit screen"
          aria-label="Fit screen"
          onClick={() => {
            const current = useStore.getState();
            const screen = current.project.screens.find(
              (item) => item.id === current.getActiveScreenId(),
            );
            if (!screen || size.width === 0 || size.height === 0) return;
            const device = screen.device ?? toScreenDevice(DEFAULT_DEVICE_PRESET);
            applyView(
              fitCanvasBounds(
                getDeviceFrameBounds(
                  device,
                  findDevicePreset(device.presetId)?.frameChrome?.bezel ?? 0,
                  showDeviceFrame,
                ),
                size,
                40,
              ),
            );
          }}
        >
          <Maximize2 size={14} />
        </button>
      </div>
      {symbolNameDialog !== null && (
        <SymbolNameDialog
          defaultName={symbolNameDialog}
          onCancel={() => setSymbolNameDialog(null)}
          onSubmit={createSymbolFromSelection}
        />
      )}
      {symbolTextOverrideDialog && (
        <SymbolNameDialog
          defaultName={String(
            symbolTextOverrideDialog.masterWidget.props[symbolTextOverrideDialog.property] ?? "",
          )}
          eyebrow="SYMBOL INSTANCE"
          title="Override text"
          fieldLabel="Text content"
          submitLabel="Apply override"
          onCancel={() => setSymbolTextOverrideDialog(null)}
          onSubmit={(value) => {
            setSymbolTextOverride(
              symbolTextOverrideDialog.instance,
              symbolTextOverrideDialog.masterWidget,
              symbolTextOverrideDialog.property,
              value,
            );
            setSymbolTextOverrideDialog(null);
          }}
        />
      )}
      {canvasContextMenu && (
        <div
          className="tree-context-menu canvas-context-menu"
          role="menu"
          style={{
            left: Math.min(canvasContextMenu.x, window.innerWidth - 210),
            top: Math.min(canvasContextMenu.y, window.innerHeight - 300),
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button role="menuitem" disabled={selectedWidgets.length === 0} onClick={() => { void copySelection(); setCanvasContextMenu(null); }}>
            Copy
          </button>
          <button
            role="menuitem"
            disabled={selectedWidgets.length !== 1}
            onClick={() => { copyStyleSelection(); setCanvasContextMenu(null); }}
          >
            Copy Style
          </button>
          <button role="menuitem" disabled={!selectedHasUnlockedWidget} onClick={() => { void copySelection(true); setCanvasContextMenu(null); }}>
            Cut
          </button>
          <button role="menuitem" onClick={() => { void pasteSelection(); setCanvasContextMenu(null); }}>
            Paste
          </button>
          <button
            role="menuitem"
            disabled={!getCopiedWidgetStyle() || selectedWidgets.length === 0}
            onClick={() => { pasteStyleSelection(); setCanvasContextMenu(null); }}
          >
            Paste Style
          </button>
          <button role="menuitem" disabled={selectedWidgets.length === 0} onClick={() => { duplicateSelection(); setCanvasContextMenu(null); }}>
            Duplicate
          </button>
          <button role="menuitem" disabled={selectedWidgets.length === 0} onClick={() => { changeSelectionZOrder("forward"); setCanvasContextMenu(null); }}>
            Bring Forward
          </button>
          <button role="menuitem" disabled={selectedWidgets.length === 0} onClick={() => { changeSelectionZOrder("front"); setCanvasContextMenu(null); }}>
            Bring to Front
          </button>
          <button role="menuitem" disabled={selectedWidgets.length === 0} onClick={() => { changeSelectionZOrder("backward"); setCanvasContextMenu(null); }}>
            Send Backward
          </button>
          <button role="menuitem" disabled={selectedWidgets.length === 0} onClick={() => { changeSelectionZOrder("back"); setCanvasContextMenu(null); }}>
            Send to Back
          </button>
          <button
            role="menuitem"
            disabled={selectedIds.length < 2}
            onClick={() => { groupSelection(); setCanvasContextMenu(null); }}
          >
            Group
          </button>
          <button role="menuitem" disabled={!selectedHasSemanticGroup} onClick={() => { groupSelection(true); setCanvasContextMenu(null); }}>
            Ungroup
          </button>
          <button role="menuitem" disabled={selectedWidgets.length === 0} onClick={() => { toggleSelectionLock(); setCanvasContextMenu(null); }}>
            {selectedWidgets.length > 0 && selectedWidgets.every((widget) => widget.locked)
              ? "Unlock"
              : "Lock"}
          </button>
          <button role="menuitem" disabled={!selectedHasUnlockedWidget} onClick={() => { deleteSelection(); setCanvasContextMenu(null); }}>
            Delete
          </button>
          <button
            role="menuitem"
            disabled={selectedWidgets.length === 0 || selectedWidgets.some((widget) => widget.type === "symbol-instance")}
            onClick={requestCreateSymbolFromSelection}
          >
            Create Symbol
          </button>
          {selectedWidgets.length === 1 && selectedWidgets[0].type === "symbol-instance" && (
            <>
              <button
                role="menuitem"
                onClick={() => {
                  detachSymbolInstance(selectedWidgets[0].id);
                  setCanvasContextMenu(null);
                }}
              >
                Detach from Symbol
              </button>
              {symbols.length > 1 && (
                <div className="tree-context-menu-levels" role="group" aria-label="Swap symbol">
                  <span>Swap Symbol</span>
                  {symbols
                    .filter((symbol) => symbol.id !== selectedWidgets[0].symbolId)
                    .map((symbol) => (
                      <button
                        key={symbol.id}
                        role="menuitem"
                        onClick={() => {
                          swapSymbolInstance(selectedWidgets[0].id, symbol.id);
                          setCanvasContextMenu(null);
                        }}
                      >
                        {symbol.name}
                      </button>
                    ))}
                </div>
              )}
              {symbols
                .find((symbol) => symbol.id === selectedWidgets[0].symbolId)
                ?.widgets.flatMap((masterWidget) => {
                  const textProperty = masterWidget.type === "text"
                    ? "text"
                    : ["button", "checkbox", "radio", "toggle"].includes(masterWidget.type)
                      ? "label"
                      : null;
                  if (!textProperty || typeof masterWidget.props[textProperty] !== "string") return [];
                  return (
                    <button
                      key={`symbol-text-${masterWidget.id}`}
                      role="menuitem"
                      onClick={() => {
                        setSymbolTextOverrideDialog({
                          instance: selectedWidgets[0],
                          masterWidget,
                          property: textProperty,
                        });
                        setCanvasContextMenu(null);
                      }}
                    >
                      Edit {masterWidget.name ?? masterWidget.type} text
                    </button>
                  );
                })}
            </>
          )}
        </div>
      )}
    </div>
  );
}
