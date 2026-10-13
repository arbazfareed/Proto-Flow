import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  Arrow,
  Circle,
  Ellipse,
  Group,
  Image as KonvaImage,
  Line,
  Path,
  Rect,
  Text as KonvaText,
} from "react-konva";
import type Konva from "konva";
import type { Widget } from "../project/schema";
import { useStore } from "../store";
import {
  SHAPE_TOOL_DEFINITIONS,
  SHAPE_TOOLS,
  type PrimitiveTool,
  type ShapeTool,
  type ShapeToolDefinition,
  type WidgetTool,
} from "./shapeTools";
import { getSafeBlendMode, styleColorToRgba } from "./styleInspector";
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
export const MAX_WIDGET_TEXT_LENGTH = 10_000;

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

const LUCIDE_PATHS: Record<string, string[]> = {
  Activity: [
    "M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2",
  ],
  Heart: [
    "M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z",
  ],
  Search: ["m21 21-4.3-4.3", "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z"],
  Star: [
    "M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z",
  ],
  Zap: [
    "M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z",
  ],
};

function IconShape({ widget, stroke, strokeWidth }: ShapeComponentProps) {
  const iconName =
    typeof widget.props.iconName === "string" && LUCIDE_PATHS[widget.props.iconName]
      ? widget.props.iconName
      : "Star";
  const color = stroke ?? DEFAULT_STROKE;

  return (
    <Group
      x={0}
      y={0}
      scaleX={widget.width / 24}
      scaleY={widget.height / 24}
    >
      {LUCIDE_PATHS[iconName].map((data, index) => (
        <Path
          key={`${iconName}-${index}`}
          data={data}
          fill="transparent"
          stroke={color}
          strokeWidth={strokeWidth}
          lineCap="round"
          lineJoin="round"
          perfectDrawEnabled={false}
        />
      ))}
    </Group>
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

function ImageShape({ widget, fill, stroke, strokeWidth, onThumbnailReady }: ShapeComponentProps) {
  const filePath = useStore((state) => state.filePath);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const imageNodeRef = useRef<Konva.Image>(null);
  const source = getWidgetProp(widget, "src");
  const assetPath = getWidgetProp(widget, "assetPath");
  const mime = getWidgetProp(widget, "mime");

  useEffect(() => {
    let active = true;
    setImage(null);
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
          onThumbnailReady?.();
        }
      };
      element.src = sourceData.startsWith("data:")
        ? sourceData
        : `data:${mime};base64,${sourceData}`;
    };
    void load().catch((error: unknown) => {
      console.error("Could not load the project image asset.", error);
      onThumbnailReady?.();
    });
    return () => {
      active = false;
    };
  }, [assetPath, filePath, mime, onThumbnailReady, source]);

  useEffect(() => {
    const node = imageNodeRef.current;
    if (!image || !node) return;
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
        stroke={stroke}
        strokeWidth={strokeWidth}
        perfectDrawEnabled={false}
      />
    );
  }
  return (
    <Group>
      <Rect
        width={widget.width}
        height={widget.height}
        fill={fill}
        stroke={stroke ?? "#56515f"}
        strokeWidth={strokeWidth}
        dash={[6, 4]}
        cornerRadius={4}
        perfectDrawEnabled={false}
      />
      <KonvaText
        width={widget.width}
        height={widget.height}
        text="Drop image or double-click to choose"
        fontSize={Math.max(9, Math.min(13, widget.width / 15))}
        fontFamily="Arial"
        align="center"
        verticalAlign="middle"
        fill="#a2a2aa"
        padding={8}
        wrap="word"
        perfectDrawEnabled={false}
      />
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
        type in WIDGET_COMPONENTS
          ? WIDGET_COMPONENTS[type as WidgetTool]
          : SHAPE_COMPONENTS[type as PrimitiveTool],
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

export function measureTextBounds(
  text: string,
  fontFamily = "Arial",
  fontSize = 24,
  fontWeight = "normal",
  lineHeight = 1.2,
): { width: number; height: number } {
  const lines = text.slice(0, MAX_WIDGET_TEXT_LENGTH).split(/\r?\n/);
  let measuredWidth = 0;
  if (typeof document !== "undefined") {
    const context = document.createElement("canvas").getContext("2d");
    if (!context) throw new Error("The browser could not create a text measurement canvas.");
    context.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
    measuredWidth = Math.max(...lines.map((line) => context.measureText(line).width));
  } else {
    measuredWidth = Math.max(...lines.map((line) => [...line].length * fontSize * 0.6));
  }

  return {
    width: Math.max(1, Math.ceil(measuredWidth + 2)),
    height: Math.max(1, Math.ceil(lines.length * fontSize * lineHeight + 2)),
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
