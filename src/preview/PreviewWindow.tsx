import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ChangeEvent, TouchEvent } from "react";
import { ArrowLeft, RotateCcw, SlidersHorizontal, X } from "lucide-react";
import { emit, listen } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import type { Project, Widget } from "../project/schema";
import { parseProject } from "../project/schema";
import {
  collectWidgetsDeep,
  flattenActivePanelWidgets,
  getPanelStates,
} from "../project/dynamicPanels";
import {
  getRepeaterDataset,
  getRepeaterTemplate,
  interpolateItem,
  isRepeaterItemVisible,
  type RepeaterRecord,
} from "../project/repeaters";
import { DEVICE_PRESETS } from "../devices/catalog";
import { getPreviewWindowSize } from "./windowSizing";
import {
  PreviewRuntime,
  type PreviewEvent,
  type PreviewRuntimeSnapshot,
} from "./runtime";

const PREVIEW_CHANNEL = "protoflow-preview";

function stringProp(widget: Widget, key: string, fallback = ""): string {
  const value = widget.props[key];
  return typeof value === "string" ? value : fallback;
}

function getWidgetText(
  widget: Widget,
  runtime: PreviewRuntime,
  screenId: string,
  item?: RepeaterRecord,
): string {
  const text = stringProp(
    widget,
    "text",
    stringProp(widget, "label", stringProp(widget, "title", "")),
  );
  return runtime.interpolate(item ? interpolateItem(text, item) : text, screenId);
}

function widgetStyle(widget: Widget): CSSProperties {
  const fill = widget.style.fill;
  const stroke = widget.style.stroke;
  const radius = widget.style.cornerRadius;
  const textWidget = ["text", "label", "paragraph", "link", "code"].includes(widget.type);
  return {
    position: "absolute",
    left: widget.x,
    top: widget.y,
    width: widget.width,
    height: widget.height,
    zIndex: widget.zIndex,
    transform: widget.rotation ? `rotate(${widget.rotation}deg)` : undefined,
    opacity: widget.opacity,
    boxSizing: "border-box",
    backgroundColor: textWidget || fill === null ? "transparent" : fill,
    color: typeof widget.props.color === "string"
      ? widget.props.color
      : textWidget && fill
        ? fill
        : "#24212b",
    border: stroke ? `${widget.style.strokeWidth ?? 1}px solid ${stroke}` : "none",
    borderRadius: Array.isArray(radius)
      ? `${radius[0]}px ${radius[1]}px ${radius[2]}px ${radius[3]}px`
      : radius,
    fontFamily: stringProp(widget, "fontFamily", "Arial, sans-serif"),
    fontSize: typeof widget.props.fontSize === "number" ? widget.props.fontSize : 16,
    fontWeight: typeof widget.props.fontWeight === "string" ? widget.props.fontWeight : "normal",
    fontStyle: typeof widget.props.fontStyle === "string" ? widget.props.fontStyle : "normal",
    textAlign: typeof widget.props.align === "string" ? widget.props.align as CSSProperties["textAlign"] : "left",
    textDecoration: widget.props.underline === true ? "underline" : undefined,
    whiteSpace: "pre-wrap",
    overflow: "hidden",
    padding: typeof widget.props.padding === "number" ? widget.props.padding : 8,
  };
}

function PreviewWidget({
  widget,
  runtime,
  screenId,
  snapshot,
  runEvent,
  onError,
  transitionStyle,
  item,
}: {
  widget: Widget;
  runtime: PreviewRuntime;
  screenId: string;
  snapshot: PreviewRuntimeSnapshot;
  runEvent: (widget: Widget, event: PreviewEvent, item?: RepeaterRecord) => void;
  onError: (error: unknown) => void;
  transitionStyle?: CSSProperties;
  item?: RepeaterRecord;
}) {
  const [inputValue, setInputValue] = useState(stringProp(widget, "value"));
  const [checked, setChecked] = useState(
    widget.type === "checkbox"
      ? widget.props.checked === true
      : widget.type === "radio" ? widget.props.selected === true : widget.props.on === true,
  );
  const style = { ...widgetStyle(widget), ...transitionStyle };
  const text = getWidgetText(widget, runtime, screenId, item);
  const commonHandlers = {
    onClick: () => runEvent(widget, "onClick", item),
    onMouseEnter: () => runEvent(widget, "onHover", item),
    onTouchStart: (_event: TouchEvent<HTMLElement>) => runEvent(widget, "onTouchStart", item),
    onTouchEnd: (_event: TouchEvent<HTMLElement>) => runEvent(widget, "onTouchEnd", item),
  };
  const handleChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const value = event.currentTarget.value;
    setInputValue(value);
    const variableName = stringProp(widget, "variableName", stringProp(widget, "variable"));
    if (variableName) {
      const definition = runtime.snapshot().variables.find((entry) => entry.variable.name === variableName)?.variable;
      if (definition) {
        try {
          runtime.updateBoundVariable(widget, definition.type === "number" ? Number(value) : value);
        } catch (error) {
          console.error("Could not update the preview variable from the input.", error);
          onError(error);
        }
      }
    }
    runEvent(widget, "onChange", item);
  };

  if (widget.type === "input" || widget.type === "search" || widget.type === "textarea") {
    const tag = widget.type;
    const placeholderValue = stringProp(widget, "placeholder", "Enter text...");
    const placeholder = runtime.interpolate(item ? interpolateItem(placeholderValue, item) : placeholderValue, screenId);
    return (
      <label className="preview-widget-label" style={{ ...style, overflow: "visible" }} {...commonHandlers}>
        {stringProp(widget, "label") && <span>{runtime.interpolate(item ? interpolateItem(stringProp(widget, "label"), item) : stringProp(widget, "label"), screenId)}</span>}
        {tag === "textarea"
          ? <textarea aria-label={stringProp(widget, "label", "Preview text")} value={inputValue} placeholder={placeholder} onChange={handleChange} />
          : <input aria-label={stringProp(widget, "label", "Preview input")} type={tag === "search" ? "search" : stringProp(widget, "type", "text")} value={inputValue} placeholder={placeholder} onChange={handleChange} />}
      </label>
    );
  }

  if (["checkbox", "toggle", "radio"].includes(widget.type)) {
    const rawLabel = stringProp(widget, "label", widget.type);
    const label = runtime.interpolate(item ? interpolateItem(rawLabel, item) : rawLabel, screenId);
    return (
      <label className={`preview-widget-choice is-${widget.type}`} style={style} {...commonHandlers}>
        <input
          aria-label={label}
          type={widget.type === "radio" ? "radio" : "checkbox"}
          checked={checked}
          onChange={(event) => {
            setChecked(event.currentTarget.checked);
            const variableName = stringProp(widget, "variableName", stringProp(widget, "variable"));
            if (variableName) {
              try {
                runtime.updateBoundVariable(widget, event.currentTarget.checked);
              } catch (error) {
                console.error("Could not update the preview variable from the control.", error);
                onError(error);
              }
            }
            runEvent(widget, "onChange", item);
          }}
        />
        {label}
      </label>
    );
  }

  if (widget.type === "image") {
    const source = stringProp(widget, "src", stringProp(widget, "url"));
    const src = runtime.interpolate(item ? interpolateItem(source, item) : source, screenId);
    return (
      <div className="preview-widget" style={style} {...commonHandlers}>
        {src ? <img src={src} alt={runtime.interpolate(stringProp(widget, "alt", text), screenId)} /> : text || "Image"}
      </div>
    );
  }

  if (widget.type === "button" || widget.type === "icon-button") {
    return <button className={`preview-widget is-button is-${stringProp(widget, "variant", "primary")}`} style={style} onClick={commonHandlers.onClick} onMouseEnter={commonHandlers.onMouseEnter} onTouchStart={commonHandlers.onTouchStart} onTouchEnd={commonHandlers.onTouchEnd}>{text || "Button"}</button>;
  }

  if (widget.type === "list") {
    const items = Array.isArray(widget.props.items)
      ? widget.props.items.filter((item): item is string => typeof item === "string")
      : [];
    return (
      <ul className="preview-widget preview-list" style={style} {...commonHandlers}>
        {items.map((item, index) => <li key={`${index}-${item}`}>{runtime.interpolate(item, screenId)}</li>)}
      </ul>
    );
  }

  if (widget.type === "repeater") {
    const activeData = snapshot.repeaterData[widget.id];
    const rows = Array.isArray(activeData) ? activeData as RepeaterRecord[] : getRepeaterDataset(widget);
    const template = getRepeaterTemplate(widget);
    const layout = widget.props.layout === "horizontal" || widget.props.layout === "grid"
      ? widget.props.layout
      : "vertical";
    const gap = typeof widget.props.gap === "number" ? Math.max(0, widget.props.gap) : 8;
    const rowStyle: CSSProperties = layout === "grid"
      ? {
          display: "grid",
          gridTemplateColumns: `repeat(auto-fill, minmax(${Math.max(120, widget.width / 2)}px, 1fr))`,
          gap,
          alignContent: "start",
          overflow: "visible",
        }
      : {
          display: "flex",
          flexDirection: layout === "horizontal" ? "row" : "column",
          gap,
          overflow: "visible",
        };
    return (
      <div
        className={`preview-widget preview-repeater is-${layout}`}
        data-widget-type="repeater"
        style={{ ...style, height: layout === "horizontal" ? widget.height : Math.max(widget.height, rows.length * (widget.height + gap)), overflow: "visible", ...rowStyle }}
        onMouseEnter={commonHandlers.onMouseEnter}
        onTouchStart={commonHandlers.onTouchStart}
        onTouchEnd={commonHandlers.onTouchEnd}
      >
        {rows.map((record, index) => (
          <div className="preview-repeater-row" key={`${widget.id}-${index}`} style={{
            position: "relative",
            flex: layout === "horizontal" ? `0 0 ${widget.width}px` : "0 0 auto",
            width: widget.width,
            height: widget.height,
            overflow: "hidden",
          }} onClick={() => runEvent(widget, "onClick", record)}>
            {template
              .filter((child) => child.visible && snapshot.visibility[child.id] !== false && isRepeaterItemVisible(child, record))
              .map((child) => (
                <PreviewWidget
                  key={`${child.id}-${index}`}
                  widget={child}
                  runtime={runtime}
                  screenId={screenId}
                  snapshot={snapshot}
                  runEvent={runEvent}
                  onError={onError}
                  item={record}
                />
              ))}
          </div>
        ))}
      </div>
    );
  }

  const panelState = snapshot.panelStates[widget.id];
  const repeater = snapshot.repeaterData[widget.id];
  const stateName = getPanelStates(widget).find((state) => state.id === panelState)?.name;
  const stateLabel = stateName ? ` · ${stateName}` : "";
  const repeaterLabel = repeater === undefined
    ? ""
    : ` · ${Array.isArray(repeater) ? repeater.length : "updated"} rows`;
  const shapeClass = ["ellipse", "circle"].includes(widget.type)
    ? " is-ellipse"
    : widget.type === "line" ? " is-line" : "";
  return (
    <div
      className={`preview-widget${shapeClass}`}
      data-widget-type={widget.type}
      data-panel-state={panelState}
      data-repeater-data={repeater === undefined ? undefined : JSON.stringify(repeater)}
      style={style}
      {...commonHandlers}
    >
      {text || widget.type.replaceAll("-", " ")}{stateLabel}{repeaterLabel}
    </div>
  );
}

export function PreviewWindow() {
  const [project, setProject] = useState<Project | null>(null);
  const [runtimeSnapshot, setRuntimeSnapshot] = useState<PreviewRuntimeSnapshot | null>(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [showDeviceFrame, setShowDeviceFrame] = useState(true);
  const [showVariables, setShowVariables] = useState(false);
  const [toast, setToast] = useState("");
  const [runtimeRevision, setRuntimeRevision] = useState(0);
  const [scale, setScale] = useState(1);
  const runtimeRef = useRef<PreviewRuntime | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const loadedScreenRef = useRef("");
  const activeScreen = useMemo(
    () => project?.screens.find((screen) => screen.id === runtimeSnapshot?.screenId),
    [project, runtimeSnapshot?.screenId],
  );
  const device = useMemo(
    () => DEVICE_PRESETS.find((item) =>
      item.id === (selectedDeviceId || activeScreen?.device?.presetId),
    ) ?? DEVICE_PRESETS.find((item) =>
      item.viewport.width === activeScreen?.device?.width &&
      item.viewport.height === activeScreen?.device?.height,
    ) ?? DEVICE_PRESETS[0],
    [activeScreen?.device?.height, activeScreen?.device?.presetId, activeScreen?.device?.width, selectedDeviceId],
  );

  const applyProject = useCallback((raw: unknown) => {
    try {
      const nextProject = parseProject(raw);
      setProject(nextProject);
      if (runtimeRef.current) {
        runtimeRef.current.updateProject(nextProject);
      } else {
        runtimeRef.current = new PreviewRuntime(nextProject);
      }
      setRuntimeSnapshot(runtimeRef.current.snapshot());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not load the preview project.";
      console.error("Preview project update was rejected.", error);
      setToast(message);
    }
  }, []);

  useEffect(() => {
    if (isTauri()) {
      let unlisten: (() => void) | undefined;
      let disposed = false;
      const setup = async () => {
        const stopListening = await listen<unknown>("preview:project", (event) => applyProject(event.payload));
        if (disposed) {
          stopListening();
          return;
        }
        unlisten = stopListening;
        await emit("preview:ready");
      };
      void setup().catch((error: unknown) => {
        console.error("Could not initialize preview IPC.", error);
        setToast(error instanceof Error ? error.message : "Could not connect to the editor.");
      });
      return () => {
        disposed = true;
        unlisten?.();
        void emit("preview:closed").catch((error: unknown) => {
          console.error("Could not notify the editor that preview closed.", error);
        });
      };
    }
    const channel = new BroadcastChannel(PREVIEW_CHANNEL);
    channelRef.current = channel;
    channel.onmessage = (event: MessageEvent<{ type?: string; project?: unknown }>) => {
      if (event.data?.type === "project") applyProject(event.data.project);
      if (event.data?.type === "ready") {
        channel.postMessage({ type: "preview-ready" });
      }
    };
    channel.postMessage({ type: "preview-ready" });
    return () => {
      channel.postMessage({ type: "preview-closed" });
      channel.close();
      channelRef.current = null;
    };
  }, [applyProject]);

  useEffect(() => {
    const updateScale = () => {
      setScale(Math.min(
        1,
        (window.innerWidth - 36) / device.viewport.width,
        (window.innerHeight - 132) / device.viewport.height,
      ));
    };
    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, [device.viewport.height, device.viewport.width]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 5000);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const runEvent = useCallback((widget: Widget, event: PreviewEvent, item?: RepeaterRecord) => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const errors = runtime.runEvent(widget, event, item);
    setRuntimeSnapshot(runtime.snapshot());
    setRuntimeRevision((revision) => revision + 1);
    if (errors.length > 0) {
      console.error("Preview interaction errors.", errors);
      setToast(errors.join(" "));
    }
  }, []);

  useEffect(() => {
    if (!project || !runtimeRef.current) return;
    const screen = project.screens.find((item) => item.id === runtimeRef.current?.currentScreenId);
    if (!screen || loadedScreenRef.current === screen.id) return;
    loadedScreenRef.current = screen.id;
    for (const widget of flattenActivePanelWidgets(
      screen.widgets,
      runtimeRef.current.snapshot().panelStates,
    )) runEvent(widget, "onLoad");
  }, [project, runtimeSnapshot?.screenId, runtimeRevision, runEvent]);

  const restart = () => {
    if (!runtimeRef.current) return;
    loadedScreenRef.current = "";
    runtimeRef.current.restart();
    setRuntimeSnapshot(runtimeRef.current.snapshot());
    setRuntimeRevision((revision) => revision + 1);
    setToast("");
  };

  const changeScreen = (screenId: string) => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    try {
      runtime.navigate(screenId);
      const target = project?.screens.find((screen) => screen.id === screenId);
      setSelectedDeviceId(target?.device?.presetId ?? "");
      loadedScreenRef.current = "";
      setRuntimeSnapshot(runtime.snapshot());
      setRuntimeRevision((revision) => revision + 1);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Could not change preview screen.");
    }
  };

  const goBack = () => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.back();
    loadedScreenRef.current = "";
    setRuntimeSnapshot(runtime.snapshot());
    setRuntimeRevision((revision) => revision + 1);
  };

  const changeDevice = (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    if (isTauri()) {
      const selected = DEVICE_PRESETS.find((item) => item.id === deviceId);
      if (selected) {
        void currentMonitor().then((monitor) => {
          const size = getPreviewWindowSize(selected.viewport, monitor);
          return getCurrentWindow().setSize(new LogicalSize(size.width, size.height));
        }).catch((error: unknown) => {
          console.error("Could not resize the preview window for this device.", error);
          setToast(error instanceof Error ? error.message : "Could not resize the preview window.");
        });
      }
    }
  };

  if (!project || !runtimeSnapshot || !activeScreen) {
    return <main className="preview-loading" aria-live="polite">Waiting for the editor to send a project…</main>;
  }

  const nestedWidgets = collectWidgetsDeep(activeScreen.widgets);
  const visibleWidgets = flattenActivePanelWidgets(activeScreen.widgets, runtimeSnapshot.panelStates);
  const previewWidget = (widget: Widget) => (
    runtimeSnapshot.visibility[widget.id] !== false && (
      <PreviewWidget
        key={widget.id}
        widget={widget}
        runtime={runtimeRef.current!}
        screenId={activeScreen.id}
        snapshot={runtimeSnapshot}
        runEvent={runEvent}
        onError={(error) => setToast(error instanceof Error ? error.message : "Preview control failed.")}
        transitionStyle={(() => {
          const parent = widget.groupId
            ? nestedWidgets.find((candidate) => candidate.id === widget.groupId)
            : undefined;
          const transition = parent
            ? runtimeSnapshot.panelTransitions[parent.id]
            : undefined;
          return transition && transition.transition !== "none" && transition.duration > 0
            ? {
                animation: `protoflow-panel-${transition.transition} ${transition.duration}ms ease both`,
              }
            : undefined;
        })()}
      />
    )
  );

  return (
    <main className="preview-app">
      <header className="preview-toolbar">
        <button type="button" aria-label="Back" title="Back" disabled={runtimeSnapshot.backStack.length === 0} onClick={goBack}><ArrowLeft size={15} /></button>
        <select aria-label="Preview screen" value={activeScreen.id} onChange={(event) => changeScreen(event.currentTarget.value)}>
          {project.screens.map((screen) => <option key={screen.id} value={screen.id}>{screen.name}</option>)}
        </select>
        <button type="button" aria-label="Restart preview" title="Restart preview" onClick={restart}><RotateCcw size={15} /></button>
        <select aria-label="Device preset" value={device.id} onChange={(event) => changeDevice(event.currentTarget.value)}>
          <optgroup label="Desktop">{DEVICE_PRESETS.filter((item) => item.category === "desktop").map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</optgroup>
          <optgroup label="Tablet">{DEVICE_PRESETS.filter((item) => item.category === "tablet").map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</optgroup>
          <optgroup label="Mobile">{DEVICE_PRESETS.filter((item) => item.category === "phone").map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</optgroup>
        </select>
        <button type="button" aria-label="Toggle device frame" aria-pressed={showDeviceFrame} title="Toggle device frame" onClick={() => setShowDeviceFrame((value) => !value)}><span className="preview-device-icon">▣</span></button>
        <button type="button" aria-label="Toggle variables" aria-pressed={showVariables} title="Runtime variables" onClick={() => setShowVariables((value) => !value)}><SlidersHorizontal size={15} /></button>
        {isTauri() && <button type="button" aria-label="Detach preview" title="Detach preview window" onClick={() => void getCurrentWindow().setFocus().catch((error: unknown) => {
          console.error("Could not focus the preview window.", error);
          setToast(error instanceof Error ? error.message : "Could not focus the preview window.");
        })}><X size={15} /></button>}
      </header>
      <div className="preview-content">
        <div
          className={`preview-device${showDeviceFrame ? " has-frame" : ""}`}
          style={{
            width: device.viewport.width * scale,
            height: device.viewport.height * scale,
          }}
        >
          <div
            className="preview-screen"
            style={{
              width: device.viewport.width,
              height: device.viewport.height,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
            }}
          >
            {visibleWidgets
              .slice()
              .sort((first, second) => first.zIndex - second.zIndex)
              .map(previewWidget)}
          </div>
        </div>
        {showVariables && (
          <aside className="preview-variable-inspector" aria-label="Runtime variables">
            <strong>Runtime variables</strong>
            {runtimeSnapshot.variables.length === 0
              ? <p>No variables in this project.</p>
              : runtimeSnapshot.variables.map(({ variable, value }) => (
                  <label key={variable.id}>
                    <span>{variable.name}<small>{variable.scope} · {variable.type}</small></span>
                    {variable.type === "boolean"
                      ? <input type="checkbox" checked={value === true} onChange={(event) => {
                          try {
                            runtimeRef.current?.setVariable(variable.name, event.currentTarget.checked, activeScreen.id);
                            setRuntimeSnapshot(runtimeRef.current?.snapshot() ?? null);
                          } catch (error) {
                            setToast(error instanceof Error ? error.message : "Could not update variable.");
                          }
                        }} />
                      : <input type={variable.type === "number" ? "number" : "text"} value={String(value)} onChange={(event) => {
                          const nextValue = variable.type === "number"
                            ? Number(event.currentTarget.value)
                            : event.currentTarget.value;
                          try {
                            runtimeRef.current?.setVariable(variable.name, nextValue, activeScreen.id);
                            setRuntimeSnapshot(runtimeRef.current?.snapshot() ?? null);
                          } catch (error) {
                            setToast(error instanceof Error ? error.message : "Could not update variable.");
                          }
                        }} />}
                  </label>
                ))}
          </aside>
        )}
      </div>
      <footer className="preview-status">
        <span>{activeScreen.name}</span>
        <span>{device.name} · {device.viewport.width} × {device.viewport.height}</span>
      </footer>
      {toast && <div className="preview-toast" role="alert">{toast}</div>}
    </main>
  );
}
