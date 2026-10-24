import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ChangeEvent, MouseEvent, ReactNode, TouchEvent } from "react";
import { ArrowLeft, Camera, RotateCcw, RotateCw, SlidersHorizontal, X } from "lucide-react";
import { toPng } from "html-to-image";
import { emit, listen } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import type { Project, Widget } from "../project/schema";
import { parseProject } from "../project/schema";
import {
  normalizeRichTextRuns,
  parseRichTextMarkdown,
  sanitizeRichTextHref,
} from "../project/richText";
import {
  collectWidgetsDeep,
  flattenActivePanelWidgets,
  getPanelStates,
} from "../project/dynamicPanels";
import {
  getRepeaterDataset,
  getRepeaterTemplate,
  isRepeaterItemVisible,
  type RepeaterRecord,
} from "../project/repeaters";
import { getAutoLayoutPositions, type WidgetPosition } from "../project/widgetLayout";
import { getPreviewIconComponent } from "./widgetIcons";
import { DEVICE_PRESETS, findDevicePreset } from "../devices/catalog";
import type { DevicePreset } from "../devices/types";
import { getPreviewWindowSize } from "./windowSizing";
import {
  DEFAULT_MULTI_DEVICE_IDS,
  getPreviewViewport,
  resolvePreviewWidgets,
} from "./deviceLayouts";
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
  return runtime.interpolate(text, screenId, item, widget);
}

function widgetStyle(widget: Widget, position?: WidgetPosition): CSSProperties {
  const fill = widget.style.fill;
  const stroke = widget.style.stroke;
  const radius = widget.style.cornerRadius;
  const textWidget = ["text", "heading", "label", "paragraph", "link", "code"].includes(widget.type);
  return {
    position: "absolute",
    left: position?.x ?? widget.x,
    top: position?.y ?? widget.y,
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
    lineHeight: typeof widget.props.lineHeight === "number" ? widget.props.lineHeight : undefined,
    letterSpacing: typeof widget.props.letterSpacing === "number" ? widget.props.letterSpacing : undefined,
    textAlign: typeof widget.props.align === "string" ? widget.props.align as CSSProperties["textAlign"] : "left",
    textDecoration: widget.props.underline === true ? "underline" : undefined,
    whiteSpace: "pre-wrap",
    overflow: "hidden",
    padding: typeof widget.props.padding === "number" ? widget.props.padding : textWidget ? 0 : 8,
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
  layoutPosition,
  controlValues,
  onControlValueChange,
  onGestureFeedback,
}: {
  widget: Widget;
  runtime: PreviewRuntime;
  screenId: string;
  snapshot: PreviewRuntimeSnapshot;
  runEvent: (widget: Widget, event: PreviewEvent, item?: RepeaterRecord) => void;
  onError: (error: unknown) => void;
  transitionStyle?: CSSProperties;
  item?: RepeaterRecord;
  layoutPosition?: WidgetPosition;
  controlValues: Record<string, string | boolean>;
  onControlValueChange: (key: string, value: string | boolean) => void;
  onGestureFeedback: (event: PreviewEvent, x: number, y: number) => void;
}) {
  const touchStart = useRef<{ x: number; y: number; distance?: number; centerX?: number; centerY?: number } | null>(null);
  const longPressTimer = useRef<number | undefined>(undefined);
  const longPressFired = useRef(false);
  const multiTouchFired = useRef(false);
  const lastTap = useRef(0);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => () => window.clearTimeout(longPressTimer.current), []);
  const controlKey = item ? `${widget.id}:${JSON.stringify(item)}` : widget.id;
  const storedControlValue = controlValues[controlKey];
  const inputValue = typeof storedControlValue === "string"
    ? storedControlValue
    : stringProp(widget, "value");
  const checked = typeof storedControlValue === "boolean"
    ? storedControlValue
    : widget.type === "checkbox"
      ? widget.props.checked === true
      : widget.type === "radio" ? widget.props.selected === true : widget.props.on === true;
  const style = { ...widgetStyle(widget, layoutPosition), ...transitionStyle };
  const text = getWidgetText(widget, runtime, screenId, item);
  const richRuns = widget.type === "text" && widget.props.richText === true
    ? Array.isArray(widget.props.richTextRuns)
      ? normalizeRichTextRuns(widget.props.richTextRuns)
      : parseRichTextMarkdown(stringProp(widget, "text"))
    : [];
  const inputMode = runtime.currentScreen.inputMode;
  const fireTouch = (event: PreviewEvent, x: number, y: number) => {
    runEvent(widget, event, item);
    onGestureFeedback(event, x, y);
  };
  const commonHandlers = {
    onClick: (event: MouseEvent<HTMLElement>) => {
      if (inputMode !== "touch" || event.detail === 0) runEvent(widget, "onClick", item);
    },
    onDoubleClick: () => {
      if (inputMode !== "touch") runEvent(widget, "onDoubleClick", item);
    },
    onContextMenu: (event: MouseEvent<HTMLElement>) => {
      if (inputMode === "touch") return;
      event.preventDefault();
      runEvent(widget, "onRightClick", item);
    },
    onMouseEnter: () => {
      if (inputMode !== "touch") runEvent(widget, "onHover", item);
    },
    onMouseDown: () => {
      if (inputMode !== "touch") runEvent(widget, "onMouseDown", item);
    },
    onMouseUp: () => {
      if (inputMode !== "touch") runEvent(widget, "onMouseUp", item);
    },
    onFocus: () => runEvent(widget, "onFocus", item),
    onBlur: () => runEvent(widget, "onBlur", item),
    onKeyDown: () => {
      runEvent(widget, "onKeyDown", item);
    },
    onTouchStart: (event: TouchEvent<HTMLElement>) => {
      if (inputMode === "mouse") return;
      runEvent(widget, "onTouchStart", item);
      const touches = event.touches;
      if (touches.length >= 2) {
        const first = touches[0];
        const second = touches[1];
        const x = (first.clientX + second.clientX) / 2;
        const y = (first.clientY + second.clientY) / 2;
        touchStart.current = {
          x, y,
          distance: Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY),
          centerX: x, centerY: y,
        };
        multiTouchFired.current = false;
        window.clearTimeout(longPressTimer.current);
        return;
      }
      const touch = touches[0];
      if (!touch) return;
      touchStart.current = { x: touch.clientX, y: touch.clientY };
      onGestureFeedback("onTouchStart", touch.clientX, touch.clientY);
      longPressFired.current = false;
      multiTouchFired.current = false;
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = window.setTimeout(() => {
        if (!touchStart.current) return;
        longPressFired.current = true;
        fireTouch("onLongPress", touchStart.current.x, touchStart.current.y);
      }, 550);
    },
    onTouchMove: (event: TouchEvent<HTMLElement>) => {
      if (inputMode === "mouse" || !touchStart.current) return;
      const start = touchStart.current;
      if (event.touches.length >= 2 && start.distance !== undefined) {
        const first = event.touches[0];
        const second = event.touches[1];
        const distance = Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
        const centerX = (first.clientX + second.clientX) / 2;
        const centerY = (first.clientY + second.clientY) / 2;
        if (!multiTouchFired.current && Math.abs(distance - start.distance) > 24) {
          multiTouchFired.current = true;
          fireTouch(distance < start.distance ? "onPinchIn" : "onPinchOut", centerX, centerY);
        } else if (!multiTouchFired.current &&
          Math.hypot(centerX - (start.centerX ?? centerX), centerY - (start.centerY ?? centerY)) > 18) {
          multiTouchFired.current = true;
          fireTouch("onPan", centerX, centerY);
        }
        return;
      }
      const touch = event.touches[0];
      if (touch && Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > 12) {
        window.clearTimeout(longPressTimer.current);
      }
    },
    onTouchEnd: (event: TouchEvent<HTMLElement>) => {
      if (inputMode === "mouse") return;
      runEvent(widget, "onTouchEnd", item);
      window.clearTimeout(longPressTimer.current);
      const start = touchStart.current;
      const touch = event.changedTouches[0];
      touchStart.current = null;
      if (!start || !touch || start.distance !== undefined || longPressFired.current || multiTouchFired.current) return;
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) > 40) {
        const swipe: PreviewEvent = Math.abs(dx) > Math.abs(dy)
          ? dx < 0 ? "onSwipeLeft" : "onSwipeRight"
          : dy < 0 ? "onSwipeUp" : "onSwipeDown";
        fireTouch(swipe, touch.clientX, touch.clientY);
        return;
      }
      const now = Date.now();
      if (now - lastTap.current < 320) {
        lastTap.current = 0;
        fireTouch("onDoubleTap", touch.clientX, touch.clientY);
      } else {
        lastTap.current = now;
        fireTouch("onTap", touch.clientX, touch.clientY);
      }
    },
  };

  if (dismissed) return null;

  if (widget.type === "card") {
    const imageSource = stringProp(widget, "imageSrc", stringProp(widget, "src"));
    const title = runtime.interpolate(stringProp(widget, "title", text || "Product card"), screenId, item, widget);
    const subtitle = runtime.interpolate(stringProp(widget, "subtitle", "A short description goes here."), screenId, item, widget);
    const actionLabel = runtime.interpolate(stringProp(widget, "actionLabel", "Learn more"), screenId, item, widget);
    return (
      <article className="preview-widget preview-card" style={style} {...commonHandlers}>
        <div className="preview-card-media">
          {imageSource
            ? <img src={runtime.interpolate(imageSource, screenId, item, widget)} alt={stringProp(widget, "imageAlt", title)} />
            : <span aria-hidden="true">Image</span>}
        </div>
        <div className="preview-card-copy">
          <h3>{title}</h3>
          <p>{subtitle}</p>
          <button type="button" tabIndex={-1}>{actionLabel}</button>
        </div>
      </article>
    );
  }

  if (widget.type === "chart") {
    const values = (Array.isArray(widget.props.values) ? widget.props.values : [38, 68, 50, 88, 62])
      .slice(0, 8)
      .map((value) => typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0);
    const maxValue = Math.max(1, ...values);
    const titleId = `${widget.id}-chart-title`;
    const chartType = stringProp(widget, "chartType", "bar");
    const points = values.map((value, index) =>
      `${12 + index * (176 / Math.max(1, values.length - 1))},${88 - value / maxValue * 70}`,
    ).join(" ");
    const total = values.reduce((sum, value) => sum + value, 0) || 1;
    let pieOffset = 0;
    return (
      <figure className="preview-widget preview-chart" style={style} {...commonHandlers}>
        <figcaption id={titleId}>{text || "Chart"}</figcaption>
        <svg viewBox="0 0 200 100" role="img" aria-labelledby={titleId}>
          {chartType === "line"
            ? <polyline points={points} fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
            : chartType === "pie"
              ? values.map((value, index) => {
                  const segment = (
                    <circle
                      key={index}
                      cx="100"
                      cy="52"
                      r="34"
                      fill="none"
                      stroke={["#8b69ed", "#55b6a8", "#e39b54", "#6579d8", "#ce6b83"][index % 5]}
                      strokeWidth="22"
                      strokeDasharray={`${value / total * 214} 214`}
                      strokeDashoffset={-pieOffset}
                      transform="rotate(-90 100 52)"
                    />
                  );
                  pieOffset += value / total * 214;
                  return segment;
                })
              : values.map((value, index) => {
                  const width = 18;
                  const height = value / maxValue * 70;
                  return (
                    <rect
                      key={index}
                      x={12 + index * 23}
                      y={88 - height}
                      width={width}
                      height={height}
                      rx="3"
                      fill={index === 0 ? "#8b69ed" : "#55b6a8"}
                    />
                  );
                })}
        </svg>
      </figure>
    );
  }

  if (widget.type === "alert") {
    const variant = stringProp(widget, "variant", "info");
    return (
      <aside className={`preview-widget preview-alert is-${variant}`} role={variant === "error" ? "alert" : "status"} style={style} {...commonHandlers}>
        <span className="preview-alert-icon" aria-hidden="true">!</span>
        <span className="preview-alert-copy">
          <strong>{runtime.interpolate(stringProp(widget, "label", "Changes saved"), screenId, item, widget)}</strong>
          <span>{runtime.interpolate(stringProp(widget, "subtitle", ""), screenId, item, widget)}</span>
        </span>
        {widget.props.dismissible === true && (
          <button type="button" aria-label="Dismiss alert" onClick={(event) => {
            event.stopPropagation();
            setDismissed(true);
          }}>×</button>
        )}
      </aside>
    );
  }

  if (widget.type === "skeleton") {
    return (
      <div className="preview-widget preview-skeleton" aria-busy="true" aria-label="Loading content" style={style} {...commonHandlers}>
        <span /><span /><span />
      </div>
    );
  }

  if (widget.type === "video") {
    const source = stringProp(widget, "src");
    const poster = stringProp(widget, "poster");
    return (
      <figure className="preview-widget preview-video" style={style} {...commonHandlers}>
        {source
          ? <video controls src={source} poster={poster || undefined} aria-label={text || "Video"} />
          : <div className="preview-video-placeholder" aria-label="Video preview">
              {poster ? <img src={poster} alt="" /> : <span aria-hidden="true">Video</span>}
              <span className="preview-video-play" aria-hidden="true">▶</span>
              <figcaption>{text || "Video"}</figcaption>
            </div>}
      </figure>
    );
  }

  if (widget.type === "icon" || widget.type === "custom-icon") {
    const iconName = stringProp(widget, "iconName", "Star");
    const Icon = getPreviewIconComponent(iconName);
    const color = widget.style.stroke ?? "#24212b";
    return (
      <div
        className="preview-widget preview-canvas-icon"
        role="img"
        aria-label={widget.name || `${iconName} icon`}
        style={{
          ...style,
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
          border: "none",
          backgroundColor: "transparent",
          overflow: "visible",
        }}
        {...commonHandlers}
      >
        <Icon
          width="100%"
          height="100%"
          color={color}
          strokeWidth={widget.style.strokeWidth ?? 1.8}
          aria-hidden="true"
          focusable="false"
        />
      </div>
    );
  }

  if (widget.type === "mobile-app" || widget.type === "web-app") {
    return (
      <div className={`preview-widget preview-icon-mark is-${widget.type}`} role="img" aria-label={widget.type === "mobile-app" ? "Mobile app icon" : "Web app icon"} style={style} {...commonHandlers}>
        {widget.type === "mobile-app" ? <span aria-hidden="true">▯</span> : <span aria-hidden="true">▱</span>}
      </div>
    );
  }

  if (widget.type === "spacer") {
    return <div className="preview-widget preview-spacer" aria-hidden="true" style={style} {...commonHandlers} />;
  }

  if (widget.type === "flex-row" || widget.type === "flex-column" || widget.type === "container") {
    return (
      <section
        className={`preview-widget preview-layout is-${widget.type}`}
        aria-label={stringProp(widget, "label", widget.type.replaceAll("-", " "))}
        style={{
          ...style,
          display: widget.type === "container" ? "block" : "flex",
          flexDirection: widget.type === "flex-row" ? "row" : "column",
          gap: typeof widget.props.gap === "number" ? widget.props.gap : 12,
          padding: typeof widget.props.padding === "number" ? widget.props.padding : 12,
          alignItems: stringProp(widget, "alignItems", "center"),
          justifyContent: stringProp(widget, "justifyContent", "flex-start"),
        }}
        {...commonHandlers}
      >
        <span className="preview-layout-label">{stringProp(widget, "label", widget.type.replaceAll("-", " "))}</span>
      </section>
    );
  }
  const handleChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const value = event.currentTarget.value;
    onControlValueChange(controlKey, value);
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
    const placeholder = runtime.interpolate(placeholderValue, screenId, item, widget);
    return (
      <label className="preview-widget-label" style={{ ...style, overflow: "visible" }} {...commonHandlers}>
        {stringProp(widget, "label") && <span>{runtime.interpolate(stringProp(widget, "label"), screenId, item, widget)}</span>}
        {tag === "textarea"
          ? <textarea aria-label={stringProp(widget, "label", "Preview text")} value={inputValue} placeholder={placeholder} onChange={handleChange} />
          : <input aria-label={stringProp(widget, "label", "Preview input")} type={tag === "search" ? "search" : stringProp(widget, "type", "text")} value={inputValue} placeholder={placeholder} onChange={handleChange} />}
      </label>
    );
  }

  if (["checkbox", "toggle", "radio"].includes(widget.type)) {
    const rawLabel = stringProp(widget, "label", widget.type);
    const label = runtime.interpolate(rawLabel, screenId, item, widget);
    return (
      <label className={`preview-widget-choice is-${widget.type}`} style={style} {...commonHandlers}>
        <input
          aria-label={label}
          type={widget.type === "radio" ? "radio" : "checkbox"}
          checked={checked}
          onChange={(event) => {
            onControlValueChange(controlKey, event.currentTarget.checked);
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
    const src = runtime.interpolate(source, screenId, item, widget);
    return (
      <div className="preview-widget" style={style} {...commonHandlers}>
        {src ? <img src={src} alt={runtime.interpolate(stringProp(widget, "alt", text), screenId, item, widget)} style={{ objectFit: stringProp(widget, "fit") === "cover" ? "cover" : "contain" }} /> : text || "Image"}
      </div>
    );
  }

  if (widget.type === "button" || widget.type === "icon-button") {
    return <button className={`preview-widget is-button is-${stringProp(widget, "variant", "primary")}`} style={style} {...commonHandlers}>{text || "Button"}</button>;
  }

  if (widget.type === "list") {
    const items = Array.isArray(widget.props.items)
      ? widget.props.items.filter((item): item is string => typeof item === "string")
      : [];
    return (
      <ul className="preview-widget preview-list" style={style} {...commonHandlers}>
        {items.map((item, index) => <li key={`${index}-${item}`}>{runtime.interpolate(item, screenId, undefined, widget)}</li>)}
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
        {...commonHandlers}
      >
        {rows.map((record, index) => (
          <div className="preview-repeater-row" key={`${widget.id}-${index}`} style={{
            position: "relative",
            flex: layout === "horizontal" ? `0 0 ${widget.width}px` : "0 0 auto",
            width: widget.width,
            height: widget.height,
            overflow: "hidden",
          }} onClick={() => {
            if (inputMode !== "touch") runEvent(widget, "onClick", record);
          }}>
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
                  controlValues={controlValues}
                  onControlValueChange={onControlValueChange}
                  onGestureFeedback={onGestureFeedback}
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
  const decorativeShape = ["rectangle", "ellipse", "circle", "polygon", "star", "line", "arrow"].includes(widget.type);
  return (
    <div
      className={`preview-widget${shapeClass}`}
      tabIndex={0}
      data-widget-type={widget.type}
      data-panel-state={panelState}
      data-repeater-data={repeater === undefined ? undefined : JSON.stringify(repeater)}
      style={style}
      {...commonHandlers}
    >
      {widget.type === "text" && widget.props.richText === true
        ? richRuns.flatMap((run, runIndex) => String(run.text).split("\n").flatMap((part, lineIndex, parts) => {
            if (!part) return lineIndex < parts.length - 1
              ? [<br key={`rich-break-${runIndex}-${lineIndex}`} />]
              : [];
            const marks = run.marks;
            let content: ReactNode = runtime.interpolate(part, screenId, item, widget);
            const richStyle: CSSProperties = {
              ...(marks.color ? { color: marks.color } : {}),
              ...(marks.fontSize ? { fontSize: marks.fontSize } : {}),
              ...(marks.highlight ? { backgroundColor: marks.highlight } : {}),
            };
            if (Object.keys(richStyle).length) content = <span style={richStyle}>{content}</span>;
            if (marks.code) content = <code>{content}</code>;
            if (marks.bold) content = <strong>{content}</strong>;
            if (marks.italic) content = <em>{content}</em>;
            if (marks.underline) content = <u>{content}</u>;
            if (marks.strike) content = <s>{content}</s>;
            const href = typeof marks.link === "string" ? sanitizeRichTextHref(marks.link) : null;
            if (href) content = <a href={href}>{content}</a>;
            if (marks.list === "bullet") content = <ul><li>{content}</li></ul>;
            if (marks.list === "number") content = <ol><li>{content}</li></ol>;
            return [
              content,
              ...(lineIndex < parts.length - 1 ? [<br key={`rich-break-${runIndex}-${lineIndex}`} />] : []),
            ];
          }))
        : text || (decorativeShape ? "" : widget.type.replaceAll("-", " "))}
      {stateLabel}{repeaterLabel}
    </div>
  );
}

function PreviewDeviceFrame({
  device,
  viewport,
  screenName,
  scalePercent,
  showFrame,
  inputMode,
  children,
}: {
  device: DevicePreset;
  viewport: { width: number; height: number };
  screenName: string;
  scalePercent: number;
  showFrame: boolean;
  inputMode: Project["screens"][number]["inputMode"];
  children: ReactNode;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setBounds({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const scale = bounds.width > 0 && bounds.height > 0
    ? Math.min(
        1,
        Math.max(0.01, (bounds.width - 28) / viewport.width),
        Math.max(0.01, (bounds.height - 28) / viewport.height),
      ) * scalePercent / 100
    : 0.01;

  return (
    <article className="preview-frame-card" data-device-id={device.id}>
      <header className="preview-frame-heading">
        <strong>{device.name}</strong>
        <span>{screenName} · {viewport.width} × {viewport.height}</span>
      </header>
      <div className="preview-frame-viewport" ref={viewportRef}>
        <div
          className={`preview-frame-stage${showFrame ? " has-frame" : ""}`}
          style={{
            width: viewport.width * scale,
            height: viewport.height * scale,
          }}
        >
          <div
            className="preview-screen"
            data-input-mode={inputMode}
            style={{
              width: viewport.width,
              height: viewport.height,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
            }}
          >
            {children}
          </div>
        </div>
      </div>
    </article>
  );
}

export function PreviewWindow() {
  const [project, setProject] = useState<Project | null>(null);
  const [runtimeSnapshot, setRuntimeSnapshot] = useState<PreviewRuntimeSnapshot | null>(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [previewMode, setPreviewMode] = useState<"single" | "columns" | "grid">("single");
  const [multiDeviceIds, setMultiDeviceIds] = useState<string[]>([...DEFAULT_MULTI_DEVICE_IDS]);
  const [rotated, setRotated] = useState(false);
  const [scalePercent, setScalePercent] = useState(100);
  const [showDeviceFrame, setShowDeviceFrame] = useState(true);
  const [showVariables, setShowVariables] = useState(false);
  const [toast, setToast] = useState("");
  const [touchFeedback, setTouchFeedback] = useState<{ x: number; y: number; event: PreviewEvent } | null>(null);
  const [runtimeRevision, setRuntimeRevision] = useState(0);
  const [controlValues, setControlValues] = useState<Record<string, string | boolean>>({});
  const runtimeRef = useRef<PreviewRuntime | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const loadedScreenRef = useRef("");
  const previewContentRef = useRef<HTMLDivElement>(null);
  const touchFeedbackTimer = useRef<number | undefined>(undefined);
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
  const selectedDevices = useMemo(() => {
    if (previewMode === "single") return [device];
    const ids = previewMode === "columns"
      ? DEFAULT_MULTI_DEVICE_IDS.slice(0, 3)
      : multiDeviceIds;
    return ids
      .map((id) => findDevicePreset(id))
      .filter((preset): preset is DevicePreset => Boolean(preset));
  }, [device, multiDeviceIds, previewMode]);

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
          const size = getPreviewWindowSize(getPreviewViewport(selected, rotated), monitor);
          return getCurrentWindow().setSize(new LogicalSize(size.width, size.height));
        }).catch((error: unknown) => {
          console.error("Could not resize the preview window for this device.", error);
          setToast(error instanceof Error ? error.message : "Could not resize the preview window.");
        });
      }
    }
  };

  const toggleMultiDevice = (deviceId: string, checked: boolean) => {
    if (checked && !multiDeviceIds.includes(deviceId) && multiDeviceIds.length >= 8) {
      setToast("Choose up to eight devices in the custom grid.");
      return;
    }
    setMultiDeviceIds((current) => checked
      ? current.includes(deviceId) ? current : [...current, deviceId]
      : current.filter((id) => id !== deviceId));
  };

  const captureScreenshot = async () => {
    const target = previewContentRef.current;
    if (!target) {
      setToast("The preview is not ready to capture.");
      return;
    }
    try {
      const dataUrl = await toPng(target, { pixelRatio: 2, cacheBust: true });
      const link = document.createElement("a");
      const safeName = (project?.name ?? "prototype")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "prototype";
      link.download = `${safeName}-${previewMode}-preview.png`;
      link.href = dataUrl;
      link.click();
      setToast("Preview screenshot saved as a 2× PNG.");
    } catch (error) {
      console.error("Could not capture the multi-device preview.", error);
      setToast(error instanceof Error ? error.message : "Could not capture the preview screenshot.");
    }
  };

  if (!project || !runtimeSnapshot || !activeScreen) {
    return <main className="preview-loading" aria-live="polite">Waiting for the editor to send a project…</main>;
  }

  const frames = selectedDevices.map((preset) => {
    const viewport = getPreviewViewport(preset, rotated);
    const responsiveWidgets = resolvePreviewWidgets(activeScreen, viewport);
    const layoutPositions = getAutoLayoutPositions(responsiveWidgets);
    const nestedWidgets = collectWidgetsDeep(responsiveWidgets);
    const visibleWidgets = flattenActivePanelWidgets(
      responsiveWidgets,
      runtimeSnapshot.panelStates,
    );
    return (
      <PreviewDeviceFrame
        key={preset.id}
        device={preset}
        viewport={viewport}
        screenName={activeScreen.name}
        scalePercent={scalePercent}
        showFrame={showDeviceFrame}
        inputMode={activeScreen.inputMode}
      >
        {visibleWidgets
          .filter((widget) => widget.visible && runtimeSnapshot.visibility[widget.id] !== false)
          .sort((first, second) => first.zIndex - second.zIndex)
          .map((widget) => {
            const parent = widget.groupId
              ? nestedWidgets.find((candidate) => candidate.id === widget.groupId)
              : undefined;
            const transition = parent
              ? runtimeSnapshot.panelTransitions[parent.id]
              : undefined;
            const transitionStyle = transition && transition.transition !== "none" && transition.duration > 0
              ? {
                  animation: `protoflow-panel-${transition.transition} ${transition.duration}ms ease both`,
                }
              : undefined;
            return (
              <PreviewWidget
                key={widget.id}
                widget={widget}
                runtime={runtimeRef.current!}
                screenId={activeScreen.id}
                snapshot={runtimeSnapshot}
                runEvent={runEvent}
                onError={(error) => setToast(error instanceof Error ? error.message : "Preview control failed.")}
                transitionStyle={transitionStyle}
                layoutPosition={layoutPositions.get(widget.id)}
                controlValues={controlValues}
                onControlValueChange={(key, value) => setControlValues((current) => ({
                  ...current,
                  [key]: value,
                }))}
                onGestureFeedback={(event, x, y) => {
                  const bounds = previewContentRef.current?.getBoundingClientRect();
                  if (!bounds) return;
                  setTouchFeedback({ x: x - bounds.left, y: y - bounds.top, event });
                  window.clearTimeout(touchFeedbackTimer.current);
                  touchFeedbackTimer.current = window.setTimeout(() => setTouchFeedback(null), 700);
                }}
              />
            );
          })}
      </PreviewDeviceFrame>
    );
  });

  return (
    <main className="preview-app">
      <header className="preview-toolbar">
        <button type="button" aria-label="Back" title="Back" disabled={runtimeSnapshot.backStack.length === 0} onClick={goBack}><ArrowLeft size={15} /></button>
        <select aria-label="Preview screen" value={activeScreen.id} onChange={(event) => changeScreen(event.currentTarget.value)}>
          {project.screens.map((screen) => <option key={screen.id} value={screen.id}>{screen.name}</option>)}
        </select>
        <button type="button" aria-label="Restart preview" title="Restart preview" onClick={restart}><RotateCcw size={15} /></button>
        <select
          className="preview-mode-picker"
          aria-label="Preview layout"
          value={previewMode}
          onChange={(event) => setPreviewMode(event.currentTarget.value as typeof previewMode)}
        >
          <option value="single">Single device</option>
          <option value="columns">Desktop · tablet · mobile</option>
          <option value="grid">Custom device grid</option>
        </select>
        {previewMode === "single" ? (
          <select className="preview-device-select" aria-label="Device preset" value={device.id} onChange={(event) => changeDevice(event.currentTarget.value)}>
            <optgroup label="Desktop">{DEVICE_PRESETS.filter((item) => item.category === "desktop").map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</optgroup>
            <optgroup label="Tablet">{DEVICE_PRESETS.filter((item) => item.category === "tablet").map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</optgroup>
            <optgroup label="Mobile">{DEVICE_PRESETS.filter((item) => item.category === "phone").map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</optgroup>
          </select>
        ) : (
          <details className="preview-device-selection">
            <summary>{previewMode === "columns" ? "3 devices" : `${selectedDevices.length} devices · choose`}</summary>
            {previewMode === "grid" && (
              <div className="preview-device-menu">
                {DEVICE_PRESETS.map((preset) => (
                  <label key={preset.id}>
                    <input
                      type="checkbox"
                      checked={multiDeviceIds.includes(preset.id)}
                      onChange={(event) => toggleMultiDevice(preset.id, event.currentTarget.checked)}
                    />
                    {preset.name}
                  </label>
                ))}
              </div>
            )}
          </details>
        )}
        <button type="button" aria-label="Rotate devices" aria-pressed={rotated} title="Rotate devices" onClick={() => setRotated((value) => !value)}><RotateCw size={15} /></button>
        <button type="button" aria-label="Toggle device frame" aria-pressed={showDeviceFrame} title="Toggle device frame" onClick={() => setShowDeviceFrame((value) => !value)}><span className="preview-device-icon">▣</span></button>
        <label className="preview-zoom">
          Zoom {scalePercent}%
          <input aria-label="Preview zoom" type="range" min="25" max="150" step="5" value={scalePercent} onChange={(event) => setScalePercent(Number(event.currentTarget.value))} />
        </label>
        <button className="preview-capture-button" type="button" aria-label="Capture preview screenshot" title="Capture 2× PNG screenshot" onClick={() => void captureScreenshot()}><Camera size={15} /></button>
        <button type="button" aria-label="Toggle variables" aria-pressed={showVariables} title="Runtime variables" onClick={() => setShowVariables((value) => !value)}><SlidersHorizontal size={15} /></button>
        {isTauri() && <button type="button" aria-label="Detach preview" title="Detach preview window" onClick={() => void getCurrentWindow().setFocus().catch((error: unknown) => {
          console.error("Could not focus the preview window.", error);
          setToast(error instanceof Error ? error.message : "Could not focus the preview window.");
        })}><X size={15} /></button>}
      </header>
      <div
        className={`preview-content${previewMode === "single" ? "" : " is-multi"}`}
        ref={previewContentRef}
      >
        <div className={`preview-frame-grid is-${previewMode}`}>
          {previewMode === "grid" && selectedDevices.length === 0
            ? <p>Select at least one device to build the preview grid.</p>
            : frames}
        </div>
        {touchFeedback && (
          <span
            aria-hidden="true"
            className="preview-touch-feedback"
            data-event={touchFeedback.event}
            style={{ left: touchFeedback.x, top: touchFeedback.y }}
          >
            <span className="preview-touch-ripple" />
            <span className="preview-touch-label">{touchFeedback.event.replace(/^on/, "")}</span>
          </span>
        )}
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
        <span>{previewMode === "single"
          ? `${device.name} · ${getPreviewViewport(device, rotated).width} × ${getPreviewViewport(device, rotated).height}`
          : `${selectedDevices.length} devices · shared runtime state`}</span>
      </footer>
      {toast && <div className="preview-toast" role="alert">{toast}</div>}
    </main>
  );
}
