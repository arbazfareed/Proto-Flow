import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Layer, Shape, Stage } from "react-konva";
import { ArrowDownToLine, FolderOpen, Minus, Plus } from "lucide-react";
import type { Stage as KonvaStage } from "konva/lib/Stage";
import { useStore } from "../store";
import {
  centerCanvasView,
  clampCanvasZoom,
  fitCanvasBounds,
  getWidgetBounds,
  zoomAroundPointer,
} from "./navigation";

interface CanvasSize {
  width: number;
  height: number;
}

interface CanvasStageProps {
  onSaveAs: () => void;
  onOpen: () => void;
  onOpenPalette: () => void;
}

interface PendingView {
  zoom: number;
  pan: { x: number; y: number };
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
  visible,
}: {
  size: CanvasSize;
  zoom: number;
  pan: { x: number; y: number };
  gridSize: number;
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
        fill="#34353b"
        perfectDrawEnabled={false}
        sceneFunc={(context, shape) => {
          const firstX = Math.ceil(left / spacing) * spacing;
          const firstY = Math.ceil(top / spacing) * spacing;
          const radius = 0.7 / zoom;

          context.beginPath();
          for (let x = firstX; x <= right; x += spacing) {
            for (let y = firstY; y <= bottom; y += spacing) {
              context.moveTo(x - left + radius, y - top);
              context.arc(x - left, y - top, radius, 0, Math.PI * 2);
            }
          }
          context.fillStrokeShape(shape);
        }}
      />
    </Layer>
  );
}

const ContentLayer = memo(function ContentLayer() {
  return <Layer perfectDrawEnabled={false} />;
});

export function CanvasStage({
  onSaveAs,
  onOpen,
  onOpenPalette,
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
  const zoom = useStore((state) => state.zoom);
  const pan = useStore((state) => state.pan);
  const gridSize = useStore((state) => state.gridSize);
  const gridVisible = useStore((state) => state.gridVisible);

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
      className={`canvas-stage-surface${spacePressed ? " is-space-ready" : ""}${isPanning ? " is-panning" : ""}`}
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
        >
          <GridLayer
            size={size}
            zoom={zoom}
            pan={pan}
            gridSize={gridSize}
            visible={gridVisible}
          />
          <ContentLayer />
        </Stage>
      )}
      <div className="canvas-empty-state">
        <div className="empty-icon-wrap"><span className="empty-canvas-mark">PF</span></div>
        <span className="eyebrow">YOUR CANVAS IS READY</span>
        <h1>A little room to think.</h1>
        <p>Save your project locally or open an existing prototype. Canvas tools for drawing and editing are coming next.</p>
        <div className="canvas-empty-actions">
          <button className="button button-primary" onClick={onSaveAs}><ArrowDownToLine size={15} /> Save your project</button>
          <button className="button button-secondary" onClick={onOpen}><FolderOpen size={15} /> Open a project</button>
        </div>
        <div className="empty-shortcut"><span>Press</span> <button className="shortcut-link" onClick={onOpenPalette}>Ctrl K</button> <span>to see all actions</span></div>
      </div>
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
