import { avatarInitials } from "../project/avatarInitials";
import { previewWindowTitle } from "./previewWindowTitle";
import { PREVIEW_FIT_HINT, previewFitLabel } from "./previewZoomLabel";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ChangeEvent, HTMLAttributes, KeyboardEvent, MouseEvent, ReactNode, TouchEvent } from "react";
import { ArrowLeft, Camera, RotateCcw, RotateCw, SlidersHorizontal, X } from "lucide-react";
import { emit, listen } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import type { Project, SymbolDefinition, Widget } from "../project/schema";
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
  getRepeaterRowHeight,
  getRepeaterTemplate,
  isRepeaterItemVisible,
  type RepeaterRecord,
} from "../project/repeaters";
import { getAutoLayoutPositions, type WidgetPosition } from "../project/widgetLayout";
import { getPreviewIconComponent } from "./widgetIcons";
import { useFullIconSet } from "../canvas/iconLibrary";
import { DEVICE_PRESETS, findDevicePreset } from "../devices/catalog";
import type { DevicePreset } from "../devices/types";
import { getPreviewWindowSize } from "./windowSizing";
import { getVirtualRowRange } from "./virtualization";
import { estimateWidgetCount, LITE_MODE_WIDGET_THRESHOLD } from "./performance";
import { trackEvent } from "../diagnostics/observability";
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
import { styleColorToRgba } from "../canvas/styleInspector";
import { readableTextOnFill } from "../canvas/readableText";
import { PLAIN_BOX_TYPES } from "../project/plainBoxes";

const PREVIEW_CHANNEL = "protoflow-preview";

function stringProp(widget: Widget, key: string, fallback = ""): string {
  const value = widget.props[key];
  return typeof value === "string" ? value : fallback;
}

const NATIVE_KEY_TARGETS = new Set(["BUTTON", "INPUT", "TEXTAREA", "SELECT", "A"]);

function isTouchPointerEvent(event: MouseEvent<HTMLElement>): boolean {
  return "pointerType" in event.nativeEvent && event.nativeEvent.pointerType === "touch";
}

function getWidgetText(
  widget: Widget,
  runtime: PreviewRuntime,
  screenId: string,
  item?: RepeaterRecord,
  liteMode = false,
): string {
  const text = widget.type === "avatar"
    ? avatarInitials(widget.props)
    : stringProp(
        widget,
        "text",
        stringProp(widget, "label", stringProp(widget, "title", "")),
      );
  return liteMode ? text : runtime.interpolate(text, screenId, item, widget);
}

const HORIZONTAL_ALIGNMENT: Record<string, CSSProperties["justifyContent"]> = {
  left: "flex-start",
  center: "center",
  right: "flex-end",
};
const VERTICAL_ALIGNMENT: Record<string, CSSProperties["alignItems"]> = {
  top: "flex-start",
  middle: "center",
  bottom: "flex-end",
};

/** Flexbox placement for a widget's text, from its own align / verticalAlign settings. */
export function flexAlignment(widget: Widget): Pick<CSSProperties, "justifyContent" | "alignItems"> {
  const horizontal = typeof widget.props.align === "string" ? HORIZONTAL_ALIGNMENT[widget.props.align] : undefined;
  const vertical = typeof widget.props.verticalAlign === "string" ? VERTICAL_ALIGNMENT[widget.props.verticalAlign] : undefined;
  return {
    ...(horizontal ? { justifyContent: horizontal } : {}),
    ...(vertical ? { alignItems: vertical } : {}),
  };
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
    // Match the canvas: fill and stroke opacity apply to the colour, not the whole widget.
    backgroundColor: textWidget || !fill ? "transparent" : styleColorToRgba(fill, widget.style.fillOpacity),
    color: typeof widget.props.color === "string"
      ? widget.props.color
      : typeof widget.props.textColor === "string"
        ? widget.props.textColor
        : textWidget && fill
          ? styleColorToRgba(fill, widget.style.fillOpacity)
          : (widget.type === "button" || widget.type === "icon-button") && fill
            ? readableTextOnFill(fill, widget.style.fillOpacity)
            : "#24212b",
    border: stroke
      ? `${widget.style.strokeWidth ?? 1}px solid ${styleColorToRgba(stroke, widget.style.strokeOpacity)}`
      : "none",
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
    // Widgets are flex boxes, so text-align alone leaves a short line on the left; place the
    // text block itself like the canvas does.
    ...flexAlignment(widget),
    textDecoration: widget.props.underline === true ? "underline" : undefined,
    whiteSpace: "pre-wrap",
    overflow: "hidden",
    padding: typeof widget.props.padding === "number" ? widget.props.padding : textWidget ? 0 : 8,
  };
}

export function VirtualizedRepeater({
  widget,
  rows,
  template,
  layout,
  gap,
  runtime,
  screenId,
  snapshot,
  runEvent,
  onError,
  inputMode,
  controlValues,
  onControlValueChange,
  onGestureFeedback,
  commonHandlers,
  liteMode,
  symbols,
}: {
  widget: Widget;
  rows: RepeaterRecord[];
  template: Widget[];
  layout: "vertical" | "horizontal" | "grid";
  gap: number;
  runtime: PreviewRuntime;
  screenId: string;
  snapshot: PreviewRuntimeSnapshot;
  runEvent: (widget: Widget, event: PreviewEvent, item?: RepeaterRecord) => number;
  onError: (error: unknown) => void;
  inputMode: Project["screens"][number]["inputMode"];
  controlValues: Record<string, string | boolean>;
  onControlValueChange: (key: string, value: string | boolean) => void;
  onGestureFeedback: (event: PreviewEvent, x: number, y: number) => void;
  commonHandlers: HTMLAttributes<HTMLDivElement>;
  liteMode: boolean;
  symbols?: SymbolDefinition[];
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scrollOffset, setScrollOffset] = useState(0);
  const horizontal = layout === "horizontal";
  const minimumColumnWidth = Math.max(120, widget.width / 2);
  const columns = layout === "grid"
    ? Math.max(1, Math.floor((widget.width + gap) / (minimumColumnWidth + gap)))
    : 1;
  const rowCount = Math.ceil(rows.length / columns);
  const rowHeight = getRepeaterRowHeight(widget);
  const stride = (horizontal ? widget.width : rowHeight) + gap;
  const viewportExtent = horizontal ? widget.width : widget.height;
  const range = getVirtualRowRange(rowCount, stride, scrollOffset, viewportExtent, liteMode ? 0 : 2);
  const visibleTemplate = useMemo(
    () => template.filter((child) =>
      child.visible && snapshot.visibility[child.id] !== false,
    ),
    [snapshot.visibility, template],
  );

  return (
    <div
      ref={viewportRef}
      className={`preview-widget preview-repeater is-${layout}`}
      data-widget-type="repeater"
      data-repeater-row-count={rows.length}
      data-rendered-row-count={Math.min(
        rows.length,
        (range.endIndex - range.startIndex) * columns,
      )}
      style={{
        ...widgetStyle(widget),
        width: widget.width,
        height: widget.height,
        padding: 0,
        overflowX: horizontal ? "auto" : "hidden",
        overflowY: horizontal ? "hidden" : "auto",
      }}
      onScroll={(event) => {
        const target = event.currentTarget;
        setScrollOffset(horizontal ? target.scrollLeft : target.scrollTop);
      }}
      {...commonHandlers}
    >
      <div
        style={{
          position: "relative",
          width: horizontal ? range.totalExtent : widget.width,
          height: horizontal ? widget.height : range.totalExtent,
        }}
      >
        {Array.from(
          { length: range.endIndex - range.startIndex },
          (_, offset) => range.startIndex + offset,
        ).flatMap((slot) =>
          Array.from({ length: Math.min(columns, rows.length - slot * columns) }, (_, column) => {
            const index = slot * columns + column;
            const record = rows[index];
            if (!record) return null;
            const columnWidth = columns > 1
              ? (widget.width - gap * (columns - 1)) / columns
              : widget.width;
            return (
              <div
                className="preview-repeater-row"
                key={`${widget.id}-${index}`}
                style={{
                  position: "absolute",
                  left: horizontal ? slot * stride : column * (columnWidth + gap),
                  top: horizontal ? 0 : slot * stride,
                  width: columnWidth,
                  height: horizontal ? widget.height : rowHeight,
                  overflow: "hidden",
                }}
                onClick={() => {
                  // On a touch-only screen a mouse click in Preview stands in for a tap.
                  for (const event of inputMode === "touch" ? ["onTap", "onClick"] as const : ["onClick"] as const) {
                    if (runEvent(widget, event, record) > 0) break;
                  }
                }}
              >
                {visibleTemplate
                  .filter((child) => isRepeaterItemVisible(child, record))
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
                      liteMode={liteMode}
                      symbols={symbols}
                    />
                  ))}
              </div>
            );
          }),
        )}
      </div>
    </div>
  );
}

export function PreviewWidget({
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
  liteMode,
  symbols,
  symbolDepth = 0,
}: {
  widget: Widget;
  runtime: PreviewRuntime;
  screenId: string;
  snapshot: PreviewRuntimeSnapshot;
  runEvent: (widget: Widget, event: PreviewEvent, item?: RepeaterRecord) => number;
  onError: (error: unknown) => void;
  transitionStyle?: CSSProperties;
  item?: RepeaterRecord;
  layoutPosition?: WidgetPosition;
  controlValues: Record<string, string | boolean>;
  onControlValueChange: (key: string, value: string | boolean) => void;
  onGestureFeedback: (event: PreviewEvent, x: number, y: number) => void;
  liteMode: boolean;
  symbols?: SymbolDefinition[];
  symbolDepth?: number;
}) {
  const touchStart = useRef<{ x: number; y: number; distance?: number; centerX?: number; centerY?: number } | null>(null);
  const longPressTimer = useRef<number | undefined>(undefined);
  const touchClickTimer = useRef<number | undefined>(undefined);
  const suppressCompatibilityClick = useRef(false);
  const longPressFired = useRef(false);
  const multiTouchFired = useRef(false);
  const lastTap = useRef(0);
  const [dismissed, setDismissed] = useState(false);
  const [expandedAccordionItem, setExpandedAccordionItem] = useState<number | null>(null);
  const [activePaginationPage, setActivePaginationPage] = useState(1);
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedPreviewDevice, setSelectedPreviewDevice] = useState("Desktop");
  const [activeCarouselIndex, setActiveCarouselIndex] = useState(0);
  const [requestPreviewAttempted, setRequestPreviewAttempted] = useState(false);
  const [previewThemeMode, setPreviewThemeMode] = useState<"light" | "dark">("light");
  const [refreshPreviewTriggered, setRefreshPreviewTriggered] = useState(false);
  const [lastSimulatedSwipe, setLastSimulatedSwipe] = useState("");
  const stepperMin = Number.isFinite(Number(widget.props.min)) ? Number(widget.props.min) : 1;
  const stepperMax = Math.max(stepperMin, Number.isFinite(Number(widget.props.max)) ? Number(widget.props.max) : 99);
  const configuredStepperValue = Number(widget.props.value);
  const [stepperValue, setStepperValue] = useState(() => Math.min(
    stepperMax,
    Math.max(stepperMin, Number.isFinite(configuredStepperValue) ? configuredStepperValue : stepperMin),
  ));
  const ratingMax = Math.max(1, Math.min(10, Number(widget.props.max) || 5));
  const configuredRatingValue = Number(widget.props.value);
  const [ratingValue, setRatingValue] = useState(() => Math.max(
    0,
    Math.min(ratingMax, Number.isFinite(configuredRatingValue) ? configuredRatingValue : 0),
  ));
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState("");
  const [toastVisible, setToastVisible] = useState(true);
  const [selectedSegmentIndex, setSelectedSegmentIndex] = useState(0);
  const initialCalendarMonth = /^\d{4}-\d{2}$/.test(stringProp(widget, "month"))
    ? new Date(`${stringProp(widget, "month")}-01T12:00:00`)
    : new Date();
  const [calendarMonth, setCalendarMonth] = useState(() => new Date(initialCalendarMonth.getFullYear(), initialCalendarMonth.getMonth(), 1));
  // Icons beyond the built-in set appear once the full set has loaded.
  useFullIconSet();
  useEffect(() => () => {
    window.clearTimeout(longPressTimer.current);
    window.clearTimeout(touchClickTimer.current);
  }, []);
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
  const interpolate = (
    value: string,
    targetScreenId = screenId,
    targetItem = item,
    targetWidget = widget,
  ) => liteMode
    ? value
    : runtime.interpolate(value, targetScreenId, targetItem, targetWidget);
  const text = snapshot.widgetTexts[widget.id] ??
    getWidgetText(widget, runtime, screenId, item, liteMode);
  const richRuns = widget.type === "text" && widget.props.richText === true
    ? Array.isArray(widget.props.richTextRuns)
      ? normalizeRichTextRuns(widget.props.richTextRuns)
      : parseRichTextMarkdown(stringProp(widget, "text"))
    : [];
  const inputMode = runtime.currentScreen.inputMode;
  /**
   * Runs a pointer trigger the way the web does: a tap also counts as a click (and, on a
   * touch-only screen, a mouse click in Preview counts as a tap), and when nothing on this
   * widget handles it, the trigger falls through to the widgets underneath the pointer, so
   * tapping the text on a row runs the row's rule.
   */
  const firePointer = (
    events: readonly PreviewEvent[],
    point: { x: number; y: number } | null,
    origin: Element | null,
  ): number => {
    const runOn = (target: Widget, targetItem?: RepeaterRecord) => {
      for (const event of events) {
        const ran = runEvent(target, event, targetItem);
        if (ran > 0) return ran;
      }
      return 0;
    };
    const ran = runOn(widget, item);
    if (ran > 0 || !point || !origin || origin.closest(".preview-repeater-row")) return ran;
    if (typeof document.elementsFromPoint !== "function") return ran;
    const underneath = document.elementsFromPoint(point.x, point.y);
    const start = underneath.findIndex((element) => element === origin || origin.contains(element));
    const widgets = flattenActivePanelWidgets(runtime.currentScreen.widgets, snapshot.panelStates);
    for (const element of underneath.slice(start + 1)) {
      if (element.contains(origin)) continue;
      const id = element.getAttribute("data-widget-id");
      const target = id ? widgets.find((candidate) => candidate.id === id) : undefined;
      if (!target || target.id === widget.id) continue;
      const forwarded = runOn(target);
      if (forwarded > 0) return forwarded;
    }
    return 0;
  };
  const clickEvents: readonly PreviewEvent[] = inputMode === "touch" ? ["onTap", "onClick"] : ["onClick"];
  const clickable = runtime.currentScreen.interactionRules.some((rule) =>
    (rule.event === "onClick" || rule.event === "onTap") && rule.widgetId === widget.id);
  const tapEvents: readonly PreviewEvent[] = ["onTap", "onClick"];
  const fireTouch = (event: PreviewEvent, x: number, y: number, origin: Element | null = null) => {
    if (event === "onTap") firePointer(tapEvents, { x, y }, origin);
    else if (event === "onDoubleTap") firePointer(["onDoubleTap"], { x, y }, origin);
    else runEvent(widget, event, item);
    onGestureFeedback(event, x, y);
  };
  const commonHandlers = {
    "data-widget-id": widget.id,
    // Clickable widgets (cards and containers too) can be reached with Tab (B2).
    ...(clickable ? { tabIndex: 0 } : {}),
    onClick: (event: MouseEvent<HTMLElement>) => {
      if (event.detail === 0) {
        suppressCompatibilityClick.current = false;
        window.clearTimeout(touchClickTimer.current);
        runEvent(widget, "onClick", item);
        return;
      }
      const pointerType = "pointerType" in event.nativeEvent
        ? event.nativeEvent.pointerType
        : undefined;
      if (pointerType === "touch") {
        suppressCompatibilityClick.current = false;
        window.clearTimeout(touchClickTimer.current);
        return;
      }
      if (suppressCompatibilityClick.current && pointerType !== "mouse") {
        suppressCompatibilityClick.current = false;
        window.clearTimeout(touchClickTimer.current);
        return;
      }
      if (pointerType !== "touch") {
        firePointer(clickEvents, { x: event.clientX, y: event.clientY }, event.currentTarget);
      }
    },
    onDoubleClick: (event: MouseEvent<HTMLElement>) => {
      if (isTouchPointerEvent(event)) return;
      firePointer(
        inputMode === "touch" ? ["onDoubleTap", "onDoubleClick"] : ["onDoubleClick"],
        { x: event.clientX, y: event.clientY },
        event.currentTarget,
      );
    },
    onContextMenu: (event: MouseEvent<HTMLElement>) => {
      if (inputMode === "touch" || isTouchPointerEvent(event)) return;
      event.preventDefault();
      runEvent(widget, "onRightClick", item);
    },
    onMouseEnter: (event: MouseEvent<HTMLElement>) => {
      if (inputMode !== "touch" && !isTouchPointerEvent(event)) runEvent(widget, "onHover", item);
    },
    onMouseLeave: (event: MouseEvent<HTMLElement>) => {
      // B50: leaving is its own event; Hover runs once, when the mouse enters.
      if (inputMode !== "touch" && !isTouchPointerEvent(event)) runEvent(widget, "onMouseLeave", item);
    },
    onMouseDown: (event: MouseEvent<HTMLElement>) => {
      if (inputMode !== "touch" && !isTouchPointerEvent(event)) runEvent(widget, "onMouseDown", item);
    },
    onMouseUp: (event: MouseEvent<HTMLElement>) => {
      if (inputMode !== "touch" && !isTouchPointerEvent(event)) runEvent(widget, "onMouseUp", item);
    },
    onFocus: () => runEvent(widget, "onFocus", item),
    onBlur: () => runEvent(widget, "onBlur", item),
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      runEvent(widget, "onKeyDown", item);
      // On every screen, Enter or Space on a clickable widget acts as a click (B2, WCAG 2.1.1).
      // Real buttons and form fields already do this themselves.
      if ((event.key === "Enter" || event.key === " ") && event.target === event.currentTarget &&
        !NATIVE_KEY_TARGETS.has(event.currentTarget.tagName) && clickable) {
        event.preventDefault();
        firePointer(["onClick", "onTap"], null, null);
      }
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
      suppressCompatibilityClick.current = true;
      window.clearTimeout(touchClickTimer.current);
      touchClickTimer.current = window.setTimeout(() => {
        suppressCompatibilityClick.current = false;
      }, 800);
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
        fireTouch("onDoubleTap", touch.clientX, touch.clientY, event.currentTarget);
      } else {
        lastTap.current = now;
        fireTouch("onTap", touch.clientX, touch.clientY, event.currentTarget);
      }
    },
  };

  if (dismissed) return null;

  if (widget.type === "carousel") {
    const rawItems = Array.isArray(widget.props.items) ? widget.props.items
      : Array.isArray(widget.props.images) ? widget.props.images : [];
    const slides = rawItems.map((entry, index) => {
      const record = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
      const source = typeof entry === "string" ? entry
        : typeof record.src === "string" ? record.src
        : typeof record.url === "string" ? record.url
        : typeof record.image === "string" ? record.image : "";
      const label = typeof record.title === "string" ? record.title
        : typeof record.alt === "string" ? record.alt : `Slide ${index + 1}`;
      return { source, label };
    });
    const currentIndex = slides.length ? Math.min(activeCarouselIndex, slides.length - 1) : 0;
    const currentSlide = slides[currentIndex];
    const move = (next: number) => {
      if (!slides.length) return;
      const nextIndex = (next + slides.length) % slides.length;
      setActiveCarouselIndex(nextIndex);
      runEvent(widget, "onChange", item);
    };
    return (
      <section className="preview-widget preview-carousel" aria-label={stringProp(widget, "label", "Carousel")} style={{ ...style, display: "flex", flexDirection: "column", alignItems: "stretch", justifyContent: "center", gap: 6, padding: 8 }} data-widget-type="carousel">
        {currentSlide?.source
          ? <img src={currentSlide.source} alt={currentSlide.label} style={{ width: "100%", height: "calc(100% - 34px)", objectFit: "contain", minHeight: 0 }} />
          : <div role="img" aria-label={currentSlide?.label ?? "No carousel slides"} style={{ flex: 1, display: "grid", placeItems: "center", background: "rgba(127,127,127,.08)" }}>{currentSlide?.label ?? "No carousel slides configured"}</div>}
        {slides.length > 0 && <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <button type="button" aria-label="Previous slide" onClick={() => move(currentIndex - 1)}>‹</button>
          <span aria-live="polite">{currentIndex + 1} / {slides.length}</span>
          <button type="button" aria-label="Next slide" onClick={() => move(currentIndex + 1)}>›</button>
        </div>}
      </section>
    );
  }

  if (widget.type === "api-request") {
    const method = stringProp(widget, "method", "GET").toUpperCase();
    const endpoint = stringProp(widget, "url", stringProp(widget, "endpoint", "No endpoint configured"));
    return (
      <section className="preview-widget preview-api-request" aria-label={stringProp(widget, "label", "API Request")} style={{ ...style, display: "flex", flexDirection: "column", alignItems: "stretch", justifyContent: "center", gap: 6, padding: 10 }} data-widget-type="api-request">
        <strong>{stringProp(widget, "label", "API Request")}</strong>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}><code>{method}</code><span>{endpoint}</span></div>
        <button type="button" onClick={() => { setRequestPreviewAttempted(true); runEvent(widget, "onClick", item); }}>Run request</button>
        <small role="status">{requestPreviewAttempted ? "Preview only · request was not sent" : "Not executed · preview only"}</small>
      </section>
    );
  }

  if (widget.type === "database") {
    const columns = Array.isArray(widget.props.columns) ? widget.props.columns.filter((column): column is string => typeof column === "string") : [];
    const rows = Array.isArray(widget.props.rows) ? widget.props.rows.filter((row) => row && typeof row === "object" && !Array.isArray(row)) as Record<string, unknown>[] : [];
    const visibleColumns = columns.length ? columns : rows.length ? Object.keys(rows[0]) : [];
    return (
      <section className="preview-widget preview-database" aria-label={stringProp(widget, "label", "Database")} style={{ ...style, display: "flex", flexDirection: "column", alignItems: "stretch", gap: 6, padding: 8, overflow: "auto" }} data-widget-type="database">
        <strong>{stringProp(widget, "label", "Database")}</strong>
        {visibleColumns.length ? <table><thead><tr>{visibleColumns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>
          {rows.map((row, index) => <tr key={index}>{visibleColumns.map((column) => <td key={column}>{String(row[column] ?? "")}</td>)}</tr>)}
        </tbody></table> : <p>No table data configured</p>}
        <small>Preview only · no live database connection</small>
      </section>
    );
  }

  if (widget.type === "settings") {
    const entries = Array.isArray(widget.props.items) ? widget.props.items : [];
    return (
      <section className="preview-widget preview-settings" aria-label={stringProp(widget, "label", "Settings")} style={{ ...style, display: "flex", flexDirection: "column", alignItems: "stretch", gap: 8, padding: 10, overflow: "auto" }} data-widget-type="settings">
        <strong>{stringProp(widget, "title", "Settings")}</strong>
        {entries.length ? entries.map((entry, index) => {
          const record = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
          const label = typeof entry === "string" ? entry : typeof record.label === "string" ? record.label : `Setting ${index + 1}`;
          const description = typeof record.description === "string" ? record.description : "";
          return <div key={index}><strong>{interpolate(label)}</strong>{description && <small>{interpolate(description)}</small>}</div>;
        }) : <p>No settings configured</p>}
      </section>
    );
  }

  if (widget.type === "theme") {
    return (
      <section className="preview-widget preview-theme" aria-label={stringProp(widget, "label", "Theme")} style={{ ...style, display: "flex", flexDirection: "column", alignItems: "stretch", justifyContent: "center", gap: 8, padding: 10, background: previewThemeMode === "dark" ? "#1f2937" : "#ffffff", color: previewThemeMode === "dark" ? "#f9fafb" : "#1f2937" }} data-widget-type="theme">
        <strong>{stringProp(widget, "label", "Theme preview")}</strong>
        <label>Appearance
          <select aria-label="Theme appearance" value={previewThemeMode} onChange={(event) => setPreviewThemeMode(event.target.value as "light" | "dark")}>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <span>Sample content</span>
      </section>
    );
  }

  if (widget.type === "pull-to-refresh") {
    return (
      <section className="preview-widget preview-pull-to-refresh" aria-label={stringProp(widget, "label", "Pull to refresh")} style={{ ...style, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: 10 }} data-widget-type="pull-to-refresh" {...commonHandlers}>
        <span>{refreshPreviewTriggered ? "Refresh interaction triggered" : "Pull down or use the button to refresh"}</span>
        <button type="button" onClick={(event) => { event.stopPropagation(); setRefreshPreviewTriggered(true); runEvent(widget, "onSwipeDown", item); }}>Refresh preview</button>
      </section>
    );
  }

  if (widget.type === "swipe-gesture") {
    const gestures = [
      ["Left", "onSwipeLeft"], ["Right", "onSwipeRight"],
      ["Up", "onSwipeUp"], ["Down", "onSwipeDown"],
    ] as const;
    return (
      <section className="preview-widget preview-swipe-gesture" aria-label={stringProp(widget, "label", "Swipe gesture")} style={{ ...style, display: "flex", flexDirection: "column", alignItems: "stretch", justifyContent: "center", gap: 6, padding: 8 }} data-widget-type="swipe-gesture" {...commonHandlers}>
        <span>{lastSimulatedSwipe ? `Last gesture: swipe ${lastSimulatedSwipe}` : "Swipe here or choose a direction"}</span>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 4 }}>
          {gestures.map(([label, event]) => <button key={event} type="button" onClick={(clickEvent) => { clickEvent.stopPropagation(); setLastSimulatedSwipe(label.toLowerCase()); runEvent(widget, event, item); }}>Swipe {label}</button>)}
        </div>
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

  if (widget.type === "avatar") {
    const name = stringProp(widget, "label", stringProp(widget, "name", "User"));
    const initials = avatarInitials(widget.props);
    const imageSource = stringProp(widget, "src", stringProp(widget, "image"));
    return <div className="preview-widget preview-avatar" role="img" aria-label={name} style={{ ...style, display: "grid", placeItems: "center", borderRadius: "50%", overflow: "hidden" }} data-widget-type="avatar">{imageSource ? <img src={interpolate(imageSource)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <strong>{initials}</strong>}</div>;
  }

  if (widget.type === "avatar-group") {
    const rawPeople = Array.isArray(widget.props.items) ? widget.props.items : stringProp(widget, "label", "AM | JR | SK").split("|").map((name) => name.trim());
    return <div className="preview-widget preview-avatar-group" role="group" aria-label={stringProp(widget, "label", "Avatar group")} style={{ ...style, display: "flex", alignItems: "center", padding: 4, overflow: "visible" }}>{rawPeople.slice(0, 6).map((person, index) => { const name = typeof person === "string" ? person : person && typeof person === "object" && typeof (person as Record<string, unknown>).name === "string" ? String((person as Record<string, unknown>).name) : `User ${index + 1}`; return <span key={index} role="img" aria-label={name} style={{ width: 32, height: 32, borderRadius: "50%", display: "grid", placeItems: "center", marginLeft: index ? -7 : 0, border: "2px solid white", background: "#e9e2ff", color: "#49377b", fontSize: 10 }}>{avatarInitials({ label: name })}</span>; })}</div>;
  }

  if (widget.type === "segmented-control") {
    const raw = Array.isArray(widget.props.items) ? widget.props.items : stringProp(widget, "label", "Overview | Activity | Settings").split("|");
    const labels = raw.map((entry) => typeof entry === "string" ? entry.trim() : entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).label === "string" ? String((entry as Record<string, unknown>).label) : "Option");
    return <div className="preview-widget preview-segmented-control" role="group" aria-label={stringProp(widget, "ariaLabel", "View options")} style={{ ...style, display: "flex", alignItems: "center", gap: 3, padding: 4 }}>{labels.map((label, index) => <button key={index} type="button" aria-pressed={selectedSegmentIndex === index} onClick={() => { setSelectedSegmentIndex(index); runEvent(widget, "onChange", item); }}>{interpolate(label)}</button>)}</div>;
  }

  if (widget.type === "step-indicator") {
    const raw = Array.isArray(widget.props.items) ? widget.props.items : stringProp(widget, "label", "Details | Shipping | Review").split("|");
    const labels = raw.map((entry) => typeof entry === "string" ? entry.trim() : entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).label === "string" ? String((entry as Record<string, unknown>).label) : "Step");
    const active = Math.max(0, Math.min(labels.length - 1, Number(widget.props.step ?? 1) - 1));
    return <ol className="preview-widget preview-step-indicator" aria-label={stringProp(widget, "label", "Steps")} style={{ ...style, display: "flex", alignItems: "center", justifyContent: "space-around", gap: 4, padding: 6, listStyle: "none" }}>{labels.map((label, index) => <li key={index} aria-current={index === active ? "step" : undefined} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, opacity: index <= active ? 1 : 0.55 }}><span>{index < active ? "✓" : index + 1}</span><small>{interpolate(label)}</small></li>)}</ol>;
  }

  if (widget.type === "select") {
    const options = Array.isArray(widget.props.options) ? widget.props.options.filter((option): option is string => typeof option === "string") : [];
    return <label className="preview-widget-label" style={{ ...style, display: "flex", flexDirection: "column", gap: 4, overflow: "visible" }}><span>{stringProp(widget, "label", "Select")}</span><select aria-label={stringProp(widget, "label", "Select")} value={inputValue} onChange={handleChange}><option value="">{stringProp(widget, "placeholder", "Choose an option")}</option>{options.map((option) => <option key={option} value={option}>{interpolate(option)}</option>)}</select></label>;
  }

  if (widget.type === "slider") {
    const min = Number(widget.props.min ?? 0);
    const max = Math.max(min, Number(widget.props.max ?? 100));
    const value = Math.max(min, Math.min(max, Number(inputValue || widget.props.value) || min));
    return <label className="preview-widget-label" style={{ ...style, display: "flex", flexDirection: "column", gap: 4 }}><span>{stringProp(widget, "label", "Slider")}: {value}</span><input aria-label={stringProp(widget, "label", "Slider")} type="range" min={min} max={max} step={Math.max(0.01, Number(widget.props.step) || 1)} value={value} onChange={handleChange} /></label>;
  }

  if (widget.type === "stepper") {
    const change = (next: number) => { const value = Math.max(stepperMin, Math.min(stepperMax, next)); setStepperValue(value); runEvent(widget, "onChange", item); };
    return <section className="preview-widget preview-stepper" aria-label={stringProp(widget, "label", "Stepper")} style={{ ...style, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: 8 }}><strong>{stringProp(widget, "label", "Quantity")}</strong><button type="button" aria-label="Decrease value" disabled={stepperValue <= stepperMin} onClick={() => change(stepperValue - 1)}>−</button><output aria-live="polite">{stepperValue}</output><button type="button" aria-label="Increase value" disabled={stepperValue >= stepperMax} onClick={() => change(stepperValue + 1)}>+</button></section>;
  }

  if (widget.type === "date-picker") {
    return <label className="preview-widget-label" style={{ ...style, display: "flex", flexDirection: "column", gap: 4 }}><span>{stringProp(widget, "label", "Date")}</span><input aria-label={stringProp(widget, "label", "Date")} type="date" value={inputValue} onChange={handleChange} /></label>;
  }

  if (widget.type === "file-upload") {
    return <label className="preview-widget-label preview-file-upload" style={{ ...style, display: "flex", flexDirection: "column", justifyContent: "center", gap: 6, padding: 8 }}><span>{stringProp(widget, "label", "Upload file")}</span><input aria-label={stringProp(widget, "label", "Upload file")} type="file" accept={stringProp(widget, "accept", "") || undefined} multiple={widget.props.multiple === true} onChange={(event) => { const files = Array.from(event.currentTarget.files ?? []); setSelectedFileName(files.map((file) => file.name).join(", ")); runEvent(widget, "onChange", item); }} /><small>{selectedFileName || stringProp(widget, "placeholder", "Choose a file")}</small></label>;
  }

  if (widget.type === "rating") {
    const max = ratingMax;
    return <div className="preview-widget preview-rating" role="group" aria-label={stringProp(widget, "label", "Rating")} style={{ ...style, display: "flex", alignItems: "center", gap: 4, padding: 6 }}>{Array.from({ length: max }, (_, index) => <button key={index} type="button" aria-label={`Rate ${index + 1} of ${max}`} aria-pressed={ratingValue === index + 1} onClick={() => { setRatingValue(index + 1); runEvent(widget, "onChange", item); }}>{index < ratingValue ? "★" : "☆"}</button>)}<output>{ratingValue}/{max}</output></div>;
  }

  if (widget.type === "progress-bar") {
    const progress = Math.max(0, Math.min(100, Number(widget.props.value ?? widget.props.progress ?? 45) || 0));
    return <div className="preview-widget preview-progress" style={{ ...style, display: "flex", flexDirection: "column", justifyContent: "center", gap: 6, padding: 8 }}><span>{stringProp(widget, "label", "Progress")}: {progress}%</span><progress aria-label={stringProp(widget, "label", "Progress")} max={100} value={progress} style={{ width: "100%" }} /></div>;
  }

  if (widget.type === "spinner") {
    return <div className="preview-widget preview-spinner" role="status" aria-label={stringProp(widget, "label", "Loading")} style={{ ...style, display: "grid", placeItems: "center" }}><span aria-hidden="true" style={{ fontSize: 24 }}>◌</span><span>{stringProp(widget, "label", "Loading")}</span></div>;
  }

  if (widget.type === "popover" || widget.type === "tooltip") {
    const trigger = stringProp(widget, "triggerLabel", widget.type === "tooltip" ? "Hover or focus for help" : "Open details");
    const content = stringProp(widget, "content", stringProp(widget, "description", "Add explanatory content in the properties panel."));
    return <section className={`preview-widget preview-${widget.type}`} style={{ ...style, display: "flex", flexDirection: "column", alignItems: "flex-start", justifyContent: "center", gap: 6, padding: 8 }} data-widget-type={widget.type}><button type="button" aria-expanded={popoverOpen} onClick={() => setPopoverOpen((open) => !open)} onMouseEnter={() => { if (widget.type === "tooltip") setPopoverOpen(true); }} onMouseLeave={() => { if (widget.type === "tooltip") setPopoverOpen(false); }} onFocus={() => { if (widget.type === "tooltip") setPopoverOpen(true); }} onBlur={() => { if (widget.type === "tooltip") setPopoverOpen(false); }}>{trigger}</button>{popoverOpen && <div role="status">{interpolate(content)}</div>}</section>;
  }

  if (widget.type === "toast" || widget.type === "notification" || widget.type === "banner") {
    if (!toastVisible) return null;
    const heading = stringProp(widget, "label", widget.type === "toast" ? "Changes saved" : widget.type === "banner" ? "Announcement" : "New notification");
    return <aside className={`preview-widget preview-${widget.type}`} role="status" style={{ ...style, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: 8 }}><span><strong>{interpolate(heading)}</strong>{stringProp(widget, "subtitle") && <small>{interpolate(stringProp(widget, "subtitle"))}</small>}</span><button type="button" aria-label={`Dismiss ${widget.type}`} onClick={(event) => { event.stopPropagation(); setToastVisible(false); }}>×</button></aside>;
  }

  if (widget.type === "badge" || widget.type === "chip" || widget.type === "tag") {
    return <span className={`preview-widget preview-${widget.type}`} style={{ ...style, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "4px 10px", borderRadius: 999, whiteSpace: "nowrap" }}>{interpolate(stringProp(widget, "label", text || widget.type))}</span>;
  }

  if (widget.type === "stat" || widget.type === "metric-card") {
    return <section data-widget-type={widget.type} className="preview-widget preview-stat" aria-label={stringProp(widget, "label", "Statistic")} style={{ ...style, display: "flex", flexDirection: "column", justifyContent: "center", gap: 5, padding: 10 }}><span>{interpolate(stringProp(widget, "label", "Revenue"))}</span><strong style={{ fontSize: 22 }}>{interpolate(stringProp(widget, "value", "—"))}</strong>{stringProp(widget, "trend") && <small>{interpolate(stringProp(widget, "trend"))}</small>}</section>;
  }

  if (widget.type === "profile-card" || widget.type === "testimonial-card" || widget.type === "feature-card" || widget.type === "pricing-card" || widget.type === "empty-state") {
    const heading = stringProp(widget, "label", widget.type.replaceAll("-", " "));
    const detail = stringProp(widget, "subtitle", widget.type === "empty-state" ? "New items will appear here." : "");
    return <article className={`preview-widget preview-${widget.type}`} style={{ ...style, display: "flex", flexDirection: "column", alignItems: "flex-start", justifyContent: "center", gap: 6, padding: 10 }} {...commonHandlers}><strong>{interpolate(heading)}</strong>{detail && <p>{interpolate(detail)}</p>}{widget.type === "profile-card" && <small>{stringProp(widget, "initials", avatarInitials({ label: heading }))}</small>}{widget.type === "testimonial-card" && <span aria-label={`Rating ${Number(widget.props.value) || 5} out of 5`}>{"★".repeat(Math.max(0, Math.min(5, Number(widget.props.value) || 5)))}</span>}{widget.type === "pricing-card" && <button type="button" onClick={(event) => { event.stopPropagation(); runEvent(widget, "onClick", item); }}>{stringProp(widget, "actionLabel", "Choose plan")}</button>}</article>;
  }

  if (widget.type === "table") {
    const columns = Array.isArray(widget.props.columns) ? widget.props.columns.filter((entry): entry is string => typeof entry === "string") : [];
    const rows = Array.isArray(widget.props.rows) ? widget.props.rows.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry)) as Record<string, unknown>[] : [];
    return <div className="preview-widget preview-table" style={{ ...style, overflow: "auto", padding: 8 }} data-widget-type="table">{rows.length && columns.length ? <table><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{columns.map((column) => <td key={column}>{String(row[column] ?? "")}</td>)}</tr>)}</tbody></table> : <p>No table data configured</p>}</div>;
  }

  if (widget.type === "grid") {
    const rawItems = Array.isArray(widget.props.items) ? widget.props.items : Array.isArray(widget.props.rows) ? widget.props.rows : [];
    const columns = Math.max(1, Math.min(12, Math.floor(Number(widget.props.columns) || 2)));
    return <div className="preview-widget preview-grid" role="list" aria-label={stringProp(widget, "label", "Grid")} style={{ ...style, display: "grid", gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridAutoRows: "minmax(0, 1fr)", alignContent: "start", gap: typeof widget.props.gap === "number" ? Math.max(0, widget.props.gap) : 8, overflow: "auto", padding: 8 }} data-widget-type="grid">{rawItems.length ? rawItems.map((entry, index) => { const record = entry && typeof entry === "object" && !Array.isArray(entry) ? entry as Record<string, unknown> : {}; const label = typeof entry === "string" ? entry : String(record.label ?? record.title ?? record.name ?? `Item ${index + 1}`); return <div key={index} role="listitem" style={{ minWidth: 0, minHeight: 36, display: "grid", placeItems: "center", padding: 6, border: "1px solid rgba(127,127,127,.35)", borderRadius: 5, overflowWrap: "anywhere" }}>{interpolate(label)}</div>; }) : <p style={{ gridColumn: "1 / -1" }}>No grid items configured</p>}</div>;
  }

  if (widget.type === "calendar") {
    const events = Array.isArray(widget.props.events) ? widget.props.events : [];
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const firstWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const monthLabel = calendarMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    const eventsByDate = new Map<string, string[]>();
    for (const [index, entry] of events.entries()) {
      const record = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
      if (typeof record.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(record.date)) continue;
      const labels = eventsByDate.get(record.date) ?? [];
      labels.push(typeof record.title === "string" ? record.title : `Event ${index + 1}`);
      eventsByDate.set(record.date, labels);
    }
    const moveMonth = (offset: number) => setCalendarMonth(new Date(year, month + offset, 1));
    return <section className="preview-widget preview-calendar" aria-label={stringProp(widget, "label", "Calendar")} style={{ ...style, display: "flex", flexDirection: "column", gap: 6, padding: 8, overflow: "auto" }} data-widget-type="calendar">
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}><button type="button" aria-label="Previous month" onClick={() => moveMonth(-1)}>‹</button><strong aria-live="polite">{monthLabel}</strong><button type="button" aria-label="Next month" onClick={() => moveMonth(1)}>›</button></header>
      <div role="grid" aria-label={monthLabel} style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 2, minHeight: 0, flex: 1 }}>
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <div role="columnheader" key={day} style={{ textAlign: "center", fontSize: 10, fontWeight: 700 }}>{day}</div>)}
        {Array.from({ length: 42 }, (_, index) => {
          const day = index - firstWeekday + 1;
          const inMonth = day >= 1 && day <= daysInMonth;
          const dateKey = inMonth ? `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}` : "";
          const dayEvents = dateKey ? eventsByDate.get(dateKey) ?? [] : [];
          return <div role="gridcell" aria-label={inMonth ? `${dateKey}${dayEvents.length ? `: ${dayEvents.join(", ")}` : ""}` : undefined} key={index} aria-disabled={!inMonth} style={{ minWidth: 0, minHeight: 0, padding: 2, border: "1px solid rgba(127,127,127,.2)", borderRadius: 3, opacity: inMonth ? 1 : .25, overflow: "hidden", fontSize: 10 }}><span>{inMonth ? day : ""}</span>{dayEvents.slice(0, 1).map((eventTitle) => <small key={eventTitle} style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{eventTitle}</small>)}</div>;
        })}
      </div>
      {events.length === 0 && <p>No calendar events configured</p>}
    </section>;
  }

  if (widget.type === "code-block") {
    return <pre className="preview-widget preview-code-block" style={{ ...style, overflow: "auto", padding: 8, whiteSpace: "pre-wrap" }}><code>{stringProp(widget, "label", "Add code in the properties panel.")}</code></pre>;
  }

  if (widget.type === "polygon" || widget.type === "star") {
    const shape = widget.type === "star"
      ? "polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)"
      : "polygon(25% 7%, 75% 7%, 100% 50%, 75% 93%, 25% 93%, 0% 50%)";
    return <div className={`preview-widget preview-${widget.type}`} role="img" aria-label={stringProp(widget, "label", widget.type)} style={{ ...style, clipPath: shape }} data-widget-type={widget.type} />;
  }

  if (widget.type === "divider") {
    const vertical = widget.props.orientation === "vertical";
    return <div className="preview-widget preview-divider" role="separator" aria-orientation={vertical ? "vertical" : "horizontal"} style={{ ...style, minHeight: vertical ? style.minHeight : 1, minWidth: vertical ? 1 : style.minWidth, backgroundColor: widget.style.stroke ?? widget.style.fill ?? "currentColor" }} data-widget-type="divider" />;
  }

  if (widget.type === "path" || widget.type === "vector") {
    const pathData = stringProp(widget, "pathData");
    return <svg className="preview-widget preview-vector" viewBox={`0 0 ${Math.max(1, Number(widget.props.pathViewBoxWidth ?? widget.props.viewBoxWidth) || widget.width)} ${Math.max(1, Number(widget.props.pathViewBoxHeight ?? widget.props.viewBoxHeight) || widget.height)}`} role="img" aria-label={stringProp(widget, "label", widget.type)} style={{ ...style, overflow: "visible" }} data-widget-type={widget.type}><path d={pathData} fill={widget.style.fill ?? "none"} stroke={widget.style.stroke ?? "currentColor"} strokeWidth={widget.style.strokeWidth ?? 1} /></svg>;
  }

  if (widget.type === "pagination") {
    const pageCount = Math.max(1, Math.min(99, Number(widget.props.pageCount ?? widget.props.pages ?? 5) || 5));
    const page = Math.min(activePaginationPage, pageCount);
    const setPage = (next: number) => {
      setActivePaginationPage(Math.max(1, Math.min(pageCount, next)));
      runEvent(widget, "onChange", item);
    };
    return (
      <nav className="preview-widget preview-pagination" aria-label={stringProp(widget, "label", "Pagination")} style={{ ...style, display: "flex", alignItems: "center", justifyContent: "center", gap: 4, padding: 4 }} data-widget-type="pagination">
        <button type="button" aria-label="Previous page" disabled={page === 1} onClick={() => setPage(page - 1)}>‹</button>
        {Array.from({ length: pageCount }, (_, index) => index + 1).map((number) => (
          <button key={number} type="button" aria-label={`Page ${number}`} aria-current={page === number ? "page" : undefined} onClick={() => setPage(number)}>{number}</button>
        ))}
        <button type="button" aria-label="Next page" disabled={page === pageCount} onClick={() => setPage(page + 1)}>›</button>
      </nav>
    );
  }

  if (widget.type === "breadcrumb") {
    const rawItems = Array.isArray(widget.props.items) ? widget.props.items : ["Home", "Section", "Current page"];
    const labels = rawItems.map((entry, index) => typeof entry === "string" ? entry
      : entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).label === "string"
        ? String((entry as Record<string, unknown>).label) : `Step ${index + 1}`);
    return (
      <nav className="preview-widget preview-breadcrumb" aria-label={stringProp(widget, "label", "Breadcrumb")} style={{ ...style, display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", padding: 6 }} data-widget-type="breadcrumb">
        {labels.map((label, index) => (
          <span key={index} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            {index > 0 && <span aria-hidden="true">/</span>}
            {index === labels.length - 1 ? <span aria-current="page">{interpolate(label)}</span> : <button type="button" onClick={() => runEvent(widget, "onClick", item)}>{interpolate(label)}</button>}
          </span>
        ))}
      </nav>
    );
  }

  if (widget.type === "timeline") {
    const rawItems = Array.isArray(widget.props.items) ? widget.props.items : ["Project created", "Design reviewed", "Prototype ready"];
    return (
      <ol className="preview-widget preview-timeline" aria-label={stringProp(widget, "label", "Timeline")} style={{ ...style, display: "flex", flexDirection: "column", alignItems: "stretch", gap: 8, padding: 10, overflow: "auto" }} data-widget-type="timeline">
        {rawItems.map((entry, index) => {
          const record = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
          const title = typeof entry === "string" ? entry : typeof record.title === "string" ? record.title : `Event ${index + 1}`;
          const detail = typeof record.description === "string" ? record.description : typeof record.date === "string" ? record.date : "";
          return <li key={index} style={{ paddingLeft: 8, borderLeft: "2px solid #8b69ed" }}><strong>{interpolate(title)}</strong>{detail && <div>{interpolate(detail)}</div>}</li>;
        })}
      </ol>
    );
  }

  if (widget.type === "fab") {
    const label = stringProp(widget, "label", "Add");
    return <button type="button" className="preview-widget preview-fab" aria-label={label} style={{ ...style, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", padding: 0, cursor: "pointer" }} data-widget-type="fab" {...commonHandlers}>{stringProp(widget, "iconText", "+")}</button>;
  }

  if (widget.type === "tabs" || widget.type === "tabs-container") {
    const rawItems = Array.isArray(widget.props.items) ? widget.props.items : ["Overview", "Activity", "Settings"];
    const tabs = rawItems.map((entry, index) => typeof entry === "string" ? { label: entry, content: "" }
      : entry && typeof entry === "object" ? { label: typeof (entry as Record<string, unknown>).label === "string" ? String((entry as Record<string, unknown>).label) : `Tab ${index + 1}`, content: typeof (entry as Record<string, unknown>).content === "string" ? String((entry as Record<string, unknown>).content) : "" }
      : { label: `Tab ${index + 1}`, content: "" });
    const selected = Math.min(activeTabIndex, Math.max(0, tabs.length - 1));
    return (
      <section className="preview-widget preview-tabs" aria-label={stringProp(widget, "label", "Tabs")} style={{ ...style, display: "flex", flexDirection: "column", alignItems: "stretch", padding: 6, gap: 6 }} data-widget-type={widget.type}>
        <div role="tablist" aria-label={stringProp(widget, "label", "Tabs")} style={{ display: "flex", gap: 4 }}>
          {tabs.map((tab, index) => <button key={index} type="button" role="tab" aria-selected={selected === index} onClick={() => { setActiveTabIndex(index); runEvent(widget, "onChange", item); }}>{interpolate(tab.label)}</button>)}
        </div>
        <div role="tabpanel">{tabs[selected]?.content ? interpolate(tabs[selected].content) : "No tab content configured"}</div>
      </section>
    );
  }

  if (widget.type === "menu" || widget.type === "dropdown-menu") {
    const rawItems = Array.isArray(widget.props.items) ? widget.props.items : ["New", "Open", "Settings"];
    const items = rawItems.map((entry, index) => typeof entry === "string" ? entry
      : entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).label === "string"
        ? String((entry as Record<string, unknown>).label) : `Item ${index + 1}`);
    return (
      <div className="preview-widget preview-menu" style={{ ...style, display: "flex", flexDirection: "column", alignItems: "stretch", gap: 4, padding: 6, overflow: "auto" }} data-widget-type={widget.type}>
        <button type="button" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>{stringProp(widget, "triggerLabel", widget.type === "menu" ? "Menu" : "Options")} ▾</button>
        {menuOpen && <ul role="menu" style={{ margin: 0, padding: 4, listStyle: "none" }}>{items.map((entry, index) => <li key={index}><button type="button" role="menuitem" onClick={() => { setMenuOpen(false); runEvent(widget, "onClick", item); }}>{interpolate(entry)}</button></li>)}</ul>}
      </div>
    );
  }

  if (widget.type === "cloud-sync" || widget.type === "websocket" || widget.type === "auth-state") {
    const title = stringProp(widget, "label", widget.type === "cloud-sync" ? "Cloud Sync" : widget.type === "websocket" ? "WebSocket" : "Authentication");
    const status = stringProp(widget, "status", widget.type === "auth-state" ? "Signed out" : "Not connected");
    const detail = widget.type === "websocket" ? stringProp(widget, "url", "No endpoint configured")
      : widget.type === "auth-state" ? stringProp(widget, "user", "No user session")
      : stringProp(widget, "lastSynced", "No sync session");
    return (
      <section className={`preview-widget preview-integration preview-${widget.type}`} aria-label={title} style={{ ...style, display: "flex", flexDirection: "column", alignItems: "flex-start", justifyContent: "center", gap: 5, padding: 10 }} data-widget-type={widget.type}>
        <strong>{title}</strong>
        <span>{status}</span>
        <small>{detail}</small>
        <small style={{ opacity: 0.65 }}>Preview only · no live service connection</small>
      </section>
    );
  }

  if (widget.type === "responsive-switch") {
    const devices = ["Desktop", "Tablet", "Mobile"];
    return (
      <section className="preview-widget preview-responsive-switch" aria-label={stringProp(widget, "label", "Responsive device switch")} style={{ ...style, display: "flex", flexDirection: "column", justifyContent: "center", gap: 6, padding: 8 }} data-widget-type="responsive-switch">
        <label>
          {stringProp(widget, "label", "Device")}
          <select aria-label="Preview device" value={selectedPreviewDevice} onChange={(event) => setSelectedPreviewDevice(event.target.value)}>
            {devices.map((device) => <option key={device} value={device}>{device}</option>)}
          </select>
        </label>
        <small>Selected: {selectedPreviewDevice}</small>
      </section>
    );
  }

  if (widget.type === "navbar" || widget.type === "sidebar" || widget.type === "footer" || widget.type === "bottom-nav" || widget.type === "app-bar") {
    const label = stringProp(widget, "label", "").trim();
    const rawItems = widget.type === "bottom-nav" && label
      ? label.split("|").map((entry) => entry.trim()).filter(Boolean)
      : Array.isArray(widget.props.items) ? widget.props.items : ["Home", "Explore", "Profile"];
    const items = rawItems.map((entry, index) => typeof entry === "string" ? entry
      : entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).label === "string"
        ? String((entry as Record<string, unknown>).label) : `Item ${index + 1}`);
    const vertical = widget.type === "sidebar";
    return (
      <nav className={`preview-widget preview-${widget.type}`} aria-label={label || widget.type} style={{ ...style, display: "flex", flexDirection: vertical ? "column" : "row", alignItems: "center", justifyContent: "space-around", gap: 6, padding: 8 }} data-widget-type={widget.type}>
        {widget.type === "app-bar" && label ? <strong>{interpolate(label)}</strong> : null}
        {items.map((entry, index) => <button key={index} type="button" onClick={() => runEvent(widget, "onClick", item)}>{interpolate(entry)}</button>)}
      </nav>
    );
  }

  if (widget.type === "form") {
    const fields = Array.isArray(widget.props.fields) ? widget.props.fields : [];
    return (
      <form className="preview-widget preview-form" aria-label={stringProp(widget, "label", "Form")} style={{ ...style, display: "flex", flexDirection: "column", alignItems: "stretch", gap: 8, padding: 10, overflow: "auto" }} data-widget-type="form" onSubmit={(event) => { event.preventDefault(); runEvent(widget, "onClick", item); }}>
        {fields.length ? fields.map((entry, index) => {
          const record = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
          const label = typeof record.label === "string" ? record.label : `Field ${index + 1}`;
          const placeholder = typeof record.placeholder === "string" ? record.placeholder : "";
          const allowedTypes = ["text", "email", "number", "date", "tel", "url", "password"] as const;
          const requestedType = typeof record.type === "string" ? record.type : "text";
          const fieldType = allowedTypes.includes(requestedType as typeof allowedTypes[number]) ? requestedType : "text";
          return <label key={index}>{label}<input aria-label={label} name={typeof record.name === "string" ? record.name : `field-${index + 1}`} type={fieldType} placeholder={placeholder} required={record.required === true} /></label>;
        }) : <p>No form fields configured</p>}
        <button type="submit">{stringProp(widget, "submitLabel", "Submit")}</button>
      </form>
    );
  }

  if (widget.type === "modal" || widget.type === "overlay" || widget.type === "drawer") {
    const heading = stringProp(widget, "title", stringProp(widget, "label", widget.type === "modal" ? "Dialog" : widget.type === "drawer" ? "Drawer" : "Overlay"));
    return (
      <section className={`preview-widget preview-${widget.type}`} aria-label={heading} style={{ ...style, display: "flex", flexDirection: "column", alignItems: "stretch", justifyContent: "flex-start", gap: 8, padding: 12, boxShadow: "0 4px 16px rgba(0,0,0,.18)" }} data-widget-type={widget.type}>
        <strong>{heading}</strong>
        <span>{stringProp(widget, "content", "Add content to this layer in the properties panel.")}</span>
        {widget.type !== "overlay" && <button type="button" aria-label={`Close ${heading}`} onClick={() => runEvent(widget, "onClick", item)}>Close</button>}
      </section>
    );
  }

  if (widget.type === "card") {
    const imageSource = stringProp(widget, "imageSrc", stringProp(widget, "src"));
    const title = interpolate(stringProp(widget, "title", text || "Product card"));
    const subtitle = interpolate(stringProp(widget, "subtitle", "A short description goes here."));
    const actionLabel = interpolate(stringProp(widget, "actionLabel", "Learn more"));
    return (
      <article className="preview-widget preview-card" style={style} {...commonHandlers}>
        <div className="preview-card-media">
          {imageSource
            ? <img src={interpolate(imageSource)} alt={stringProp(widget, "imageAlt", title)} />
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
    if (dismissed) return null;
    const variant = stringProp(widget, "variant", "info");
    return (
      <aside className={`preview-widget preview-alert is-${variant}`} role={variant === "error" ? "alert" : "status"} style={style} {...commonHandlers}>
        <span className="preview-alert-icon" aria-hidden="true">!</span>
        <span className="preview-alert-copy">
          <strong>{interpolate(stringProp(widget, "label", "Changes saved"))}</strong>
          <span>{interpolate(stringProp(widget, "subtitle", ""))}</span>
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

  if (widget.type === "flex-row" || widget.type === "flex-column" || PLAIN_BOX_TYPES.has(widget.type)) {
    return (
      <section
        className={`preview-widget preview-layout is-${widget.type}`}
        aria-label={stringProp(widget, "label", widget.type.replaceAll("-", " "))}
        style={{
          ...style,
          display: PLAIN_BOX_TYPES.has(widget.type) ? "block" : "flex",
          flexDirection: widget.type === "flex-row" ? "row" : "column",
          gap: typeof widget.props.gap === "number" ? widget.props.gap : 12,
          padding: typeof widget.props.padding === "number" ? widget.props.padding : 12,
          alignItems: stringProp(widget, "alignItems", "center"),
          justifyContent: stringProp(widget, "justifyContent", "flex-start"),
        }}
        {...commonHandlers}
      />
    );
  }


  if (widget.type === "input" || widget.type === "search" || widget.type === "textarea") {
    const tag = widget.type;
    const placeholderValue = stringProp(widget, "placeholder", "Enter text...");
    const placeholder = interpolate(placeholderValue);
    return (
      <label className="preview-widget-label" style={{ ...style, overflow: "visible" }} {...commonHandlers}>
        {stringProp(widget, "label") && <span>{interpolate(stringProp(widget, "label"))}</span>}
        {tag === "textarea"
          ? <textarea aria-label={stringProp(widget, "label", "Preview text")} value={inputValue} placeholder={placeholder} onChange={handleChange} />
          : <input aria-label={stringProp(widget, "label", "Preview input")} type={tag === "search" ? "search" : stringProp(widget, "type", "text")} value={inputValue} placeholder={placeholder} onChange={handleChange} />}
      </label>
    );
  }

  if (["checkbox", "toggle", "radio"].includes(widget.type)) {
    const rawLabel = stringProp(widget, "label", widget.type);
    const label = interpolate(rawLabel);
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
    const src = interpolate(source);
    return (
      <div className="preview-widget" style={style} {...commonHandlers}>
        {src ? <img src={src} alt={interpolate(stringProp(widget, "alt", text))} style={{ objectFit: stringProp(widget, "fit") === "cover" ? "cover" : "contain" }} /> : text || "Image"}
      </div>
    );
  }

  if (widget.type === "icon-button") {
    // An icon button shows its icon, in its own icon colour (B75), not the word "Button".
    const iconName = stringProp(widget, "iconName", "Plus");
    const Icon = getPreviewIconComponent(iconName);
    return (
      <button
        className="preview-widget is-button is-icon-button"
        aria-label={stringProp(widget, "label", "") || widget.name || `${iconName} button`}
        style={{ ...style, alignItems: "center", justifyContent: "center", padding: 0 }}
        {...commonHandlers}
      >
        <Icon
          width="56%"
          height="56%"
          color={stringProp(widget, "iconColor", readableTextOnFill(widget.style.fill ?? null, widget.style.fillOpacity ?? 1))}
          strokeWidth={2}
          aria-hidden="true"
          focusable="false"
        />
      </button>
    );
  }

  if (widget.type === "symbol-instance") {
    const symbol = symbols?.find((entry) => entry.id === widget.symbolId);
    if (!symbol) {
      return <div className="preview-widget preview-symbol-instance preview-symbol-missing" role="group" aria-label={`Missing component: ${widget.name ?? "Symbol"}`} style={{ ...style, display: "grid", placeItems: "center", border: "1px dashed currentColor" }} {...commonHandlers}>Missing component</div>;
    }
    if (symbolDepth >= 8) {
      return <div className="preview-widget preview-symbol-instance preview-symbol-depth-limit" role="note" style={style}>Nested component depth limit reached</div>;
    }
    const scaleX = widget.width / Math.max(1, symbol.width);
    const scaleY = widget.height / Math.max(1, symbol.height);
    const overrideRoot = widget.props.symbolOverrides && typeof widget.props.symbolOverrides === "object" && !Array.isArray(widget.props.symbolOverrides)
      ? widget.props.symbolOverrides as Record<string, unknown> : {};
    return (
      <div className="preview-widget preview-symbol-instance" role="group" aria-label={symbol.name} style={{ ...style, overflow: "hidden" }} {...commonHandlers} data-symbol-id={symbol.id}>
        <div style={{ position: "absolute", left: 0, top: 0, width: symbol.width, height: symbol.height, transform: `scale(${scaleX}, ${scaleY})`, transformOrigin: "top left" }}>
          {symbol.widgets.filter((child) => child.visible).sort((a, b) => a.zIndex - b.zIndex).map((sourceChild) => {
            const override = overrideRoot[sourceChild.id] && typeof overrideRoot[sourceChild.id] === "object" && !Array.isArray(overrideRoot[sourceChild.id])
              ? overrideRoot[sourceChild.id] as Record<string, unknown> : {};
            const overrideProps = override.props && typeof override.props === "object" && !Array.isArray(override.props)
              ? override.props as Record<string, unknown> : {};
            const overrideStyle = override.style && typeof override.style === "object" && !Array.isArray(override.style)
              ? override.style as Record<string, unknown> : {};
            const child: Widget = {
              ...sourceChild,
              props: { ...sourceChild.props, ...overrideProps },
              style: { ...sourceChild.style, ...overrideStyle } as Widget["style"],
            };
            return (
              <PreviewWidget
                key={child.id}
                widget={child}
                runtime={runtime}
                screenId={screenId}
                snapshot={snapshot}
                runEvent={runEvent}
                onError={onError}
                item={item}
                controlValues={controlValues}
                onControlValueChange={onControlValueChange}
                onGestureFeedback={onGestureFeedback}
                liteMode={liteMode}
                symbols={symbols}
                symbolDepth={symbolDepth + 1}
              />
            );
          })}
        </div>
      </div>
    );
  }

  if (widget.type === "button" || widget.type === "icon-button") {
    return <button className={`preview-widget is-button is-${stringProp(widget, "variant", "primary")}`} style={style} {...commonHandlers}>{text || "Button"}</button>;
  }

  if (widget.type === "heading") {
    const level = Math.max(1, Math.min(6, Number(widget.props.level) || 2));
    const HeadingTag = level === 1 ? "h1" : level === 2 ? "h2" : level === 3 ? "h3" : level === 4 ? "h4" : level === 5 ? "h5" : "h6";
    return <HeadingTag className="preview-widget preview-heading" style={{ ...style, margin: 0, fontSize: typeof widget.props.fontSize === "number" ? widget.props.fontSize : style.fontSize, fontWeight: typeof widget.props.fontWeight === "number" || typeof widget.props.fontWeight === "string" ? widget.props.fontWeight : 700 }} {...commonHandlers}>{text}</HeadingTag>;
  }

  if (widget.type === "paragraph") {
    return <p className="preview-widget preview-paragraph" style={{ ...style, margin: 0, lineHeight: typeof widget.props.lineHeight === "number" ? widget.props.lineHeight : 1.45 }} {...commonHandlers}>{text}</p>;
  }

  if (widget.type === "label") {
    return <label className="preview-widget preview-label" style={{ ...style, display: "block" }} {...commonHandlers}>{text}</label>;
  }

  if (widget.type === "link") {
    const href = sanitizeRichTextHref(stringProp(widget, "href", stringProp(widget, "url", "")));
    return href
      ? <a className="preview-widget preview-link" href={href} style={{ ...style, display: "inline-flex" }} {...commonHandlers}>{text}</a>
      : <span className="preview-widget preview-link is-unconfigured" role="link" aria-disabled="true" style={{ ...style, display: "inline-flex", textDecoration: "underline", opacity: 0.7 }} {...commonHandlers}>{text || "Link destination not configured"}</span>;
  }

  if (widget.type === "component-master") {
    const masterLabel = stringProp(widget, "label", widget.name ?? "Component master");
    return (
      <section
        className="preview-widget preview-component-master"
        role="group"
        aria-label={masterLabel}
        data-widget-type="component-master"
        style={{
          ...style,
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "flex-start",
          gap: 4,
          padding: 8,
          border: style.border ?? "1px dashed rgba(127, 127, 127, 0.65)",
          background: style.background ?? "rgba(127, 127, 127, 0.06)",
        }}
        {...commonHandlers}
      >
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", opacity: 0.7 }}>MASTER COMPONENT</span>
        <strong>{masterLabel}</strong>
      </section>
    );
  }

  if (["container", "frame", "group", "section", "panel", "dynamic-panel"].includes(widget.type)) {
    const label = stringProp(widget, "label", "");
    const activePanelState = widget.type === "dynamic-panel"
      ? getPanelStates(widget).find((state) => state.id === snapshot.panelStates[widget.id])?.name
      : undefined;
    const structuralStyle: CSSProperties = {
      ...style,
      boxSizing: "border-box",
      border: widget.type === "frame" || widget.type === "panel" || widget.type === "dynamic-panel"
        ? style.border ?? "1px solid rgba(127, 127, 127, 0.45)"
        : style.border,
      borderRadius: widget.type === "panel" || widget.type === "dynamic-panel" ? style.borderRadius ?? 6 : style.borderRadius,
      background: style.background ?? "transparent",
    };
    const Tag = widget.type === "section" ? "section" : "div";
    return (
      <Tag
        className={`preview-widget preview-structural preview-${widget.type}`}
        role={widget.type === "group" || widget.type === "panel" || widget.type === "dynamic-panel" ? "group" : undefined}
        aria-label={label || undefined}
        data-widget-type={widget.type}
        data-panel-state={snapshot.panelStates[widget.id]}
        style={structuralStyle}
        {...commonHandlers}
      >
        {activePanelState ? <span className="preview-panel-state-label">{activePanelState}</span> : null}
      </Tag>
    );
  }

  if (widget.type === "list") {
    const items = Array.isArray(widget.props.items)
      ? widget.props.items.filter((item): item is string => typeof item === "string")
      : [];
    return (
      <ul className="preview-widget preview-list" style={style} {...commonHandlers}>
        {items.map((item, index) => <li key={`${index}-${item}`}>{interpolate(item, screenId, undefined, widget)}</li>)}
      </ul>
    );
  }

  if (widget.type === "accordion") {
    const rawItems = Array.isArray(widget.props.items) ? widget.props.items : [];
    const items = rawItems.map((entry, index) => {
      if (typeof entry === "string") return { title: entry, body: "" };
      if (typeof entry === "object" && entry !== null) {
        const record = entry as Record<string, unknown>;
        const title = typeof record.title === "string" ? record.title
          : typeof record.label === "string" ? record.label
          : typeof record.question === "string" ? record.question
          : `Item ${index + 1}`;
        const body = typeof record.content === "string" ? record.content
          : typeof record.description === "string" ? record.description
          : typeof record.answer === "string" ? record.answer
          : "";
        return { title, body };
      }
      return { title: `Item ${index + 1}`, body: "" };
    });
    return (
      <section
        className="preview-widget preview-accordion"
        aria-label={stringProp(widget, "label", "Accordion")}
        style={{ ...style, display: "flex", flexDirection: "column", alignItems: "stretch", justifyContent: "flex-start", overflow: "auto", padding: 8, gap: 4 }}
        data-widget-type="accordion"
      >
        {items.length === 0 ? (
          <p role="note" style={{ margin: 4, fontSize: 12, opacity: 0.7 }}>No accordion items configured</p>
        ) : items.map((entry, index) => {
          const expanded = expandedAccordionItem === index;
          const panelId = `preview-accordion-${widget.id}-${index}`;
          return (
            <div key={`${index}-${entry.title}`} style={{ border: "1px solid rgba(127, 127, 127, 0.3)", borderRadius: 6, overflow: "hidden" }}>
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={panelId}
                onClick={(event) => {
                  event.stopPropagation();
                  setExpandedAccordionItem(expanded ? null : index);
                  runEvent(widget, "onClick", item);
                }}
                style={{ width: "100%", minHeight: 32, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "6px 10px", border: 0, background: "transparent", color: "inherit", textAlign: "left", cursor: "pointer", font: "inherit" }}
              >
                <span>{interpolate(entry.title)}</span>
                <span aria-hidden="true">{expanded ? "−" : "+"}</span>
              </button>
              <div
                id={panelId}
                role="region"
                hidden={!expanded}
                style={{ padding: "6px 10px", fontSize: 12 }}
              >
                {entry.body ? interpolate(entry.body) : <span style={{ opacity: 0.65 }}>No content configured</span>}
              </div>
            </div>
          );
        })}
      </section>
    );
  }

  if (widget.type === "image-gallery") {
    const rawImages = Array.isArray(widget.props.images) ? widget.props.images : [];
    const images = rawImages.map((entry, index) => {
      if (typeof entry === "string") return { src: entry, alt: `Image ${index + 1}` };
      if (typeof entry === "object" && entry !== null) {
        const record = entry as Record<string, unknown>;
        return { src: typeof record.src === "string" ? record.src : typeof record.url === "string" ? record.url : "", alt: typeof record.alt === "string" ? record.alt : `Image ${index + 1}` };
      }
      return { src: "", alt: `Image ${index + 1}` };
    }).filter(entry => entry.src.length > 0);
    return (
      <section className="preview-widget preview-image-gallery" aria-label={stringProp(widget, "label", "Image gallery")} data-widget-type="image-gallery" style={{ ...style, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 4, padding: 4, overflow: "auto" }} {...commonHandlers}>
        {images.length ? images.map((entry, index) => <img key={index} src={interpolate(entry.src)} alt={interpolate(entry.alt)} style={{ width: "100%", height: "100%", minHeight: 40, objectFit: "cover", borderRadius: 4 }} />) : <p role="note" style={{ margin: 4, fontSize: 12, opacity: 0.7 }}>No gallery images configured</p>}
      </section>
    );
  }

  if (widget.type === "audio") {
    const source = interpolate(stringProp(widget, "src", ""));
    return (
      <section className="preview-widget preview-audio" aria-label={stringProp(widget, "label", "Audio player")} data-widget-type="audio" style={{ ...style, display: "flex", flexDirection: "column", justifyContent: "center", padding: 8, gap: 4 }} {...commonHandlers}>
        {source ? <audio controls preload="metadata" src={source} style={{ width: "100%" }} /> : <p role="note" style={{ margin: 4, fontSize: 12, opacity: 0.7 }}>Audio source not configured</p>}
        <span style={{ fontSize: 12 }}>{stringProp(widget, "label", "Audio player")}</span>
      </section>
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
    return (
      <VirtualizedRepeater
        widget={widget}
        rows={rows}
        template={template}
        layout={layout}
        gap={gap}
        runtime={runtime}
        screenId={screenId}
        snapshot={snapshot}
        runEvent={runEvent}
        onError={onError}
        inputMode={inputMode}
        controlValues={controlValues}
        onControlValueChange={onControlValueChange}
        onGestureFeedback={onGestureFeedback}
        commonHandlers={commonHandlers}
        liteMode={liteMode}
        symbols={symbols}
      />
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
            let content: ReactNode = interpolate(part);
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
  // B69: give this window its own title so it is not mistaken for the editor.
  useEffect(() => {
    const previousTitle = document.title;
    document.title = previewWindowTitle(project?.name);
    return () => { document.title = previousTitle; };
  }, [project?.name]);
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
  const [liteMode, setLiteMode] = useState(false);
  useEffect(() => {
    trackEvent("preview_opened");
  }, []);
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
  const estimatedWidgetCount = useMemo(
    () => activeScreen
      ? estimateWidgetCount(activeScreen.widgets, runtimeSnapshot?.repeaterData)
      : 0,
    [activeScreen, runtimeSnapshot?.repeaterData],
  );
  const liteModeAvailable = estimatedWidgetCount > LITE_MODE_WIDGET_THRESHOLD;
  useEffect(() => {
    if (!liteModeAvailable) setLiteMode(false);
  }, [liteModeAvailable]);
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

  const publishRunResult = useCallback((runtime: PreviewRuntime, errors: string[]) => {
    const ranRules = runtime.lastRunRuleCount;
    if (ranRules > 0) trackEvent("preview_rule_fired");
    if (runtime.lastAddedRepeaterRows > 0) {
      trackEvent("repeater_row_added", { count: runtime.lastAddedRepeaterRows });
    }
    if (runtime.lastPanelStateChanges > 0) trackEvent("panel_state_changed");
    // B49: "Open link" actions open their address in a new tab, without giving it access to this window.
    for (const url of runtime.takePendingLinks()) window.open(url, "_blank", "noopener,noreferrer");
    setRuntimeSnapshot(runtime.snapshot());
    setRuntimeRevision((revision) => revision + 1);
    if (errors.length > 0) {
      console.error("Preview interaction errors.", errors);
      setToast(errors.join(" "));
    }
    return ranRules;
  }, []);

  const runEvent = useCallback((widget: Widget, event: PreviewEvent, item?: RepeaterRecord) => {
    const runtime = runtimeRef.current;
    if (!runtime) return 0;
    return publishRunResult(runtime, runtime.runEvent(widget, event, item));
  }, [publishRunResult]);

  const runLoadEvents = useCallback((widgets: Widget[]) => {
    const runtime = runtimeRef.current;
    if (!runtime) return 0;
    return publishRunResult(runtime, runtime.runLoadEvents(widgets));
  }, [publishRunResult]);

  useEffect(() => {
    if (!project || !runtimeRef.current) return;
    const screen = project.screens.find((item) => item.id === runtimeRef.current?.currentScreenId);
    if (!screen || loadedScreenRef.current === screen.id) return;
    loadedScreenRef.current = screen.id;
    // One call per screen load: screen-level rules run once even when the screen has no widgets.
    runLoadEvents(flattenActivePanelWidgets(
      screen.widgets,
      runtimeRef.current.snapshot().panelStates,
    ));
  }, [project, runtimeSnapshot?.screenId, runtimeRevision, runLoadEvents]);

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
      const { toPng } = await import("html-to-image");
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
                liteMode={liteMode}
                symbols={project.symbols}
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
        <label className="preview-zoom" title={PREVIEW_FIT_HINT}>
          {previewFitLabel(scalePercent)}
          <input aria-label="Preview zoom" type="range" min="25" max="150" step="5" value={scalePercent} onChange={(event) => setScalePercent(Number(event.currentTarget.value))} />
        </label>
        <button className="preview-capture-button" type="button" aria-label="Capture preview screenshot" title="Capture 2× PNG screenshot" onClick={() => void captureScreenshot()}><Camera size={15} /></button>
        <button type="button" aria-label="Toggle variables" aria-pressed={showVariables} title="Runtime variables" onClick={() => setShowVariables((value) => !value)}><SlidersHorizontal size={15} /></button>
        {isTauri() && <button type="button" aria-label="Detach preview" title="Detach preview window" onClick={() => void getCurrentWindow().setFocus().catch((error: unknown) => {
          console.error("Could not focus the preview window.", error);
          setToast(error instanceof Error ? error.message : "Could not focus the preview window.");
        })}><X size={15} /></button>}
      </header>
      {liteModeAvailable && (
        <div className="preview-performance-warning" role="status">
          <span>
            This screen contains more than {LITE_MODE_WIDGET_THRESHOLD.toLocaleString()} widgets.
            {liteMode
              ? " Live expressions are paused and repeater overscan is disabled."
              : " Enable Lite Mode to pause live expressions and reduce repeater rendering."}
          </span>
          <button
            type="button"
            aria-pressed={liteMode}
            onClick={() => setLiteMode((enabled) => !enabled)}
          >
            {liteMode ? "Disable Lite Mode" : "Enable Lite Mode"}
          </button>
        </div>
      )}
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
