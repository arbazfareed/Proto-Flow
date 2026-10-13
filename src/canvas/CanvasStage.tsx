import { useCallback, useEffect, useRef, useState } from "react";
import { Group, Layer, Line, Shape, Stage, Text } from "react-konva";
import { ArrowDownToLine, FolderOpen, Minus, Plus } from "lucide-react";
import type { Stage as KonvaStage } from "konva/lib/Stage";
import { useStore } from "../store";
import type { Widget } from "../project/schema";
import {
  centerCanvasView,
  clampCanvasZoom,
  fitCanvasBounds,
  getWidgetBounds,
  zoomAroundPointer,
} from "./navigation";
import { snapWidgetPosition, type CanvasGuide, type CanvasPoint } from "./snapping";
import {
  createShapeWidget,
  getShapeDefinition,
  measureTextBounds,
  renderWidgetShape,
  type ShapeTool,
} from "./shapes";

interface CanvasSize {
  width: number;
  height: number;
}

interface CanvasStageProps {
  onSaveAs: () => void;
  onOpen: () => void;
  onOpenPalette: () => void;
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
  const screenSpacing = gridSize * zoom;
  const gridMultiplier =
    screenSpacing >= 8 ? 1 : 2 ** Math.ceil(Math.log2(8 / screenSpacing));
  const spacing = gridSize * gridMultiplier;

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
  activeTool,
  position,
  onSelect,
  onDragMove,
  onDragEnd,
  onDragBound,
}: {
  widget: Widget;
  selected: boolean;
  activeTool: ShapeTool | null;
  position: CanvasPoint;
  onSelect: (event: { evt: MouseEvent | TouchEvent }) => void;
  onDragMove: (position: CanvasPoint, altKey: boolean) => void;
  onDragEnd: (position: CanvasPoint) => void;
  onDragBound: (position: CanvasPoint) => CanvasPoint;
}) {
  return (
    <Group
      id={widget.id}
      x={position.x}
      y={position.y}
      rotation={widget.rotation}
      visible={widget.visible}
      draggable={!widget.locked && activeTool === null}
      dragBoundFunc={onDragBound}
      onClick={(event) => onSelect(event)}
      onTap={(event) => onSelect(event)}
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
    </Group>
  );
}

export function CanvasStage({
  onSaveAs,
  onOpen,
  onOpenPalette,
  activeTool,
  onToolChange,
}: CanvasStageProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<KonvaStage>(null);
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
  const [size, setSize] = useState<CanvasSize>({ width: 0, height: 0 });
  const [spacePressed, setSpacePressed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [previewPositions, setPreviewPositions] = useState<Record<string, CanvasPoint>>({});
  const [guides, setGuides] = useState<CanvasGuide[]>([]);
  const [shapeDraft, setShapeDraft] = useState<ShapeDraft | null>(null);
  const altHeldRef = useRef(false);
  const pendingGuidesRef = useRef<CanvasGuide[]>([]);
  const guideTimerRef = useRef<number | null>(null);
  const activeToolRef = useRef<ShapeTool | null>(activeTool);
  const lastPointerWorldRef = useRef<CanvasPoint>({ x: 0, y: 0 });
  const zoom = useStore((state) => state.zoom);
  const pan = useStore((state) => state.pan);
  const gridSize = useStore((state) => state.gridSize);
  const gridStyle = useStore((state) => state.gridStyle);
  const gridVisible = useStore((state) => state.gridVisible);
  const snapEnabled = useStore((state) => state.snapEnabled);
  const activeScreen = useStore((state) =>
    state.project.screens.find((screen) => screen.id === state.project.startScreenId),
  );
  const selectedIds = useStore((state) => state.selectedIds);
  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);
  const screenWidgets = activeScreen
    ? [...activeScreen.widgets].sort((first, second) => first.zIndex - second.zIndex)
    : [];

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
    ) => {
      const current = useStore.getState();
      const screen = current.project.screens.find(
        (item) => item.id === current.project.startScreenId,
      );
      if (!screen) return;

      const definition = getShapeDefinition(type);
      if (!definition) return;
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
    },
    [],
  );

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
        if (event.target === stage) useStore.getState().clearSelection();
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
    if (!draft || !position) return;
    finishDrawing(draft, position);
  }, [finishDrawing, getPointerWorldPosition, shapeDraft]);

  useEffect(() => {
    const shortcuts: Record<string, ShapeTool> = {
      r: "rectangle",
      o: "ellipse",
      t: "text",
      l: "line",
      i: "icon",
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
      const tool = shortcuts[event.key.toLowerCase()];
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
      const nextSize = {
        width: Math.floor(entry.contentRect.width),
        height: Math.floor(entry.contentRect.height),
      };
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
        (item) => item.id === store.project.startScreenId,
      );
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
          : centerCanvasView(bounds, viewport, 1),
      );
    };

    window.addEventListener("keydown", onFitShortcut);
    return () => window.removeEventListener("keydown", onFitShortcut);
  }, [applyView, size]);

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
      onAuxClick={(event) => {
        if (event.button === 1) event.preventDefault();
      }}
    >
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
          <Layer perfectDrawEnabled={false}>
            {screenWidgets.map((widget) => {
              const siblings = screenWidgets.map((sibling) => ({
                id: sibling.id,
                x: sibling.x,
                y: sibling.y,
                width: sibling.width,
                height: sibling.height,
              }));
              const snapPosition = (position: CanvasPoint, altKey = altHeldRef.current) =>
                snapWidgetPosition(
                  {
                    id: widget.id,
                    x: position.x,
                    y: position.y,
                    width: widget.width,
                    height: widget.height,
                  },
                  siblings,
                  gridSize,
                  snapEnabled,
                  altKey,
                );
              return (
                <WidgetNode
                  key={widget.id}
                  widget={widget}
                  selected={selectedIds.includes(widget.id)}
                  activeTool={activeTool}
                  position={
                    previewPositions[widget.id] ?? { x: widget.x, y: widget.y }
                  }
                  onSelect={(event) => {
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
                    setPreviewPositions((current) => ({
                      ...current,
                      [widget.id]: position,
                    }));
                    setGuides(altKey ? [] : pendingGuidesRef.current);
                  }}
                  onDragEnd={(position) => {
                    const result = snapPosition(position);
                    const current = useStore.getState();
                    if (
                      result.position.x !== widget.x ||
                      result.position.y !== widget.y
                    ) {
                      current.setProject({
                        ...current.project,
                        updatedAt: new Date().toISOString(),
                        screens: current.project.screens.map((screen) =>
                          screen.id !== activeScreen?.id
                            ? screen
                            : {
                                ...screen,
                                widgets: screen.widgets.map((item) =>
                                  item.id === widget.id
                                    ? {
                                        ...item,
                                        x: result.position.x,
                                        y: result.position.y,
                                      }
                                    : item,
                                ),
                              },
                        ),
                      });
                    }
                    setPreviewPositions((currentPositions) => {
                      const next = { ...currentPositions };
                      delete next[widget.id];
                      return next;
                    });
                    setGuides([]);
                  }}
                />
              );
            })}
          </Layer>
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
      {screenWidgets.length === 0 && (
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
