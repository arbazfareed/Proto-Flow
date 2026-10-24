import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  Arrow,
  Arc,
  Circle,
  Ellipse,
  Group,
  Image as KonvaImage,
  Line,
  Rect,
  Star as KonvaStar,
  Text as KonvaText,
} from "react-konva";
import type Konva from "konva";
import type { RichTextMarks, RichTextRun, Widget } from "../project/schema";
import { normalizeRichTextRuns, parseRichTextMarkdown } from "../project/richText";
import { useStore } from "../store";
import {
  SHAPE_TOOL_DEFINITIONS,
  SHAPE_TOOLS,
  type PrimitiveTool,
  type ShapeTool,
  type ShapeToolDefinition,
  type WidgetTool,
} from "./shapeTools";
import { MAX_WIDGET_TEXT_LENGTH } from "./textMeasurement";
import { getSafeBlendMode, normalizeListItems, styleColorToRgba } from "./styleInspector";
import { renderCanvasIconSvg } from "./iconLibrary";
export { measureTextBounds } from "./textMeasurement";
export { SHAPE_TOOLS };
export type { ShapeTool };

export interface ShapeComponentProps {
  widget: Widget;
  fill: string | undefined;
  stroke: string | undefined;
  strokeWidth: number;
  onThumbnailReady?: () => void;
}

export interface ShapeDefinition extends ShapeToolDefinition {
  component: ComponentType<ShapeComponentProps>;
}

const DEFAULT_STROKE = "#a78bfa";
export { MAX_WIDGET_TEXT_LENGTH } from "./textMeasurement";

function getPoints(widget: Widget): number[] {
  const points = widget.props.points;
  if (
    Array.isArray(points) &&
    points.length >= 4 &&
    points.length % 2 === 0 &&
    points.every((point) => typeof point === "number" && Number.isFinite(point))
  ) {
    return points;
  }
  return [0, 0, widget.width, widget.height];
}

function RectangleShape({ widget, fill, stroke, strokeWidth }: ShapeComponentProps) {
  const cornerRadius = widget.style.cornerRadius ?? 0;
  return (
    <Rect
      width={widget.width}
      height={widget.height}
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
      dash={widget.style.dash}
      lineCap={widget.style.lineCap ?? "round"}
      lineJoin={widget.style.lineJoin ?? "round"}
      cornerRadius={cornerRadius}
      perfectDrawEnabled={false}
    />
  );
}

function EllipseShape({ widget, fill, stroke, strokeWidth }: ShapeComponentProps) {
  return (
    <Ellipse
      x={widget.width / 2}
      y={widget.height / 2}
      radiusX={widget.width / 2}
      radiusY={widget.height / 2}
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
      dash={widget.style.dash}
      lineCap={widget.style.lineCap ?? "round"}
      lineJoin={widget.style.lineJoin ?? "round"}
      perfectDrawEnabled={false}
    />
  );
}

function TextShape({ widget, fill, stroke, strokeWidth }: ShapeComponentProps) {
  if (widget.props.richText === true) {
    return <RichTextShape widget={widget} fill={fill} />;
  }
  const fontSize = typeof widget.props.fontSize === "number" ? widget.props.fontSize : 24;
  const fontFamily =
    typeof widget.props.fontFamily === "string" ? widget.props.fontFamily : "Arial";
  const fontWeight =
    typeof widget.props.fontWeight === "string" ? widget.props.fontWeight : "normal";
  const fontStyle =
    typeof widget.props.fontStyle === "string" ? widget.props.fontStyle : "normal";
  const text = typeof widget.props.text === "string"
    ? widget.props.text.slice(0, MAX_WIDGET_TEXT_LENGTH)
    : "Text";

  return (
    <KonvaText
      width={widget.width}
      height={widget.height}
      text={text}
      fontFamily={fontFamily}
      fontSize={fontSize}
      fontStyle={`${fontStyle} ${fontWeight}`.trim()}
      letterSpacing={typeof widget.props.letterSpacing === "number" ? widget.props.letterSpacing : 0}
      textDecoration={widget.props.underline === true ? "underline" : undefined}
      align={typeof widget.props.align === "string" ? widget.props.align : "left"}
      verticalAlign={typeof widget.props.verticalAlign === "string" ? widget.props.verticalAlign : "top"}
      lineHeight={
        typeof widget.props.lineHeight === "number" ? widget.props.lineHeight : 1.2
      }
      wrap="word"
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
      dash={widget.style.dash}
      perfectDrawEnabled={false}
    />
  );
}

function RichTextShape({ widget, fill }: Pick<ShapeComponentProps, "widget" | "fill">) {
  const source = typeof widget.props.text === "string" ? widget.props.text : "";
  const runs = Array.isArray(widget.props.richTextRuns)
    ? normalizeRichTextRuns(widget.props.richTextRuns, source)
    : parseRichTextMarkdown(source);
  const fontFamily = typeof widget.props.fontFamily === "string" ? widget.props.fontFamily : "Arial";
  const baseSize = typeof widget.props.fontSize === "number" ? widget.props.fontSize : 24;
  const lineHeight = typeof widget.props.lineHeight === "number" ? widget.props.lineHeight : 1.2;
  const defaultColor = fill ?? "#e9e9ec";
  const measureContext = typeof document === "undefined"
    ? null
    : document.createElement("canvas").getContext("2d");
  const measure = (text: string, marks: RichTextMarks): number => {
    const fontSize = marks.fontSize ?? baseSize;
    const family = marks.code ? "monospace" : fontFamily;
    const fontStyle = `${marks.italic ? "italic " : ""}${marks.bold ? "bold " : ""}${fontSize}px ${family}`;
    if (!measureContext) return text.length * fontSize * 0.55;
    measureContext.font = fontStyle;
    return measureContext.measureText(text).width;
  };
  const nodes: ReactNode[] = [
    <Rect
      key="hit-area"
      width={widget.width}
      height={widget.height}
      fill="#000000"
      opacity={0.001}
      perfectDrawEnabled={false}
    />,
  ];
  let x = 0;
  let y = 0;
  let listIndex = 0;
  const newLine = () => {
    x = 0;
    y += baseSize * lineHeight;
    listIndex += 1;
  };
  const addText = (text: string, marks: RichTextMarks) => {
    if (!text) return;
    const fontSize = marks.fontSize ?? baseSize;
    const prefix = marks.list
      ? x === 0 ? `${marks.list === "number" ? `${listIndex + 1}.` : "•"} ` : ""
      : "";
    if (prefix) {
      const prefixWidth = measure(prefix, marks);
      nodes.push(<KonvaText
        key={`list-${nodes.length}`}
        x={x}
        y={y}
        text={prefix}
        fontFamily={fontFamily}
        fontSize={baseSize}
        fill={defaultColor}
        listening={false}
        perfectDrawEnabled={false}
      />);
      x += prefixWidth;
    }
    const pieces = text.match(/\s+|[^\s]+/g) ?? [];
    for (const piece of pieces) {
      const width = measure(piece, marks);
      if (x > 0 && x + width > widget.width && !/^\s+$/.test(piece)) newLine();
      const atX = x;
      const atY = y;
      const atWidth = Math.max(width, 1);
      if (marks.highlight) {
        nodes.push(<Rect
          key={`highlight-${nodes.length}`}
          x={atX}
          y={atY}
          width={atWidth}
          height={fontSize * lineHeight}
          fill={marks.highlight}
          listening={false}
          perfectDrawEnabled={false}
        />);
      }
      const color = marks.color ?? (marks.link ? "#60a5fa" : defaultColor);
      nodes.push(<KonvaText
        key={`text-${nodes.length}`}
        x={atX}
        y={atY}
        width={atWidth}
        height={fontSize * lineHeight}
        text={piece}
        fontFamily={marks.code ? "monospace" : fontFamily}
        fontSize={fontSize}
        fontStyle={`${marks.italic ? "italic " : ""}${marks.bold ? "bold" : ""}`.trim() || "normal"}
        textDecoration={marks.underline || marks.link ? "underline" : marks.strike ? "line-through" : undefined}
        fill={color}
        listening={false}
        perfectDrawEnabled={false}
      />);
      x += width;
    }
  };

  for (const run of runs as RichTextRun[]) {
    const parts = run.text.split("\n");
    parts.forEach((part, index) => {
      addText(part, run.marks);
      if (index < parts.length - 1) newLine();
    });
  }
  return <>{nodes}</>;
}

function ListShape({ widget, fill }: ShapeComponentProps) {
  const items = normalizeListItems(widget.props.items);
  const numbered = widget.props.listStyle === "number";
  const text = (items.length > 0 ? items : ["List item 1", "List item 2", "List item 3"])
    .map((item, index) => `${numbered ? `${index + 1}.` : "•"}  ${item}`)
    .join("\n");

  return (
    <KonvaText
      width={widget.width}
      height={widget.height}
      text={text}
      fontFamily={typeof widget.props.fontFamily === "string" ? widget.props.fontFamily : "Arial"}
      fontSize={typeof widget.props.fontSize === "number" ? widget.props.fontSize : 16}
      fontStyle={`${typeof widget.props.fontStyle === "string" ? widget.props.fontStyle : "normal"} ${typeof widget.props.fontWeight === "string" ? widget.props.fontWeight : "normal"}`.trim()}
      textDecoration={widget.props.underline === true ? "underline" : undefined}
      align={typeof widget.props.align === "string" ? widget.props.align : "left"}
      verticalAlign={typeof widget.props.verticalAlign === "string" ? widget.props.verticalAlign : "top"}
      lineHeight={typeof widget.props.lineHeight === "number" ? widget.props.lineHeight : 1.4}
      letterSpacing={typeof widget.props.letterSpacing === "number" ? widget.props.letterSpacing : 0}
      fill={fill ?? "#e9e9ec"}
      wrap="word"
      perfectDrawEnabled={false}
    />
  );
}

function LineShape({ widget, stroke, strokeWidth }: ShapeComponentProps) {
  return (
    <Line
      points={getPoints(widget)}
      stroke={stroke}
      strokeWidth={strokeWidth}
      lineCap={widget.style.lineCap ?? "round"}
      lineJoin={widget.style.lineJoin ?? "round"}
      perfectDrawEnabled={false}
    />
  );
}

function ArrowShape({ widget, stroke, strokeWidth }: ShapeComponentProps) {
  return (
    <Arrow
      points={getPoints(widget)}
      stroke={stroke}
      fill={stroke}
      strokeWidth={strokeWidth}
      dash={widget.style.dash}
      pointerLength={typeof widget.props.pointerLength === "number" ? widget.props.pointerLength : 10}
      pointerWidth={typeof widget.props.pointerWidth === "number" ? widget.props.pointerWidth : 8}
      lineCap={widget.style.lineCap ?? "round"}
      lineJoin={widget.style.lineJoin ?? "round"}
      perfectDrawEnabled={false}
    />
  );
}

function CanvasIcon({
  name,
  color,
  strokeWidth,
  x = 0,
  y = 0,
  width,
  height,
}: {
  name: string;
  color: string;
  strokeWidth: number;
  x?: number;
  y?: number;
  width: number;
  height: number;
}) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [failed, setFailed] = useState(false);
  const source = useMemo(
    () =>
      `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
        renderCanvasIconSvg(name, color, strokeWidth),
      )}`,
    [color, name, strokeWidth],
  );

  useEffect(() => {
    let active = true;
    const element = new window.Image();
    element.onload = () => {
      if (active) {
        setImage(element);
        setFailed(false);
      }
    };
    element.onerror = () => {
      if (active) {
        console.error(`Could not render the "${name}" canvas icon.`);
        setImage(null);
        setFailed(true);
      }
    };
    element.src = source;
    return () => {
      active = false;
    };
  }, [name, source]);

  if (image) {
    return (
      <KonvaImage
        image={image}
        x={x}
        y={y}
        width={width}
        height={height}
        perfectDrawEnabled={false}
      />
    );
  }
  if (failed) {
    return (
      <KonvaStar
        x={x + width / 2}
        y={y + height / 2}
        numPoints={5}
        innerRadius={Math.min(width, height) * 0.22}
        outerRadius={Math.min(width, height) * 0.45}
        stroke={color}
        strokeWidth={strokeWidth}
        perfectDrawEnabled={false}
      />
    );
  }
  return null;
}

function IconShape({ widget, stroke, strokeWidth }: ShapeComponentProps) {
  return (
    <CanvasIcon
      name={getWidgetProp(widget, "iconName", "Star")}
      color={stroke ?? DEFAULT_STROKE}
      strokeWidth={strokeWidth}
      width={widget.width}
      height={widget.height}
    />
  );
}

function getWidgetProp(widget: Widget, key: string, fallback = ""): string {
  const value = widget.props[key];
  return typeof value === "string"
    ? value.slice(0, MAX_WIDGET_TEXT_LENGTH)
    : fallback;
}

function ButtonShape({ widget, fill: baseFill, stroke, strokeWidth }: ShapeComponentProps) {
  const [pointerState, setPointerState] = useState<"default" | "hover" | "pressed">("default");
  const variant = getWidgetProp(widget, "variant", "primary");
  const state = getWidgetProp(widget, "state", "default");
  const disabled = state === "disabled";
  const visualState = disabled ? "disabled" : state === "default" ? pointerState : state;
  const colors = variant === "ghost"
    ? { fill: "transparent", stroke: "#5d5277", text: "#d9d0ef" }
    : variant === "secondary"
      ? { fill: "#292a30", stroke: "#45464e", text: "#e9e9ec" }
      : { fill: "#8b69ed", stroke: "#8b69ed", text: "#ffffff" };
  const fill =
    visualState === "pressed"
      ? "#6247b3"
      : visualState === "hover" && variant !== "ghost"
        ? "#9a7cf4"
        : colors.fill;

  return (
    <Group
      onMouseEnter={() => setPointerState("hover")}
      onMouseLeave={() => setPointerState("default")}
      onMouseDown={() => setPointerState("pressed")}
      onMouseUp={() => setPointerState("hover")}
      opacity={disabled ? 0.48 : 1}
    >
      <Rect
        width={widget.width}
        height={widget.height}
        fill={widget.style.fill === null ? undefined : baseFill ?? fill ?? colors.fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        dash={widget.style.dash}
        lineCap={widget.style.lineCap ?? "round"}
        lineJoin={widget.style.lineJoin ?? "round"}
        cornerRadius={widget.style.cornerRadius ?? Math.min(8, widget.height / 2)}
        perfectDrawEnabled={false}
      />
      <KonvaText
        width={widget.width}
        height={widget.height}
        text={getWidgetProp(widget, "label", "Button")}
        fontSize={typeof widget.props.fontSize === "number" ? widget.props.fontSize : Math.max(10, Math.min(14, widget.height * 0.36))}
        fontFamily={typeof widget.props.fontFamily === "string" ? widget.props.fontFamily : "Arial"}
        fontStyle={`${typeof widget.props.fontStyle === "string" ? widget.props.fontStyle : "normal"} ${typeof widget.props.fontWeight === "string" ? widget.props.fontWeight : "bold"}`.trim()}
        textDecoration={widget.props.underline === true ? "underline" : undefined}
        letterSpacing={typeof widget.props.letterSpacing === "number" ? widget.props.letterSpacing : 0}
        lineHeight={typeof widget.props.lineHeight === "number" ? widget.props.lineHeight : 1.2}
        align={typeof widget.props.align === "string" ? widget.props.align : "center"}
        verticalAlign={typeof widget.props.verticalAlign === "string" ? widget.props.verticalAlign : "middle"}
        fill={variant === "primary" ? "#191321" : colors.text}
        perfectDrawEnabled={false}
      />
    </Group>
  );
}

function InputShape({ widget, fill, stroke, strokeWidth }: ShapeComponentProps) {
  const label = getWidgetProp(widget, "label");
  const value = getWidgetProp(widget, "value");
  const displayedValue = value
    ? getWidgetProp(widget, "type") === "password"
      ? "•".repeat(value.length)
      : value
    : getWidgetProp(widget, "placeholder", "Enter text…");

  return (
    <Group>
      {label && (
        <KonvaText
          y={-19}
          width={widget.width}
          height={16}
          text={label}
          fontSize={typeof widget.props.fontSize === "number" ? widget.props.fontSize : 12}
          fontFamily={typeof widget.props.fontFamily === "string" ? widget.props.fontFamily : "Arial"}
          fontStyle={`${typeof widget.props.fontStyle === "string" ? widget.props.fontStyle : "normal"} ${typeof widget.props.fontWeight === "string" ? widget.props.fontWeight : "normal"}`.trim()}
          textDecoration={widget.props.underline === true ? "underline" : undefined}
          letterSpacing={typeof widget.props.letterSpacing === "number" ? widget.props.letterSpacing : 0}
          lineHeight={typeof widget.props.lineHeight === "number" ? widget.props.lineHeight : 1.2}
          fill="#c5c5cc"
          perfectDrawEnabled={false}
        />
      )}
      <Rect
        width={widget.width}
        height={widget.height}
        fill={widget.style.fill === null ? undefined : fill ?? "#1e1f23"}
        stroke={stroke}
        strokeWidth={strokeWidth}
        dash={widget.style.dash}
        lineCap={widget.style.lineCap ?? "round"}
        lineJoin={widget.style.lineJoin ?? "round"}
        cornerRadius={widget.style.cornerRadius ?? Math.min(6, widget.height / 3)}
        perfectDrawEnabled={false}
      />
      <KonvaText
        x={12}
        width={Math.max(1, widget.width - 24)}
        height={widget.height}
        text={displayedValue}
        fontSize={typeof widget.props.fontSize === "number" ? widget.props.fontSize : Math.max(10, Math.min(14, widget.height * 0.36))}
        fontFamily={typeof widget.props.fontFamily === "string" ? widget.props.fontFamily : "Arial"}
        fontStyle={`${typeof widget.props.fontStyle === "string" ? widget.props.fontStyle : "normal"} ${typeof widget.props.fontWeight === "string" ? widget.props.fontWeight : "normal"}`.trim()}
        textDecoration={widget.props.underline === true ? "underline" : undefined}
        letterSpacing={typeof widget.props.letterSpacing === "number" ? widget.props.letterSpacing : 0}
        lineHeight={typeof widget.props.lineHeight === "number" ? widget.props.lineHeight : 1.2}
        align={typeof widget.props.align === "string" ? widget.props.align : "left"}
        verticalAlign={typeof widget.props.verticalAlign === "string" ? widget.props.verticalAlign : "middle"}
        fill={value ? "#e9e9ec" : "#85858f"}
        perfectDrawEnabled={false}
      />
    </Group>
  );
}

function CheckboxShape({ widget, fill, stroke, strokeWidth }: ShapeComponentProps) {
  const checked = widget.props.checked === true;
  const size = Math.min(20, widget.height);
  return (
    <Group>
      <Rect
        x={1}
        y={(widget.height - size) / 2}
        width={size}
        height={size}
        fill={widget.style.fill === null ? undefined : fill ?? (checked ? "#8b69ed" : undefined)}
        stroke={stroke}
        strokeWidth={strokeWidth}
        dash={widget.style.dash}
        lineCap={widget.style.lineCap ?? "round"}
        lineJoin={widget.style.lineJoin ?? "round"}
        cornerRadius={widget.style.cornerRadius ?? 4}
        perfectDrawEnabled={false}
      />
      {checked && (
        <Line
          points={[5, widget.height / 2, 9, widget.height / 2 + 4, 16, widget.height / 2 - 4]}
          stroke="#191321"
          strokeWidth={2}
          lineCap="round"
          lineJoin="round"
          perfectDrawEnabled={false}
        />
      )}
      <KonvaText
        x={size + 9}
        width={Math.max(1, widget.width - size - 9)}
        height={widget.height}
        text={getWidgetProp(widget, "label", "Checkbox")}
        fontSize={typeof widget.props.fontSize === "number" ? widget.props.fontSize : Math.max(10, Math.min(14, widget.height * 0.58))}
        fontFamily={typeof widget.props.fontFamily === "string" ? widget.props.fontFamily : "Arial"}
        fontStyle={`${typeof widget.props.fontStyle === "string" ? widget.props.fontStyle : "normal"} ${typeof widget.props.fontWeight === "string" ? widget.props.fontWeight : "normal"}`.trim()}
        textDecoration={widget.props.underline === true ? "underline" : undefined}
        letterSpacing={typeof widget.props.letterSpacing === "number" ? widget.props.letterSpacing : 0}
        lineHeight={typeof widget.props.lineHeight === "number" ? widget.props.lineHeight : 1.2}
        align={typeof widget.props.align === "string" ? widget.props.align : "left"}
        verticalAlign={typeof widget.props.verticalAlign === "string" ? widget.props.verticalAlign : "middle"}
        fill="#d7d6dd"
        perfectDrawEnabled={false}
      />
    </Group>
  );
}

function RadioShape({ widget, fill, stroke, strokeWidth }: ShapeComponentProps) {
  const selected = widget.props.selected === true;
  const size = Math.min(20, widget.height);
  return (
    <Group>
      <Circle
        x={size / 2 + 1}
        y={widget.height / 2}
        radius={size / 2 - 1}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        perfectDrawEnabled={false}
      />
      {selected && (
        <Circle
          x={size / 2 + 1}
          y={widget.height / 2}
          radius={size / 4}
          fill="#a78bfa"
          perfectDrawEnabled={false}
        />
      )}
      <KonvaText
        x={size + 9}
        width={Math.max(1, widget.width - size - 9)}
        height={widget.height}
        text={getWidgetProp(widget, "label", "Radio")}
        fontSize={typeof widget.props.fontSize === "number" ? widget.props.fontSize : Math.max(10, Math.min(14, widget.height * 0.58))}
        fontFamily={typeof widget.props.fontFamily === "string" ? widget.props.fontFamily : "Arial"}
        fontStyle={`${typeof widget.props.fontStyle === "string" ? widget.props.fontStyle : "normal"} ${typeof widget.props.fontWeight === "string" ? widget.props.fontWeight : "normal"}`.trim()}
        textDecoration={widget.props.underline === true ? "underline" : undefined}
        letterSpacing={typeof widget.props.letterSpacing === "number" ? widget.props.letterSpacing : 0}
        lineHeight={typeof widget.props.lineHeight === "number" ? widget.props.lineHeight : 1.2}
        align={typeof widget.props.align === "string" ? widget.props.align : "left"}
        verticalAlign={typeof widget.props.verticalAlign === "string" ? widget.props.verticalAlign : "middle"}
        fill="#d7d6dd"
        perfectDrawEnabled={false}
      />
    </Group>
  );
}

function ToggleShape({ widget, fill, stroke, strokeWidth }: ShapeComponentProps) {
  const isOn = widget.props.on === true;
  const label = getWidgetProp(widget, "label");
  const knobSize = Math.max(8, widget.height - 8);
  return (
    <Group>
      <Rect
        width={widget.width}
        height={widget.height}
        fill={widget.style.fill === null ? undefined : fill ?? (isOn ? "#8b69ed" : "#34353b")}
        stroke={stroke}
        strokeWidth={strokeWidth}
        dash={widget.style.dash}
        lineCap={widget.style.lineCap ?? "round"}
        lineJoin={widget.style.lineJoin ?? "round"}
        cornerRadius={widget.style.cornerRadius ?? widget.height / 2}
        perfectDrawEnabled={false}
      />
      <Circle
        x={isOn ? widget.width - widget.height / 2 : widget.height / 2}
        y={widget.height / 2}
        radius={knobSize / 2}
        fill="#ffffff"
        perfectDrawEnabled={false}
      />
      {label && (
        <KonvaText
          x={widget.width + 10}
          width={180}
          height={widget.height}
          text={label}
          fontSize={typeof widget.props.fontSize === "number" ? widget.props.fontSize : Math.max(10, Math.min(14, widget.height * 0.45))}
          fontFamily={typeof widget.props.fontFamily === "string" ? widget.props.fontFamily : "Arial"}
          fontStyle={`${typeof widget.props.fontStyle === "string" ? widget.props.fontStyle : "normal"} ${typeof widget.props.fontWeight === "string" ? widget.props.fontWeight : "normal"}`.trim()}
          textDecoration={widget.props.underline === true ? "underline" : undefined}
          letterSpacing={typeof widget.props.letterSpacing === "number" ? widget.props.letterSpacing : 0}
          lineHeight={typeof widget.props.lineHeight === "number" ? widget.props.lineHeight : 1.2}
          align={typeof widget.props.align === "string" ? widget.props.align : "left"}
          verticalAlign={typeof widget.props.verticalAlign === "string" ? widget.props.verticalAlign : "middle"}
          fill="#d7d6dd"
          perfectDrawEnabled={false}
        />
      )}
    </Group>
  );
}

function ImageShape({ widget, stroke, strokeWidth, onThumbnailReady }: ShapeComponentProps) {
  const filePath = useStore((state) => state.filePath);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const imageNodeRef = useRef<Konva.Image>(null);
  const source = typeof widget.props.src === "string" ? widget.props.src : "";
  const assetPath = getWidgetProp(widget, "assetPath");
  const mime = getWidgetProp(widget, "mime");

  useEffect(() => {
    let active = true;
    setImage(null);
    setLoadError(null);
    const load = async () => {
      let sourceData = source;
      if (!sourceData && assetPath && filePath && isTauri()) {
        const asset = await invoke<{ mime: string; base64: string }>("read_image_asset", {
          projectPath: filePath,
          assetPath,
        });
        sourceData = `data:${asset.mime};base64,${asset.base64}`;
      }
      if (!sourceData) {
        if (assetPath) {
          setLoadError("The linked image asset is not available in this project.");
        }
        onThumbnailReady?.();
        return;
      }
      const element = new window.Image();
      element.onload = () => {
        if (active) setImage(element);
      };
      element.onerror = () => {
        if (active) {
          setImage(null);
          setLoadError("This image format could not be decoded by the current device.");
          onThumbnailReady?.();
        }
      };
      element.crossOrigin = "anonymous";
      element.src = sourceData.startsWith("data:")
        ? sourceData
        : /^https:\/\//i.test(sourceData)
          ? sourceData
          : `data:${mime};base64,${sourceData}`;
    };
    void load().catch((error: unknown) => {
      console.error("Could not load the project image asset.", error);
      if (active) {
        setLoadError(
          error instanceof Error ? error.message : "Could not load the project image asset.",
        );
      }
      onThumbnailReady?.();
    });
    return () => {
      active = false;
    };
  }, [assetPath, filePath, mime, onThumbnailReady, source]);

  useEffect(() => {
    if (!image) return;
    const node = imageNodeRef.current;
    if (!node) return;
    node.clearCache();
    node.cache({ pixelRatio: 1 });
    node.getLayer()?.batchDraw();
    onThumbnailReady?.();
  }, [image, onThumbnailReady]);

  if (image) {
    return (
      <KonvaImage
        ref={imageNodeRef}
        image={image}
        width={widget.width}
        height={widget.height}
        imageSmoothingEnabled={widget.props.pixelPerfect !== true}
        stroke={stroke}
        strokeWidth={strokeWidth}
        perfectDrawEnabled={false}
      />
    );
  }
  const iconWidth = Math.min(38, Math.max(24, widget.width * 0.16));
  const iconHeight = iconWidth * 0.72;
  const iconX = (widget.width - iconWidth) / 2;
  const showHint = widget.height > 110 && widget.width > 150;
  const headingHeight = Math.max(18, Math.min(24, widget.height * 0.2));
  const hintHeight = showHint ? 22 : 0;
  const contentHeight = iconHeight + 8 + headingHeight + (showHint ? 3 + hintHeight : 0);
  const iconY = Math.max(4, (widget.height - contentHeight) / 2);
  const heading = loadError ? "Couldn't load this image" : "Add an image";
  const hint = loadError ? "Double-click to choose a replacement" : "Drop an image here or double-click to browse";
  return (
    <Group>
      <Rect
        width={widget.width}
        height={widget.height}
        fill={loadError ? "#fff5f5" : "#f4f7fb"}
        stroke={loadError ? "#e7a7a7" : "#c9d4e2"}
        strokeWidth={loadError ? Math.max(1, Math.min(3, strokeWidth)) : 1}
        dash={loadError ? [5, 4] : [7, 5]}
        cornerRadius={8}
        perfectDrawEnabled={false}
      />
      <Rect
        x={iconX}
        y={iconY}
        width={iconWidth}
        height={iconHeight}
        cornerRadius={4}
        stroke={loadError ? "#cc7272" : "#7e9ac2"}
        strokeWidth={1.5}
        perfectDrawEnabled={false}
      />
      <Circle
        x={iconX + iconWidth * 0.72}
        y={iconY + iconHeight * 0.28}
        radius={Math.max(1.5, iconWidth * 0.07)}
        fill={loadError ? "#cc7272" : "#7e9ac2"}
        perfectDrawEnabled={false}
      />
      <Line
        points={[
          iconX + iconWidth * 0.12, iconY + iconHeight * 0.82,
          iconX + iconWidth * 0.38, iconY + iconHeight * 0.48,
          iconX + iconWidth * 0.56, iconY + iconHeight * 0.69,
          iconX + iconWidth * 0.72, iconY + iconHeight * 0.52,
          iconX + iconWidth * 0.9, iconY + iconHeight * 0.82,
        ]}
        stroke={loadError ? "#cc7272" : "#7e9ac2"}
        strokeWidth={1.5}
        lineCap="round"
        lineJoin="round"
        perfectDrawEnabled={false}
      />
      <KonvaText
        y={iconY + iconHeight + 8}
        width={widget.width}
        height={headingHeight}
        text={heading}
        fontSize={Math.max(11, Math.min(15, widget.width / 20))}
        fontFamily="Arial"
        align="center"
        verticalAlign="middle"
        fontStyle="bold"
        fill={loadError ? "#a95050" : "#46566d"}
        padding={8}
        wrap="word"
        perfectDrawEnabled={false}
      />
      {showHint && (
        <KonvaText
          y={iconY + iconHeight + 8 + headingHeight + 3}
          width={widget.width}
          height={hintHeight}
          text={hint}
          fontSize={Math.max(9, Math.min(11, widget.width / 24))}
          fontFamily="Arial"
          align="center"
          verticalAlign="top"
          fill={loadError ? "#aa7373" : "#7b8798"}
          padding={6}
          wrap="word"
          perfectDrawEnabled={false}
        />
      )}
    </Group>
  );
}

function AvatarShape({ widget, fill, stroke, strokeWidth }: ShapeComponentProps) {
  const label = getWidgetProp(widget, "initials", "").trim();
  const initials =
    label ||
    getWidgetProp(widget, "label", "User")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") ||
    "U";
  const radius = Math.min(widget.width, widget.height) / 2;
  return (
    <Group>
      <Circle
        x={widget.width / 2}
        y={widget.height / 2}
        radius={radius}
        fill={fill ?? "#6366f1"}
        stroke={stroke}
        strokeWidth={strokeWidth}
        perfectDrawEnabled={false}
      />
      <KonvaText
        width={widget.width}
        height={widget.height}
        text={initials.slice(0, 3)}
        fontFamily="Arial"
        fontSize={Math.max(10, radius * 0.72)}
        fontStyle="bold"
        fill="#ffffff"
        align="center"
        verticalAlign="middle"
        perfectDrawEnabled={false}
      />
    </Group>
  );
}

function IconButtonShape({ widget, fill, stroke, strokeWidth }: ShapeComponentProps) {
  const iconSize = Math.min(widget.width, widget.height) * 0.56;
  return (
    <Group>
      <Rect
        width={widget.width}
        height={widget.height}
        fill={fill ?? "#272431"}
        stroke={stroke ?? "#5d5277"}
        strokeWidth={strokeWidth}
        cornerRadius={widget.style.cornerRadius ?? 8}
        perfectDrawEnabled={false}
      />
      <CanvasIcon
        name={getWidgetProp(widget, "iconName", "Plus")}
        color="#e9e4f5"
        strokeWidth={2}
        x={(widget.width - iconSize) / 2}
        y={(widget.height - iconSize) / 2}
        width={iconSize}
        height={iconSize}
      />
    </Group>
  );
}

function PillShape({ widget, fill, stroke, strokeWidth }: ShapeComponentProps) {
  return (
    <Group>
      <Rect
        width={widget.width}
        height={widget.height}
        fill={fill ?? "#283345"}
        stroke={stroke}
        strokeWidth={strokeWidth}
        cornerRadius={widget.height / 2}
        perfectDrawEnabled={false}
      />
      {widget.type === "badge" && (
        <Circle
          x={Math.max(8, widget.height * 0.42)}
          y={widget.height / 2}
          radius={Math.max(2, widget.height * 0.09)}
          fill={stroke ?? "#60a5fa"}
          perfectDrawEnabled={false}
        />
      )}
      <KonvaText
        x={widget.type === "badge" ? widget.height * 0.7 : 8}
        width={Math.max(1, widget.width - (widget.type === "badge" ? widget.height : 16))}
        height={widget.height}
        text={getWidgetProp(widget, "label", widget.type === "tag" ? "Tag" : "New")}
        fontFamily="Arial"
        fontSize={Math.max(10, Math.min(14, widget.height * 0.42))}
        fontStyle="bold"
        fill="#e5e7eb"
        align="center"
        verticalAlign="middle"
        ellipsis
        perfectDrawEnabled={false}
      />
    </Group>
  );
}

const NOTICE_ICONS: Record<string, string> = {
  alert: "AlertCircle",
  banner: "Info",
  toast: "CheckCircle2",
  notification: "Bell",
  tooltip: "CircleHelp",
  popover: "MessageCircle",
};

function NoticeShape({ widget, fill, stroke, strokeWidth }: ShapeComponentProps) {
  const iconColor = stroke ?? "#60a5fa";
  const iconSize = Math.min(22, Math.max(16, widget.height * 0.24));
  const hasSubtitle = typeof widget.props.subtitle === "string";
  return (
    <Group>
      <Rect
        width={widget.width}
        height={widget.height}
        fill={fill ?? "#202838"}
        stroke={stroke ?? "#34445d"}
        strokeWidth={strokeWidth}
        cornerRadius={widget.style.cornerRadius ?? 8}
        perfectDrawEnabled={false}
      />
      <Rect
        width={4}
        height={widget.height}
        fill={iconColor}
        cornerRadius={2}
        perfectDrawEnabled={false}
      />
      <CanvasIcon
        name={NOTICE_ICONS[widget.type] ?? "Info"}
        color={iconColor}
        strokeWidth={2}
        x={12}
        y={(widget.height - iconSize) / 2}
        width={iconSize}
        height={iconSize}
      />
      <KonvaText
        x={iconSize + 22}
        y={hasSubtitle ? 12 : 0}
        width={Math.max(1, widget.width - iconSize - 34)}
        height={hasSubtitle ? widget.height * 0.45 : widget.height}
        text={getWidgetProp(widget, "label", getShapeDefinition(widget.type)?.label ?? "Message")}
        fontFamily="Arial"
        fontSize={Math.max(11, Math.min(15, widget.height * 0.2))}
        fontStyle="bold"
        fill="#f3f4f6"
        verticalAlign={hasSubtitle ? "middle" : "middle"}
        ellipsis
        perfectDrawEnabled={false}
      />
      {hasSubtitle && widget.height > 48 && (
        <KonvaText
          x={iconSize + 22}
          y={widget.height * 0.52}
          width={Math.max(1, widget.width - iconSize - 34)}
          height={widget.height * 0.3}
          text={getWidgetProp(widget, "subtitle")}
          fontFamily="Arial"
          fontSize={Math.max(9, Math.min(12, widget.height * 0.15))}
          fill="#aab4c4"
          ellipsis
          perfectDrawEnabled={false}
        />
      )}
      {widget.props.dismissible === true && widget.width > 120 && (
        <CanvasIcon
          name="X"
          color="#aab4c4"
          strokeWidth={1.8}
          x={widget.width - 24}
          y={10}
          width={14}
          height={14}
        />
      )}
    </Group>
  );
}

function CardShape({ widget, fill, stroke, strokeWidth }: ShapeComponentProps) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const imageSource = typeof widget.props.imageSrc === "string" ? widget.props.imageSrc : "";
  const imageHeight = Math.max(48, widget.height * 0.43);
  const title = getWidgetProp(widget, "title", "Product card");
  const subtitle = getWidgetProp(widget, "subtitle", "A short description goes here.");
  const actionLabel = getWidgetProp(widget, "actionLabel", "Learn more");
  useEffect(() => {
    if (!imageSource) {
      setImage(null);
      return;
    }
    let active = true;
    const element = new window.Image();
    element.crossOrigin = "anonymous";
    element.onload = () => {
      if (active) setImage(element);
    };
    element.onerror = () => {
      if (active) {
        console.error("Could not load the card image source.");
        setImage(null);
      }
    };
    element.src = imageSource;
    return () => {
      active = false;
    };
  }, [imageSource]);
  return (
    <Group>
      <Rect
        width={widget.width}
        height={widget.height}
        fill={fill ?? "#20232c"}
        stroke={stroke ?? "#454853"}
        strokeWidth={strokeWidth}
        cornerRadius={widget.style.cornerRadius ?? 10}
        perfectDrawEnabled={false}
      />
      {image
        ? <KonvaImage
            image={image}
            x={1}
            y={1}
            width={Math.max(1, widget.width - 2)}
            height={imageHeight}
            crop={(() => {
              const scale = Math.max((widget.width - 2) / image.width, imageHeight / image.height);
              const cropWidth = (widget.width - 2) / scale;
              const cropHeight = imageHeight / scale;
              return {
                x: (image.width - cropWidth) / 2,
                y: (image.height - cropHeight) / 2,
                width: cropWidth,
                height: cropHeight,
              };
            })()}
            perfectDrawEnabled={false}
          />
        : <>
            <Rect
              x={1}
              y={1}
              width={Math.max(1, widget.width - 2)}
              height={imageHeight}
              fill="#303344"
              cornerRadius={[9, 9, 0, 0]}
              perfectDrawEnabled={false}
            />
            <CanvasIcon
              name="Image"
              color="#85849b"
              strokeWidth={1.5}
              x={(widget.width - 28) / 2}
              y={(imageHeight - 28) / 2}
              width={28}
              height={28}
            />
          </>}
      <KonvaText
        x={12}
        y={imageHeight + 10}
        width={widget.width - 24}
        height={20}
        text={title}
        fontFamily="Arial"
        fontSize={14}
        fontStyle="bold"
        fill="#f3f4f6"
        ellipsis
        perfectDrawEnabled={false}
      />
      <KonvaText
        x={12}
        y={imageHeight + 32}
        width={widget.width - 24}
        height={20}
        text={subtitle}
        fontFamily="Arial"
        fontSize={11}
        fill="#a9a9b4"
        ellipsis
        perfectDrawEnabled={false}
      />
      <Rect
        x={12}
        y={widget.height - 32}
        width={Math.min(100, widget.width - 24)}
        height={22}
        fill={stroke ?? "#8b69ed"}
        cornerRadius={5}
        perfectDrawEnabled={false}
      />
      <KonvaText
        x={16}
        y={widget.height - 31}
        width={Math.min(92, widget.width - 32)}
        height={20}
        text={actionLabel}
        fontFamily="Arial"
        fontSize={10}
        fontStyle="bold"
        fill="#fff"
        align="center"
        verticalAlign="middle"
        ellipsis
        perfectDrawEnabled={false}
      />
    </Group>
  );
}

function VideoShape({ widget, fill, stroke, strokeWidth }: ShapeComponentProps) {
  const title = getWidgetProp(widget, "label", "Product overview");
  const playSize = Math.max(30, Math.min(48, widget.height * 0.34));
  return (
    <Group>
      <Rect
        width={widget.width}
        height={widget.height}
        fill={fill ?? "#171923"}
        stroke={stroke ?? "#4a4d5a"}
        strokeWidth={strokeWidth}
        cornerRadius={widget.style.cornerRadius ?? 8}
        perfectDrawEnabled={false}
      />
      <CanvasIcon
        name="Image"
        color="#6d7285"
        strokeWidth={1.5}
        x={widget.width * 0.43}
        y={widget.height * 0.23}
        width={widget.width * 0.14}
        height={widget.height * 0.28}
      />
      <Circle
        x={widget.width / 2}
        y={widget.height * 0.49}
        radius={playSize / 2}
        fill="#171923cc"
        stroke="#ffffffcc"
        strokeWidth={1}
        perfectDrawEnabled={false}
      />
      <CanvasIcon
        name="Play"
        color="#fff"
        strokeWidth={2}
        x={widget.width / 2 - playSize * 0.22}
        y={widget.height * 0.49 - playSize * 0.22}
        width={playSize * 0.44}
        height={playSize * 0.44}
      />
      <Rect
        y={widget.height - 28}
        width={widget.width}
        height={28}
        fill="#11131bcc"
        perfectDrawEnabled={false}
      />
      <KonvaText
        x={10}
        y={widget.height - 25}
        width={widget.width - 20}
        height={22}
        text={title}
        fontFamily="Arial"
        fontSize={11}
        fill="#f3f4f6"
        verticalAlign="middle"
        ellipsis
        perfectDrawEnabled={false}
      />
    </Group>
  );
}

function LayoutShape({ widget, fill, stroke, strokeWidth }: ShapeComponentProps) {
  const label = getWidgetProp(widget, "label", widget.type === "flex-row" ? "Flex Row" : "Flex Column");
  const isRow = widget.type === "flex-row";
  const items = isRow ? 3 : 3;
  const gap = Math.max(5, Math.min(12, Number(widget.props.gap) || 12));
  const inset = 10;
  const available = isRow ? widget.width - inset * 2 : widget.height - 36 - inset * 2;
  const size = Math.max(10, (available - gap * (items - 1)) / items);
  return (
    <Group>
      <Rect
        width={widget.width}
        height={widget.height}
        fill={fill ?? "#20232c"}
        stroke={stroke ?? "#51536a"}
        strokeWidth={strokeWidth}
        dash={[5, 3]}
        cornerRadius={widget.style.cornerRadius ?? 8}
        perfectDrawEnabled={false}
      />
      <KonvaText
        x={10}
        y={8}
        width={widget.width - 20}
        height={18}
        text={label}
        fontFamily="Arial"
        fontSize={11}
        fontStyle="bold"
        fill="#bfb8d5"
        ellipsis
        perfectDrawEnabled={false}
      />
      {Array.from({ length: items }, (_, index) => (
        <Rect
          key={index}
          x={isRow ? inset + index * (size + gap) : inset}
          y={isRow ? 36 : 34 + index * (size + gap)}
          width={isRow ? size : widget.width - inset * 2}
          height={isRow ? Math.max(20, widget.height - 48) : Math.max(10, size)}
          fill={index === 0 ? "#514477" : "#343642"}
          stroke="#7767a4"
          strokeWidth={1}
          cornerRadius={4}
          perfectDrawEnabled={false}
        />
      ))}
    </Group>
  );
}

function SpacerShape({ widget, stroke }: ShapeComponentProps) {
  return (
    <Group>
      <Rect
        width={widget.width}
        height={widget.height}
        fill="#000000"
        opacity={0.01}
        stroke={stroke ?? "#777780"}
        strokeWidth={1}
        dash={[4, 3]}
        perfectDrawEnabled={false}
      />
      <KonvaText
        width={widget.width}
        height={widget.height}
        text="SPACER"
        fontFamily="Arial"
        fontSize={Math.min(10, Math.max(7, widget.height * 0.35))}
        fill="#aaa7b1"
        align="center"
        verticalAlign="middle"
        perfectDrawEnabled={false}
      />
    </Group>
  );
}

function ProgressBarShape({ widget, fill, stroke, strokeWidth }: ShapeComponentProps) {
  const progress = typeof widget.props.value === "number"
    ? Math.min(100, Math.max(0, widget.props.value))
    : 68;
  const barHeight = Math.min(12, Math.max(6, widget.height * 0.25));
  const barY = (widget.height - barHeight) / 2;
  return (
    <Group>
      <Rect
        y={barY}
        width={widget.width}
        height={barHeight}
        fill="#30333d"
        cornerRadius={barHeight / 2}
        perfectDrawEnabled={false}
      />
      <Rect
        y={barY}
        width={widget.width * progress / 100}
        height={barHeight}
        fill={fill ?? "#8b69ed"}
        stroke={stroke}
        strokeWidth={strokeWidth}
        cornerRadius={barHeight / 2}
        perfectDrawEnabled={false}
      />
      {widget.height > 40 && (
        <KonvaText
          y={0}
          width={widget.width}
          height={Math.max(14, barY - 3)}
          text={`${getWidgetProp(widget, "label", "Progress")}  ${progress}%`}
          fontFamily="Arial"
          fontSize={12}
          fill="#cbd5e1"
          verticalAlign="middle"
          perfectDrawEnabled={false}
        />
      )}
    </Group>
  );
}

function SpinnerShape({ widget, stroke, strokeWidth }: ShapeComponentProps) {
  const radius = Math.min(widget.width, widget.height) / 2 - strokeWidth;
  const x = widget.width / 2;
  const y = widget.height / 2;
  return (
    <Group>
      <Arc
        x={x}
        y={y}
        innerRadius={Math.max(0, radius - strokeWidth)}
        outerRadius={radius}
        angle={360}
        fill="#393b45"
        perfectDrawEnabled={false}
      />
      <Arc
        x={x}
        y={y}
        innerRadius={Math.max(0, radius - strokeWidth)}
        outerRadius={radius}
        angle={260}
        rotation={-70}
        fill={stroke ?? "#a78bfa"}
        perfectDrawEnabled={false}
      />
    </Group>
  );
}

function SkeletonShape({ widget, fill }: ShapeComponentProps) {
  const gap = Math.max(4, widget.height * 0.06);
  const avatarSize = Math.min(widget.height * 0.72, widget.width * 0.24);
  const lineX = avatarSize + gap * 2;
  const lineWidth = Math.max(1, widget.width - lineX);
  const lineHeight = Math.max(5, Math.min(10, widget.height * 0.14));
  return (
    <Group>
      <Rect
        x={4}
        y={(widget.height - avatarSize) / 2}
        width={avatarSize}
        height={avatarSize}
        fill={fill ?? "#3a3d48"}
        cornerRadius={avatarSize / 2}
        perfectDrawEnabled={false}
      />
      {[0, 1, 2].map((line) => (
        <Rect
          key={line}
          x={lineX}
          y={widget.height * 0.2 + line * (lineHeight + gap)}
          width={line === 2 ? lineWidth * 0.62 : lineWidth}
          height={lineHeight}
          fill={fill ?? "#3a3d48"}
          cornerRadius={lineHeight / 2}
          perfectDrawEnabled={false}
        />
      ))}
    </Group>
  );
}

function RatingShape({ widget, fill }: ShapeComponentProps) {
  const rating = typeof widget.props.value === "number"
    ? Math.min(5, Math.max(0, widget.props.value))
    : 4;
  const gap = 3;
  const starSize = Math.min(widget.height * 0.78, (widget.width - gap * 4) / 5);
  return (
    <Group>
      {Array.from({ length: 5 }, (_, index) => {
        const x = index * (starSize + gap) + starSize / 2;
        const y = widget.height / 2;
        const selected = index < Math.round(rating);
        return (
          <KonvaStar
            key={index}
            x={x}
            y={y}
            numPoints={5}
            innerRadius={starSize * 0.42}
            outerRadius={starSize / 2}
            fill={selected ? fill ?? "#fbbf24" : "#454751"}
            perfectDrawEnabled={false}
          />
        );
      })}
    </Group>
  );
}

function MetricCardShape({ widget, fill, stroke, strokeWidth }: ShapeComponentProps) {
  const iconSize = 18;
  return (
    <Group>
      <Rect
        width={widget.width}
        height={widget.height}
        fill={fill ?? "#20232c"}
        stroke={stroke ?? "#3a3e49"}
        strokeWidth={strokeWidth}
        cornerRadius={widget.style.cornerRadius ?? 9}
        perfectDrawEnabled={false}
      />
      <KonvaText
        x={12}
        y={10}
        width={widget.width - 38}
        height={20}
        text={getWidgetProp(widget, "label", "Revenue")}
        fontFamily="Arial"
        fontSize={12}
        fill="#aeb6c4"
        ellipsis
        perfectDrawEnabled={false}
      />
      <CanvasIcon
        name="TrendingUp"
        color={stroke ?? "#8b69ed"}
        strokeWidth={2}
        x={widget.width - iconSize - 12}
        y={10}
        width={iconSize}
        height={iconSize}
      />
      <KonvaText
        x={12}
        y={32}
        width={widget.width - 24}
        height={34}
        text={getWidgetProp(widget, "value", "$24,800")}
        fontFamily="Arial"
        fontSize={Math.max(18, Math.min(25, widget.height * 0.25))}
        fontStyle="bold"
        fill="#f3f4f6"
        ellipsis
        perfectDrawEnabled={false}
      />
      <KonvaText
        x={12}
        y={widget.height - 25}
        width={widget.width - 24}
        height={16}
        text={`${getWidgetProp(widget, "trend", "+12.8%")} this month`}
        fontFamily="Arial"
        fontSize={10}
        fill="#4ade80"
        ellipsis
        perfectDrawEnabled={false}
      />
    </Group>
  );
}

function ProfileCardShape({ widget, fill, stroke, strokeWidth }: ShapeComponentProps) {
  const avatarSize = Math.min(44, widget.height * 0.34);
  const avatar: Widget = {
    ...widget,
    width: avatarSize,
    height: avatarSize,
    props: {
      ...widget.props,
      initials: getWidgetProp(widget, "initials", "AM"),
    },
  };
  return (
    <Group>
      <Rect
        width={widget.width}
        height={widget.height}
        fill={fill ?? "#20232c"}
        stroke={stroke ?? "#3a3e49"}
        strokeWidth={strokeWidth}
        cornerRadius={widget.style.cornerRadius ?? 9}
        perfectDrawEnabled={false}
      />
      <Group x={14} y={14}>
        <AvatarShape widget={avatar} fill="#6366f1" stroke={undefined} strokeWidth={0} />
      </Group>
      <KonvaText
        x={avatarSize + 24}
        y={widget.height * 0.18}
        width={Math.max(1, widget.width - avatarSize - 38)}
        height={20}
        text={getWidgetProp(widget, "label", "Alex Morgan")}
        fontFamily="Arial"
        fontSize={14}
        fontStyle="bold"
        fill="#f3f4f6"
        ellipsis
        perfectDrawEnabled={false}
      />
      <KonvaText
        x={avatarSize + 24}
        y={widget.height * 0.18 + 21}
        width={Math.max(1, widget.width - avatarSize - 38)}
        height={18}
        text={getWidgetProp(widget, "subtitle", "Product designer")}
        fontFamily="Arial"
        fontSize={11}
        fill="#aab4c4"
        ellipsis
        perfectDrawEnabled={false}
      />
      <Line
        points={[12, widget.height * 0.62, widget.width - 12, widget.height * 0.62]}
        stroke="#3a3e49"
        strokeWidth={1}
        perfectDrawEnabled={false}
      />
      <KonvaText
        x={14}
        y={widget.height * 0.68}
        width={widget.width - 28}
        height={24}
        text="View profile   ·   Message"
        fontFamily="Arial"
        fontSize={11}
        fill="#a78bfa"
        verticalAlign="middle"
        perfectDrawEnabled={false}
      />
    </Group>
  );
}

function FormPreviewShape({ widget, fill, stroke, strokeWidth }: ShapeComponentProps) {
  const title = getWidgetProp(widget, "label", getShapeDefinition(widget.type)?.label ?? "Control");
  const placeholder = getWidgetProp(widget, "placeholder", title);
  const radius = widget.style.cornerRadius ?? 6;

  if (widget.type === "slider") {
    const value = typeof widget.props.value === "number"
      ? Math.min(100, Math.max(0, widget.props.value))
      : 65;
    const trackY = widget.height * 0.62;
    return (
      <Group>
        <KonvaText
          x={2}
          y={0}
          width={widget.width - 4}
          height={Math.max(14, widget.height * 0.38)}
          text={title}
          fontFamily="Arial"
          fontSize={11}
          fill="#d7d6dd"
          perfectDrawEnabled={false}
        />
        <Line
          points={[2, trackY, widget.width - 2, trackY]}
          stroke="#454853"
          strokeWidth={6}
          lineCap="round"
          perfectDrawEnabled={false}
        />
        <Line
          points={[2, trackY, 2 + (widget.width - 4) * value / 100, trackY]}
          stroke={stroke ?? "#8b69ed"}
          strokeWidth={6}
          lineCap="round"
          perfectDrawEnabled={false}
        />
        <Circle
          x={2 + (widget.width - 4) * value / 100}
          y={trackY}
          radius={7}
          fill="#ffffff"
          stroke={stroke ?? "#8b69ed"}
          strokeWidth={2}
          perfectDrawEnabled={false}
        />
      </Group>
    );
  }

  if (widget.type === "file-upload") {
    const iconSize = Math.min(24, widget.height * 0.3);
    return (
      <Group>
        <Rect
          width={widget.width}
          height={widget.height}
          fill={fill ?? "#20232c"}
          stroke={stroke ?? "#56515f"}
          strokeWidth={strokeWidth}
          dash={[6, 4]}
          cornerRadius={radius}
          perfectDrawEnabled={false}
        />
        <CanvasIcon
          name="Upload"
          color={stroke ?? "#a78bfa"}
          strokeWidth={2}
          x={(widget.width - iconSize) / 2}
          y={widget.height * 0.16}
          width={iconSize}
          height={iconSize}
        />
        <KonvaText
          x={8}
          y={widget.height * 0.52}
          width={widget.width - 16}
          height={Math.max(18, widget.height * 0.24)}
          text={title}
          fontFamily="Arial"
          fontSize={11}
          fill="#e5e7eb"
          align="center"
          ellipsis
          perfectDrawEnabled={false}
        />
        {widget.height > 58 && (
          <KonvaText
            x={8}
            y={widget.height * 0.76}
            width={widget.width - 16}
            height={16}
            text={placeholder}
            fontFamily="Arial"
            fontSize={9}
            fill="#aab4c4"
            align="center"
            ellipsis
            perfectDrawEnabled={false}
          />
        )}
      </Group>
    );
  }

  if (widget.type === "stepper") {
    const value = typeof widget.props.value === "number" ? widget.props.value : 2;
    const buttonWidth = Math.min(32, widget.width * 0.24);
    return (
      <Group>
        <KonvaText
          x={0}
          y={0}
          width={widget.width}
          height={18}
          text={title}
          fontFamily="Arial"
          fontSize={11}
          fill="#d7d6dd"
          perfectDrawEnabled={false}
        />
        <Rect
          y={20}
          width={widget.width}
          height={widget.height - 20}
          fill={fill ?? "#20232c"}
          stroke={stroke ?? "#454853"}
          strokeWidth={strokeWidth}
          cornerRadius={radius}
          perfectDrawEnabled={false}
        />
        <Line
          points={[buttonWidth, 20, buttonWidth, widget.height]}
          stroke="#454853"
          strokeWidth={1}
          perfectDrawEnabled={false}
        />
        <Line
          points={[widget.width - buttonWidth, 20, widget.width - buttonWidth, widget.height]}
          stroke="#454853"
          strokeWidth={1}
          perfectDrawEnabled={false}
        />
        <KonvaText
          y={20}
          width={buttonWidth}
          height={widget.height - 20}
          text="−"
          fontFamily="Arial"
          fontSize={16}
          fill="#d7d6dd"
          align="center"
          verticalAlign="middle"
          perfectDrawEnabled={false}
        />
        <KonvaText
          x={buttonWidth}
          y={20}
          width={Math.max(1, widget.width - buttonWidth * 2)}
          height={widget.height - 20}
          text={String(value)}
          fontFamily="Arial"
          fontSize={12}
          fill="#f3f4f6"
          align="center"
          verticalAlign="middle"
          perfectDrawEnabled={false}
        />
        <KonvaText
          x={widget.width - buttonWidth}
          y={20}
          width={buttonWidth}
          height={widget.height - 20}
          text="+"
          fontFamily="Arial"
          fontSize={16}
          fill="#d7d6dd"
          align="center"
          verticalAlign="middle"
          perfectDrawEnabled={false}
        />
      </Group>
    );
  }

  const iconName = widget.type === "search" || widget.type === "search-bar"
    ? "Search"
    : widget.type === "date-picker"
      ? "CalendarDays"
      : widget.type === "select" || widget.type === "dropdown"
        ? "ChevronDown"
        : "";
  const isTextarea = widget.type === "textarea" || widget.type === "text-area";
  const iconSize = Math.min(16, widget.height * 0.42);
  return (
    <Group>
      {isTextarea ? (
        <Group>
          <Rect
            width={widget.width}
            height={widget.height}
            fill={fill ?? "#20232c"}
            stroke={stroke ?? "#454853"}
            strokeWidth={strokeWidth}
            cornerRadius={radius}
            perfectDrawEnabled={false}
          />
          <KonvaText
            x={10}
            y={8}
            width={widget.width - 20}
            height={widget.height - 16}
            text={placeholder}
            fontFamily="Arial"
            fontSize={11}
            fill="#aab4c4"
            verticalAlign="top"
            wrap="word"
            perfectDrawEnabled={false}
          />
        </Group>
      ) : (
        <Group>
          <Rect
            width={widget.width}
            height={widget.height}
            fill={fill ?? "#20232c"}
            stroke={stroke ?? "#454853"}
            strokeWidth={strokeWidth}
            cornerRadius={radius}
            perfectDrawEnabled={false}
          />
          {iconName && (
            <CanvasIcon
              name={iconName}
              color="#aab4c4"
              strokeWidth={1.8}
              x={10}
              y={(widget.height - iconSize) / 2}
              width={iconSize}
              height={iconSize}
            />
          )}
          <KonvaText
            x={iconName ? iconSize + 18 : 10}
            width={Math.max(1, widget.width - (iconName ? iconSize + 28 : 20))}
            height={widget.height}
            text={placeholder}
            fontFamily="Arial"
            fontSize={11}
            fill="#aab4c4"
            verticalAlign="middle"
            ellipsis
            perfectDrawEnabled={false}
          />
        </Group>
      )}
    </Group>
  );
}

function EmptyStateShape({ widget, fill, stroke, strokeWidth }: ShapeComponentProps) {
  const iconSize = Math.min(28, widget.height * 0.28);
  const hasSubtitle = widget.height > 70;
  return (
    <Group>
      <Rect
        width={widget.width}
        height={widget.height}
        fill={fill ?? "#20232c"}
        stroke={stroke ?? "#3a3e49"}
        strokeWidth={strokeWidth}
        dash={[5, 4]}
        cornerRadius={widget.style.cornerRadius ?? 9}
        perfectDrawEnabled={false}
      />
      <CanvasIcon
        name="Inbox"
        color={stroke ?? "#8b69ed"}
        strokeWidth={2}
        x={(widget.width - iconSize) / 2}
        y={widget.height * 0.12}
        width={iconSize}
        height={iconSize}
      />
      <KonvaText
        y={widget.height * 0.49}
        width={widget.width - 16}
        height={20}
        x={8}
        text={getWidgetProp(widget, "label", "Nothing here yet")}
        fontFamily="Arial"
        fontSize={12}
        fontStyle="bold"
        fill="#e5e7eb"
        align="center"
        ellipsis
        perfectDrawEnabled={false}
      />
      {hasSubtitle && (
        <KonvaText
          y={widget.height * 0.72}
          width={widget.width - 16}
          height={18}
          x={8}
          text={getWidgetProp(widget, "subtitle", "New items will appear here.")}
          fontFamily="Arial"
          fontSize={10}
          fill="#aab4c4"
          align="center"
          ellipsis
          perfectDrawEnabled={false}
        />
      )}
    </Group>
  );
}

function CodeBlockShape({ widget, fill, stroke, strokeWidth }: ShapeComponentProps) {
  const code = getWidgetProp(widget, "label", "const app = 'Proto Flow';");
  return (
    <Group>
      <Rect
        width={widget.width}
        height={widget.height}
        fill={fill ?? "#171923"}
        stroke={stroke ?? "#3a3e49"}
        strokeWidth={strokeWidth}
        cornerRadius={widget.style.cornerRadius ?? 8}
        perfectDrawEnabled={false}
      />
      <Circle x={13} y={13} radius={3} fill="#fb7185" perfectDrawEnabled={false} />
      <Circle x={24} y={13} radius={3} fill="#fbbf24" perfectDrawEnabled={false} />
      <Circle x={35} y={13} radius={3} fill="#4ade80" perfectDrawEnabled={false} />
      <KonvaText
        x={12}
        y={30}
        width={widget.width - 24}
        height={widget.height - 38}
        text={code}
        fontFamily="Consolas, monospace"
        fontSize={12}
        fill="#a5b4fc"
        wrap="word"
        perfectDrawEnabled={false}
      />
    </Group>
  );
}

function SegmentedControlShape({ widget, fill, stroke, strokeWidth }: ShapeComponentProps) {
  const segments = getWidgetProp(widget, "label", "Overview | Activity | Settings")
    .split("|")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .slice(0, 5);
  const selected = typeof widget.props.selected === "number" ? widget.props.selected : 0;
  const segmentWidth = widget.width / Math.max(1, segments.length);
  return (
    <Group>
      <Rect
        width={widget.width}
        height={widget.height}
        fill={fill ?? "#252630"}
        stroke={stroke ?? "#41424c"}
        strokeWidth={strokeWidth}
        cornerRadius={widget.height / 2}
        perfectDrawEnabled={false}
      />
      {segments.map((segment, index) => (
        <Group key={`${segment}-${index}`} x={index * segmentWidth}>
          {index === selected && (
            <Rect
              x={3}
              y={3}
              width={Math.max(1, segmentWidth - 6)}
              height={widget.height - 6}
              fill="#484052"
              cornerRadius={widget.height / 2}
              perfectDrawEnabled={false}
            />
          )}
          <KonvaText
            width={segmentWidth}
            height={widget.height}
            text={segment}
            fontFamily="Arial"
            fontSize={Math.max(9, Math.min(12, widget.height * 0.32))}
            fill={index === selected ? "#f3f4f6" : "#aab4c4"}
            align="center"
            verticalAlign="middle"
            ellipsis
            perfectDrawEnabled={false}
          />
        </Group>
      ))}
    </Group>
  );
}

function StepIndicatorShape({ widget, stroke }: ShapeComponentProps) {
  const steps = getWidgetProp(widget, "label", "Details | Shipping | Review")
    .split("|")
    .map((step) => step.trim())
    .filter(Boolean)
    .slice(0, 5);
  const current = typeof widget.props.step === "number" ? widget.props.step : 1;
  const segmentWidth = widget.width / Math.max(1, steps.length);
  return (
    <Group>
      {steps.map((step, index) => (
        <Group key={`${step}-${index}`} x={index * segmentWidth}>
          <Circle
            x={segmentWidth / 2}
            y={10}
            radius={9}
            fill={index <= current ? stroke ?? "#8b69ed" : "#343640"}
            perfectDrawEnabled={false}
          />
          <KonvaText
            x={segmentWidth / 2 - 6}
            y={4}
            width={12}
            height={12}
            text={index < current ? "✓" : String(index + 1)}
            fontFamily="Arial"
            fontSize={9}
            fontStyle="bold"
            fill="#ffffff"
            align="center"
            verticalAlign="middle"
            perfectDrawEnabled={false}
          />
          <KonvaText
            y={23}
            width={segmentWidth}
            height={18}
            text={step}
            fontFamily="Arial"
            fontSize={9}
            fill={index <= current ? "#d7d6dd" : "#85858f"}
            align="center"
            ellipsis
            perfectDrawEnabled={false}
          />
          {index < steps.length - 1 && (
            <Line
              points={[segmentWidth / 2 + 10, 10, segmentWidth + segmentWidth / 2 - 10, 10]}
              stroke={index < current ? stroke ?? "#8b69ed" : "#343640"}
              strokeWidth={2}
              perfectDrawEnabled={false}
            />
          )}
        </Group>
      ))}
    </Group>
  );
}

function PricingCardShape({ widget, fill, stroke, strokeWidth }: ShapeComponentProps) {
  return (
    <Group>
      <Rect
        width={widget.width}
        height={widget.height}
        fill={fill ?? "#20232c"}
        stroke={stroke ?? "#8b69ed"}
        strokeWidth={strokeWidth}
        cornerRadius={widget.style.cornerRadius ?? 9}
        perfectDrawEnabled={false}
      />
      <KonvaText
        x={14}
        y={12}
        width={widget.width - 28}
        height={22}
        text={getWidgetProp(widget, "label", "Pro")}
        fontFamily="Arial"
        fontSize={15}
        fontStyle="bold"
        fill="#f3f4f6"
        perfectDrawEnabled={false}
      />
      <KonvaText
        x={14}
        y={38}
        width={widget.width - 28}
        height={28}
        text={getWidgetProp(widget, "subtitle", "$19 / month")}
        fontFamily="Arial"
        fontSize={20}
        fontStyle="bold"
        fill="#c4b5fd"
        perfectDrawEnabled={false}
      />
      <KonvaText
        x={14}
        y={72}
        width={widget.width - 28}
        height={Math.max(20, widget.height - 82)}
        text="✓  Unlimited projects\n✓  Shared components"
        fontFamily="Arial"
        fontSize={11}
        lineHeight={1.5}
        fill="#cbd5e1"
        perfectDrawEnabled={false}
      />
    </Group>
  );
}

const GENERIC_ICON_NAMES: Record<string, string> = {
  polygon: "Triangle",
  star: "Star",
  divider: "Minus",
  vector: "Pencil",
  path: "Activity",
  heading: "FileText",
  paragraph: "AlignLeft",
  link: "Link",
  label: "Tag",
  frame: "Frame",
  group: "Layers",
  card: "Square",
  modal: "Square",
  overlay: "Layers",
  drawer: "PanelRightOpen",
  section: "LayoutPanelTop",
  panel: "PanelLeft",
  "dynamic-panel": "PanelLeft",
  repeater: "Repeat",
  accordion: "ChevronsUpDown",
  carousel: "GalleryHorizontal",
  "tabs-container": "PanelTop",
  textarea: "AlignJustify",
  "text-area": "AlignJustify",
  select: "ChevronDown",
  dropdown: "ChevronDown",
  checkbox: "CheckSquare",
  radio: "CircleDot",
  toggle: "ToggleRight",
  switch: "ToggleRight",
  slider: "SlidersHorizontal",
  stepper: "ListOrdered",
  "date-picker": "CalendarDays",
  "file-upload": "Upload",
  search: "Search",
  "search-bar": "Search",
  form: "FileText",
  video: "Video",
  tooltip: "CircleHelp",
  popover: "MessageCircle",
  navbar: "PanelTop",
  sidebar: "PanelLeft",
  tabs: "PanelTop",
  breadcrumb: "ChevronRight",
  pagination: "MoreHorizontal",
  menu: "Menu",
  "dropdown-menu": "ChevronDown",
  footer: "PanelBottom",
  table: "Table",
  list: "List",
  grid: "Grid3X3",
  chart: "BarChart3",
  stat: "TrendingUp",
  kpi: "TrendingUp",
  timeline: "GitCommitHorizontal",
  calendar: "CalendarDays",
  symbol: "Puzzle",
  "symbol-instance": "Puzzle",
  "component-master": "Component",
};

function DataElementShape({ widget, fill, stroke, strokeWidth }: ShapeComponentProps) {
  const title = getWidgetProp(widget, "label", getShapeDefinition(widget.type)?.label ?? "Data");
  const frameFill = fill ?? "#20232c";
  return (
    <Group>
      <Rect
        width={widget.width}
        height={widget.height}
        fill={frameFill}
        stroke={stroke ?? "#3a3e49"}
        strokeWidth={strokeWidth}
        cornerRadius={widget.style.cornerRadius ?? 8}
        perfectDrawEnabled={false}
      />
      <KonvaText
        x={10}
        y={7}
        width={widget.width - 20}
        height={18}
        text={title}
        fontFamily="Arial"
        fontSize={11}
        fontStyle="bold"
        fill="#d7d6dd"
        ellipsis
        perfectDrawEnabled={false}
      />
      {widget.type === "chart" ? (
        <Group>
          {(() => {
            const rawValues = widget.props.values;
            const values = Array.isArray(rawValues) && rawValues.length > 1
              ? rawValues.slice(0, 8).map((value) => typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0)
              : [38, 68, 50, 88, 62];
            const maxValue = Math.max(1, ...values);
            const plotTop = 34;
            const plotHeight = Math.max(1, widget.height - 52);
            const plotWidth = Math.max(1, widget.width - 30);
            const chartType = widget.props.chartType;
            if (chartType === "pie") {
              const total = values.reduce((sum, value) => sum + value, 0) || 1;
              let angle = 0;
              const radius = Math.max(8, Math.min(plotWidth, plotHeight) * 0.42);
              return values.map((value, index) => {
                const nextAngle = angle + value / total * 360;
                const segment = (
                  <Arc
                    key={index}
                    x={widget.width / 2}
                    y={plotTop + plotHeight / 2}
                    innerRadius={radius * 0.55}
                    outerRadius={radius}
                    angle={nextAngle - angle}
                    rotation={angle - 90}
                    fill={index === 0 ? stroke ?? "#8b69ed" : ["#55b6a8", "#e39b54", "#6579d8", "#ce6b83", "#8c70bf"][index % 5]}
                    listening={false}
                    perfectDrawEnabled={false}
                  />
                );
                angle = nextAngle;
                return segment;
              });
            }
            if (chartType === "line") {
              const points = values.flatMap((value, index) => [
                15 + (plotWidth * index) / Math.max(1, values.length - 1),
                plotTop + plotHeight * (1 - value / maxValue),
              ]);
              return (
                <>
                  <Line
                    points={[12, plotTop + plotHeight, widget.width - 12, plotTop + plotHeight]}
                    stroke="#454853"
                    strokeWidth={1}
                    perfectDrawEnabled={false}
                  />
                  <Line
                    points={points}
                    stroke={stroke ?? "#8b69ed"}
                    strokeWidth={2.5}
                    lineCap="round"
                    lineJoin="round"
                    perfectDrawEnabled={false}
                  />
                  {values.map((_, index) => (
                    <Circle
                      key={index}
                      x={points[index * 2]}
                      y={points[index * 2 + 1]}
                      radius={3}
                      fill={stroke ?? "#8b69ed"}
                      perfectDrawEnabled={false}
                    />
                  ))}
                </>
              );
            }
            const gap = 5;
            const barWidth = Math.max(5, (plotWidth - gap * (values.length - 1)) / values.length);
            return values.map((value, index) => {
              const barHeight = plotHeight * value / maxValue;
              return (
                <Rect
                  key={index}
                  x={15 + index * (barWidth + gap)}
                  y={plotTop + plotHeight - barHeight}
                  width={barWidth}
                  height={barHeight}
                  fill={index === 0 ? stroke ?? "#8b69ed" : ["#56516f", "#55b6a8", "#6579d8", "#e39b54"][index % 4]}
                  cornerRadius={[3, 3, 0, 0]}
                  perfectDrawEnabled={false}
                />
              );
            });
          })()}
        </Group>
      ) : widget.type === "table" ? (
        <Group>
          {[0, 1, 2].map((row) => (
            <Group key={row}>
              <Rect
                x={10}
                y={30 + row * Math.max(15, (widget.height - 38) / 3)}
                width={widget.width - 20}
                height={Math.max(1, (widget.height - 38) / 3 - 1)}
                fill={row === 0 ? "#343744" : "rgba(255,255,255,0.025)"}
                perfectDrawEnabled={false}
              />
              {[0, 1, 2].map((column) => (
                <Line
                  key={column}
                  points={[
                    10 + (widget.width - 20) * column / 3,
                    30 + row * Math.max(15, (widget.height - 38) / 3),
                    10 + (widget.width - 20) * column / 3,
                    30 + (row + 1) * Math.max(15, (widget.height - 38) / 3),
                  ]}
                  stroke="#454853"
                  strokeWidth={1}
                  perfectDrawEnabled={false}
                />
              ))}
            </Group>
          ))}
        </Group>
      ) : widget.type === "calendar" ? (
        <Group>
          {Array.from({ length: 14 }, (_, index) => (
            <Rect
              key={index}
              x={12 + (index % 7) * Math.max(13, (widget.width - 28) / 7)}
              y={31 + Math.floor(index / 7) * Math.max(14, (widget.height - 40) / 3)}
              width={Math.max(7, Math.min(12, (widget.width - 34) / 8))}
              height={Math.max(7, Math.min(12, (widget.height - 42) / 4))}
              fill={index === 10 ? stroke ?? "#8b69ed" : "#454853"}
              cornerRadius={2}
              perfectDrawEnabled={false}
            />
          ))}
        </Group>
      ) : (
        <Group>
          <KonvaText
            x={10}
            y={31}
            width={widget.width - 20}
            height={Math.max(18, widget.height * 0.32)}
            text={getWidgetProp(widget, "value", "$24,800")}
            fontFamily="Arial"
            fontSize={Math.min(24, widget.height * 0.3)}
            fontStyle="bold"
            fill="#f3f4f6"
            perfectDrawEnabled={false}
          />
          <Line
            points={[
              12,
              widget.height - 12,
              widget.width * 0.35,
              widget.height * 0.58,
              widget.width * 0.58,
              widget.height * 0.74,
              widget.width - 12,
              widget.height * 0.48,
            ]}
            stroke={stroke ?? "#8b69ed"}
            strokeWidth={2}
            lineCap="round"
            lineJoin="round"
            perfectDrawEnabled={false}
          />
        </Group>
      )}
    </Group>
  );
}

function GenericElementShape({
  widget,
  fill,
  stroke,
  strokeWidth,
}: ShapeComponentProps) {
  const fallbackLabel = getShapeDefinition(widget.type)?.label ?? widget.type;
  const label =
    typeof widget.props.label === "string"
      ? widget.props.label
      : fallbackLabel;
  if (["textarea", "text-area", "select", "dropdown", "date-picker", "search", "search-bar", "file-upload", "slider", "stepper"].includes(widget.type)) {
    return <FormPreviewShape widget={widget} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />;
  }
  if (widget.type === "avatar") {
    return <AvatarShape widget={widget} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />;
  }
  if (widget.type === "icon" || widget.type === "custom-icon" || widget.type === "mobile-app" || widget.type === "web-app") {
    return <IconShape widget={widget} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />;
  }
  if (widget.type === "icon-button") {
    return <IconButtonShape widget={widget} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />;
  }
  if (widget.type === "badge" || widget.type === "chip" || widget.type === "tag") {
    return <PillShape widget={widget} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />;
  }
  if (["alert", "banner", "toast", "notification", "tooltip", "popover"].includes(widget.type)) {
    return <NoticeShape widget={widget} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />;
  }
  if (widget.type === "progress" || widget.type === "progress-bar") {
    return <ProgressBarShape widget={widget} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />;
  }
  if (widget.type === "spinner") return <SpinnerShape widget={widget} fill={undefined} stroke={stroke} strokeWidth={strokeWidth} />;
  if (widget.type === "skeleton") return <SkeletonShape widget={widget} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />;
  if (widget.type === "rating") return <RatingShape widget={widget} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />;
  if (widget.type === "metric-card" || widget.type === "stat" || widget.type === "kpi") {
    return <MetricCardShape widget={widget} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />;
  }
  if (widget.type === "profile-card") {
    return <ProfileCardShape widget={widget} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />;
  }
  if (widget.type === "card") {
    return <CardShape widget={widget} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />;
  }
  if (widget.type === "video") {
    return <VideoShape widget={widget} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />;
  }
  if (widget.type === "flex-row" || widget.type === "flex-column") {
    return <LayoutShape widget={widget} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />;
  }
  if (widget.type === "spacer") {
    return <SpacerShape widget={widget} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />;
  }
  if (widget.type === "empty-state") {
    return <EmptyStateShape widget={widget} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />;
  }
  if (widget.type === "code-block") {
    return <CodeBlockShape widget={widget} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />;
  }
  if (widget.type === "segmented-control") {
    return <SegmentedControlShape widget={widget} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />;
  }
  if (widget.type === "step-indicator") {
    return <StepIndicatorShape widget={widget} fill={undefined} stroke={stroke} strokeWidth={strokeWidth} />;
  }
  if (widget.type === "bottom-nav") {
    return <SegmentedControlShape widget={widget} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />;
  }
  if (widget.type === "pricing-card") {
    return <PricingCardShape widget={widget} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />;
  }
  if (widget.type === "chart" || widget.type === "table" || widget.type === "grid" || widget.type === "calendar") {
    return <DataElementShape widget={widget} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />;
  }
  return (
    <Group>
      <Rect
        width={widget.width}
        height={widget.height}
        fill={fill ?? "#20232c"}
        stroke={stroke}
        strokeWidth={strokeWidth}
        cornerRadius={widget.style.cornerRadius ?? 5}
        perfectDrawEnabled={false}
      />
      {["container", "frame", "group", "card", "modal", "overlay", "drawer", "section", "panel", "dynamic-panel", "repeater", "accordion", "carousel", "tabs-container", "navbar", "sidebar", "tabs", "menu", "dropdown-menu", "footer", "form"].includes(widget.type) ? (
        <Group>
          <Rect
            x={8}
            y={8}
            width={Math.max(1, widget.width - 16)}
            height={Math.min(24, widget.height - 12)}
            fill="#2b2e39"
            cornerRadius={4}
            perfectDrawEnabled={false}
          />
          <KonvaText
            x={12}
            y={8}
            width={Math.max(1, widget.width - 24)}
            height={24}
            text={label}
            fontSize={12}
            fontFamily="Arial"
            fontStyle="bold"
            fill="#d7d7de"
            verticalAlign="middle"
            ellipsis
            perfectDrawEnabled={false}
          />
          {[0, 1].map((line) => (
            <Rect
              key={line}
              x={12}
              y={42 + line * 14}
              width={Math.max(1, widget.width * (line === 0 ? 0.7 : 0.48))}
              height={4}
              fill="#454853"
              cornerRadius={2}
              perfectDrawEnabled={false}
            />
          ))}
        </Group>
      ) : (
        <Group>
          <CanvasIcon
            name={GENERIC_ICON_NAMES[widget.type] ?? "Sparkles"}
            color={stroke ?? "#a78bfa"}
            strokeWidth={1.8}
            x={10}
            y={Math.max(6, (widget.height - 20) / 2)}
            width={20}
            height={20}
          />
          <KonvaText
            x={38}
            y={4}
            width={Math.max(1, widget.width - 46)}
            height={Math.max(1, widget.height - 8)}
            text={label}
            fontSize={Math.min(14, Math.max(10, widget.height * 0.32))}
            fontFamily="Arial"
            fill="#e5e7eb"
            align="left"
            verticalAlign="middle"
            ellipsis
            wrap="none"
            perfectDrawEnabled={false}
          />
        </Group>
      )}
    </Group>
  );
}

const SHAPE_COMPONENTS: Record<PrimitiveTool, ComponentType<ShapeComponentProps>> = {
  rectangle: RectangleShape,
  ellipse: EllipseShape,
  text: TextShape,
  line: LineShape,
  arrow: ArrowShape,
  icon: IconShape,
};
const WIDGET_COMPONENTS: Record<WidgetTool, ComponentType<ShapeComponentProps>> = {
  button: ButtonShape,
  input: InputShape,
  image: ImageShape,
  checkbox: CheckboxShape,
  radio: RadioShape,
  toggle: ToggleShape,
};

const SHAPE_REGISTRY = Object.fromEntries(
  Object.entries(SHAPE_TOOL_DEFINITIONS).map(([type, definition]) => [
    type,
    {
      ...definition,
      component:
        type === "list"
          ? ListShape
          : type in WIDGET_COMPONENTS
          ? WIDGET_COMPONENTS[type as WidgetTool]
          : type in SHAPE_COMPONENTS
            ? SHAPE_COMPONENTS[type as PrimitiveTool]
            : ["heading", "paragraph", "link", "label"].includes(type)
              ? TextShape
              : GenericElementShape,
    },
  ]),
) as Record<ShapeTool, ShapeDefinition>;

export function getShapeDefinition(type: string): ShapeDefinition | undefined {
  return Object.hasOwn(SHAPE_REGISTRY, type)
    ? SHAPE_REGISTRY[type as ShapeTool]
    : type === "circle"
      ? SHAPE_REGISTRY.ellipse
      : undefined;
}

export function createShapeWidget(
  type: ShapeTool,
  x: number,
  y: number,
  width = SHAPE_REGISTRY[type].width,
  height = SHAPE_REGISTRY[type].height,
  props: Record<string, unknown> = SHAPE_REGISTRY[type].props,
): Widget {
  const definition = SHAPE_REGISTRY[type];
  return {
    id: crypto.randomUUID(),
    type,
    x,
    y,
    width: Math.max(1, width),
    height: Math.max(1, height),
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    zIndex: 0,
    style: { ...definition.style },
    props: structuredClone(props),
  };
}

export function renderWidgetShape(
  widget: Widget,
  selected: boolean,
  onThumbnailReady?: () => void,
): ReactNode {
  void selected;
  const definition = getShapeDefinition(widget.type);
  const ShapeComponent = definition?.component ?? RectangleShape;
  const defaultFill =
    widget.type === "text"
      ? "#e9e9ec"
      : ["rectangle", "ellipse"].includes(widget.type)
        ? "#5c4a89"
        : undefined;
  const fill = widget.style.fill === null ? undefined : widget.style.fill ?? defaultFill;
  const stroke =
    widget.style.stroke === null
      ? undefined
      : (widget.style.stroke ?? DEFAULT_STROKE);
  const strokeWidth = widget.style.strokeWidth ?? 1;

  return (
    <Group
      globalCompositeOperation={getSafeBlendMode(widget.style.blendMode)}
      shadowColor={widget.style.shadow?.color
        ? styleColorToRgba(widget.style.shadow.color)
        : "#000000"}
      shadowBlur={widget.style.shadow?.blur ?? 0}
      shadowOffsetX={widget.style.shadow?.offsetX ?? 0}
      shadowOffsetY={widget.style.shadow?.offsetY ?? 0}
      shadowOpacity={widget.style.shadow?.opacity ?? 0.5}
      shadowEnabled={Boolean(widget.style.shadow)}
      shadowForStrokeEnabled={Boolean(widget.style.shadow)}
    >
      <ShapeComponent
        widget={widget}
        fill={fill ? styleColorToRgba(fill, widget.style.fillOpacity) : undefined}
        stroke={stroke ? styleColorToRgba(stroke, widget.style.strokeOpacity) : undefined}
        strokeWidth={strokeWidth}
        onThumbnailReady={onThumbnailReady}
      />
    </Group>
  );
}
