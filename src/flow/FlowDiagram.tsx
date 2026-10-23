import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  Grip,
  LayoutGrid,
  RotateCcw,
  X,
  Trash2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useStore } from "../store";
import { collectWidgetsDeep } from "../project/dynamicPanels";
import {
  autoLayoutScreens,
  buildFlowSvg,
  FLOW_COLUMN_GAP,
  FLOW_NODE_HEIGHT,
  FLOW_NODE_WIDTH,
  FLOW_ROW_GAP,
  getInitialFlowPositions,
  getNavigationEdges,
} from "../project/flow";
import type { FlowEdge, FlowPosition } from "../project/flow";

interface FlowDiagramProps {
  onNotify: (message: string, isError?: boolean) => void;
  onOpenScreen: (screenId: string, widgetId?: string) => void;
}

type DragState = {
  screenId: string;
  pointerId: number;
  originX: number;
  originY: number;
  startX: number;
  startY: number;
};

type PanState = {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
};

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function FlowDiagram({ onNotify, onOpenScreen }: FlowDiagramProps) {
  const project = useStore((state) => state.project);
  const activeScreenId = useStore((state) => state.getActiveScreenId());
  const selectedIds = useStore((state) => state.selectedIds);
  const edges = useMemo(() => getNavigationEdges(project), [project]);
  const [positions, setPositions] = useState<Record<string, FlowPosition>>(() =>
    getInitialFlowPositions(project.screens, edges, project.startScreenId),
  );
  const positionsRef = useRef(positions);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 24, y: 24 });
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const panRef = useRef<PanState | null>(null);

  useEffect(() => {
    setPositions((current) => {
      const generated = getInitialFlowPositions(
        project.screens,
        edges,
        project.startScreenId,
      );
      const next: Record<string, FlowPosition> = {};
      for (const screen of project.screens) {
        next[screen.id] = screen.flowPosition ?? current[screen.id] ?? generated[screen.id];
      }
      positionsRef.current = next;
      return next;
    });
  }, [edges, project.screens, project.startScreenId]);

  const persistPositions = (nextPositions: Record<string, FlowPosition>) => {
    const current = useStore.getState();
    const updated = current.project.screens.map((screen) => {
      const position = nextPositions[screen.id];
      return position && (
        screen.flowPosition?.x !== position.x || screen.flowPosition?.y !== position.y
      )
        ? { ...screen, flowPosition: { x: position.x, y: position.y } }
        : screen;
    });
    current.setProject({
      ...current.project,
      updatedAt: new Date().toISOString(),
      screens: updated,
    });
  };

  const updatePosition = (screenId: string, position: FlowPosition) => {
    setPositions((current) => {
      const next = { ...current, [screenId]: position };
      positionsRef.current = next;
      return next;
    });
  };

  const autoLayout = () => {
    const next = autoLayoutScreens(project.screens, edges, project.startScreenId);
    positionsRef.current = next;
    setPositions(next);
    persistPositions(next);
    setPan({ x: 24, y: 24 });
    setZoom(1);
  };

  const connectScreens = (sourceScreenId: string, targetScreenId: string) => {
    if (sourceScreenId === targetScreenId) return;
    const current = useStore.getState();
    const source = current.project.screens.find((screen) => screen.id === sourceScreenId);
    const target = current.project.screens.find((screen) => screen.id === targetScreenId);
    if (!source || !target) {
      onNotify("Could not create a link because one of the screens no longer exists.", true);
      return;
    }
    const sourceWidget = collectWidgetsDeep(source.widgets)
      .find((widget) => selectedIds.includes(widget.id));
    if (!sourceWidget) {
      onNotify("Select a widget on the source screen before creating a navigation link.", true);
      return;
    }
    const action = { type: "navigate", target: target.id };
    const existingRule = source.interactionRules.find(
      (rule) => rule.widgetId === sourceWidget.id && rule.event === "onClick",
    );
    const interactionRules = existingRule
      ? source.interactionRules.map((rule) =>
          rule.id === existingRule.id
            ? { ...rule, actions: [...rule.actions, action] }
            : rule,
        )
      : [
          ...source.interactionRules,
          {
            id: crypto.randomUUID(),
            widgetId: sourceWidget.id,
            event: "onClick" as const,
            conditions: [],
            actions: [action],
          },
        ];
    current.setProject({
      ...current.project,
      updatedAt: new Date().toISOString(),
      screens: current.project.screens.map((screen) =>
        screen.id === source.id ? { ...screen, interactionRules } : screen,
      ),
    });
    setSelectedEdgeId(null);
    onNotify(`Added navigation from ${source.name} to ${target.name}.`);
  };

  const deleteEdge = (edge: FlowEdge) => {
    const current = useStore.getState();
    const source = current.project.screens.find((screen) => screen.id === edge.sourceScreenId);
    const rule = source?.interactionRules.find((item) => item.id === edge.ruleId);
    if (!source || !rule || !rule.actions[edge.actionIndex]) {
      onNotify("This navigation link has changed and can no longer be removed.", true);
      setSelectedEdgeId(null);
      return;
    }
    const actions = rule.actions.filter((_, index) => index !== edge.actionIndex);
    const interactionRules = actions.length === 0
      ? source.interactionRules.filter((item) => item.id !== rule.id)
      : source.interactionRules.map((item) =>
          item.id === rule.id ? { ...item, actions } : item,
        );
    current.setProject({
      ...current.project,
      updatedAt: new Date().toISOString(),
      screens: current.project.screens.map((screen) =>
        screen.id === source.id ? { ...screen, interactionRules } : screen,
      ),
    });
    setSelectedEdgeId(null);
    onNotify("Navigation link removed.");
  };

  const editEdgeRule = (edge: FlowEdge) => {
    if (!edge.widgetId) {
      onNotify("This navigation rule is not attached to a widget.", true);
      return;
    }
    onOpenScreen(edge.sourceScreenId, edge.widgetId);
    setSelectedEdgeId(edge.id);
  };

  const exportSvg = () => {
    try {
      const svg = buildFlowSvg(project, positionsRef.current, edges);
      downloadBlob(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), "flow-diagram.svg");
    } catch (error) {
      console.error("Could not export the flow diagram as SVG.", error);
      onNotify(error instanceof Error ? error.message : "Could not export the flow diagram.", true);
    }
  };

  const exportPng = () => {
    let objectUrl: string | null = null;
    try {
      const svg = buildFlowSvg(project, positionsRef.current, edges);
      objectUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
      const image = new Image();
      image.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Could not create an image canvas.");
          context.drawImage(image, 0, 0);
          canvas.toBlob((blob) => {
            if (!blob) {
              onNotify("Could not encode the flow diagram as PNG.", true);
              return;
            }
            downloadBlob(blob, "flow-diagram.png");
          }, "image/png");
        } catch (error) {
          console.error("Could not export the flow diagram as PNG.", error);
          onNotify(error instanceof Error ? error.message : "Could not export the flow diagram.", true);
        } finally {
          if (objectUrl) URL.revokeObjectURL(objectUrl);
        }
      };
      image.onerror = () => {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        onNotify("Could not render the flow diagram for PNG export.", true);
      };
      image.src = objectUrl;
    } catch (error) {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      console.error("Could not export the flow diagram as PNG.", error);
      onNotify(error instanceof Error ? error.message : "Could not export the flow diagram.", true);
    }
  };

  const worldWidth = Math.max(
    720,
    ...project.screens.map((screen) =>
      (positions[screen.id]?.x ?? 0) + FLOW_NODE_WIDTH + FLOW_COLUMN_GAP,
    ),
  );
  const worldHeight = Math.max(
    480,
    ...project.screens.map((screen) =>
      (positions[screen.id]?.y ?? 0) + FLOW_NODE_HEIGHT + FLOW_ROW_GAP,
    ),
  );
  const selectedEdge = edges.find((edge) => edge.id === selectedEdgeId);

  return (
    <section className="flow-diagram" aria-label="Screen flow diagram">
      <div className="flow-toolbar">
        <div className="flow-toolbar-copy">
          <strong>Screen flow</strong>
          <span>{project.screens.length} screens · {edges.length} navigation links</span>
        </div>
        <div className="flow-toolbar-actions">
          <button className="button button-secondary flow-tool-button" onClick={autoLayout} title="Arrange screens automatically">
            <LayoutGrid size={14} /> Auto layout
          </button>
          <button className="button button-secondary flow-tool-button" onClick={exportSvg} title="Export flow diagram as SVG">
            <ArrowDownToLine size={14} /> SVG
          </button>
          <button className="button button-secondary flow-tool-button" onClick={exportPng} title="Export flow diagram as PNG">
            <ArrowDownToLine size={14} /> PNG
          </button>
        </div>
      </div>
      <div
        className="flow-viewport"
        onWheel={(event) => {
          event.preventDefault();
          setZoom((current) => Math.min(2, Math.max(0.35, current * (event.deltaY < 0 ? 1.1 : 0.9))));
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          const target = event.target;
          if (
            target instanceof Element &&
            target.closest(".flow-node, .flow-edge, .flow-edge-card, .flow-zoom-controls, .flow-connect-hint")
          ) {
            return;
          }
          event.currentTarget.setPointerCapture(event.pointerId);
          panRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            originX: pan.x,
            originY: pan.y,
          };
        }}
        onPointerMove={(event) => {
          const activePan = panRef.current;
          if (!activePan || activePan.pointerId !== event.pointerId) return;
          setPan({
            x: activePan.originX + event.clientX - activePan.startX,
            y: activePan.originY + event.clientY - activePan.startY,
          });
        }}
        onPointerUp={(event) => {
          if (panRef.current?.pointerId === event.pointerId) panRef.current = null;
        }}
      >
        <div
          className="flow-world"
          style={{
            width: worldWidth,
            height: worldHeight,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          }}
        >
          <svg className="flow-edges" width={worldWidth} height={worldHeight} aria-label="Navigation links">
            <defs>
              <marker id="flow-arrow" markerWidth="10" markerHeight="8" refX="8" refY="4" orient="auto">
                <path d="M0,0 L10,4 L0,8 z" fill="#9275e7" />
              </marker>
            </defs>
            {edges.map((edge) => {
              const source = positions[edge.sourceScreenId];
              const target = positions[edge.targetScreenId];
              if (!source || !target) return null;
              const x1 = source.x + FLOW_NODE_WIDTH;
              const y1 = source.y + 74;
              const x2 = target.x;
              const y2 = target.y + 74;
              const curve = Math.max(40, Math.abs(x2 - x1) / 2);
              const midpointX = (x1 + x2) / 2;
              const midpointY = (y1 + y2) / 2;
              const label = edge.label.length > 46 ? `${edge.label.slice(0, 43)}…` : edge.label;
              return (
                <g
                  key={edge.id}
                  className={`flow-edge${selectedEdgeId === edge.id ? " is-selected" : ""}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`Navigation ${edge.label}`}
                  onClick={() => setSelectedEdgeId(edge.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") setSelectedEdgeId(edge.id);
                  }}
                >
                  <path
                    className="flow-edge-hit"
                    d={`M ${x1} ${y1} C ${x1 + curve} ${y1}, ${x2 - curve} ${y2}, ${x2} ${y2}`}
                    markerEnd="url(#flow-arrow)"
                  />
                  <path
                    className="flow-edge-visible"
                    d={`M ${x1} ${y1} C ${x1 + curve} ${y1}, ${x2 - curve} ${y2}, ${x2} ${y2}`}
                    markerEnd="url(#flow-arrow)"
                  />
                  <text x={midpointX} y={midpointY - 8} textAnchor="middle">{label}</text>
                </g>
              );
            })}
          </svg>
          {project.screens.map((screen) => {
            const position = positions[screen.id] ?? { x: 48, y: 48 };
            const deviceWidth = screen.device?.width ?? 1280;
            const deviceHeight = screen.device?.height ?? 800;
            const widgetScale = 100 / Math.max(deviceWidth, deviceHeight);
            return (
              <article
                key={screen.id}
                className={`flow-node${activeScreenId === screen.id ? " is-active" : ""}${connectingFrom && connectingFrom !== screen.id ? " can-connect" : ""}`}
                data-flow-node-id={screen.id}
                style={{ left: position.x, top: position.y }}
                onPointerUp={() => {
                  if (connectingFrom && connectingFrom !== screen.id) {
                    connectScreens(connectingFrom, screen.id);
                    setConnectingFrom(null);
                  }
                }}
                aria-label={`${screen.name} screen`}
              >
                <header
                  className="flow-node-header"
                  onPointerDown={(event) => {
                    const target = event.target;
                    if (!(target instanceof Element) || !target.closest(".flow-drag-grip")) return;
                    event.preventDefault();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    dragRef.current = {
                      screenId: screen.id,
                      pointerId: event.pointerId,
                      originX: position.x,
                      originY: position.y,
                      startX: event.clientX,
                      startY: event.clientY,
                    };
                  }}
                  onPointerMove={(event) => {
                    const activeDrag = dragRef.current;
                    if (!activeDrag || activeDrag.pointerId !== event.pointerId) return;
                    const deltaX = event.clientX - activeDrag.startX;
                    const deltaY = event.clientY - activeDrag.startY;
                    updatePosition(activeDrag.screenId, {
                      x: Math.max(0, activeDrag.originX + deltaX / zoom),
                      y: Math.max(0, activeDrag.originY + deltaY / zoom),
                    });
                  }}
                  onPointerUp={(event) => {
                    if (dragRef.current?.pointerId !== event.pointerId) return;
                    dragRef.current = null;
                    persistPositions(positionsRef.current);
                  }}
                >
                  <button
                    className="flow-node-title"
                    onClick={() => onOpenScreen(screen.id)}
                    title={`Open ${screen.name} in Design`}
                  >
                    <span className="flow-node-name">{screen.name}</span>
                    {project.startScreenId === screen.id && <span className="flow-start-badge">START</span>}
                  </button>
                  <span className="flow-drag-grip" aria-hidden="true"><Grip size={12} /></span>
                  <button
                    className={`flow-connect-handle${connectingFrom === screen.id ? " is-connecting" : ""}`}
                    title={connectingFrom === screen.id ? "Drag to a destination screen" : "Drag to a screen to create a navigation link"}
                    aria-label={`Create navigation from ${screen.name}`}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setConnectingFrom(screen.id);
                      setSelectedEdgeId(null);
                    }}
                  >
                    <ArrowRight size={13} />
                  </button>
                </header>
                <button
                  className="flow-node-preview"
                  onClick={() => onOpenScreen(screen.id)}
                  aria-label={`Open ${screen.name} in Design`}
                >
                  <div
                    className="flow-preview-screen"
                    style={{ aspectRatio: `${deviceWidth} / ${deviceHeight}` }}
                  >
                    {screen.widgets.filter((widget) => widget.visible).slice(0, 24).map((widget) => (
                      <span
                        key={widget.id}
                        className={`flow-preview-widget${widget.notes ? ` has-notes note-priority-${widget.notes.priority}` : ""}`}
                        title={widget.notes
                          ? `${widget.notes.priority} priority${widget.notes.requirementId ? ` · ${widget.notes.requirementId}` : ""}${widget.notes.description ? ` · ${widget.notes.description.slice(0, 100)}` : ""}`
                          : undefined}
                        style={{
                          left: `${widget.x / deviceWidth * 100}%`,
                          top: `${widget.y / deviceHeight * 100}%`,
                          width: `${Math.max(1, widget.width / deviceWidth * 100)}%`,
                          height: `${Math.max(1, widget.height / deviceHeight * 100)}%`,
                          minWidth: widgetScale,
                          minHeight: widgetScale,
                          background: widget.style.fill ?? "#9275e7",
                          opacity: widget.opacity,
                        }}
                      />
                    ))}
                    {screen.widgets.length === 0 && <span className="flow-empty-screen">Empty screen</span>}
                  </div>
                </button>
                <footer className="flow-node-footer">
                  <span>{screen.device?.presetId ?? "Screen"}</span>
                  <span>{screen.widgets.length} widgets</span>
                </footer>
              </article>
            );
          })}
        </div>
        {connectingFrom && (
          <div className="flow-connect-hint" role="status">
            Drag the arrow onto a destination screen. Select a widget on the source screen first.
            <button className="icon-button small-icon" onClick={() => setConnectingFrom(null)} aria-label="Cancel navigation link">
              <X size={14} />
            </button>
          </div>
        )}
        {selectedEdge && (
          <div className="flow-edge-card" role="group" aria-label="Selected navigation link">
            <div className="flow-edge-card-copy">
              <strong>{selectedEdge.label}</strong>
              <span>
                {project.screens.find((screen) => screen.id === selectedEdge.sourceScreenId)?.name}
                <ArrowRight size={12} />
                {project.screens.find((screen) => screen.id === selectedEdge.targetScreenId)?.name}
              </span>
            </div>
            <button className="button button-secondary flow-tool-button" onClick={() => editEdgeRule(selectedEdge)}>
              Edit interaction
            </button>
            <button className="button button-secondary flow-tool-button" onClick={() => deleteEdge(selectedEdge)}>
              <Trash2 size={13} /> Delete link
            </button>
            <button className="icon-button small-icon" onClick={() => setSelectedEdgeId(null)} aria-label="Close link details">
              <X size={14} />
            </button>
          </div>
        )}
        <div className="flow-zoom-controls" role="group" aria-label="Flow zoom controls">
          <button className="icon-button small-icon" aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(0.35, value - 0.1))}><ZoomOut size={14} /></button>
          <span>{Math.round(zoom * 100)}%</span>
          <button className="icon-button small-icon" aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(2, value + 0.1))}><ZoomIn size={14} /></button>
          <button className="icon-button small-icon" aria-label="Reset flow zoom and pan" onClick={() => { setZoom(1); setPan({ x: 24, y: 24 }); }}><RotateCcw size={14} /></button>
        </div>
      </div>
      <p className="flow-help">
        Drag screen headers to arrange · drag a link handle to another screen · click a screen to open Design
      </p>
    </section>
  );
}
