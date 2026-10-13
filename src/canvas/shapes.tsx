import type { ComponentType, ReactNode } from "react";
import {
  Arrow,
  Ellipse,
  Group,
  Line,
  Path,
  Rect,
  Text as KonvaText,
} from "react-konva";
import type { Widget } from "../project/schema";
import {
  SHAPE_TOOL_DEFINITIONS,
  SHAPE_TOOLS,
  type ShapeTool,
  type ShapeToolDefinition,
} from "./shapeTools";
export { SHAPE_TOOLS };
export type { ShapeTool };

export interface ShapeComponentProps {
  widget: Widget;
  fill: string | undefined;
  stroke: string | undefined;
  strokeWidth: number;
}

export interface ShapeDefinition extends ShapeToolDefinition {
  component: ComponentType<ShapeComponentProps>;
}

const DEFAULT_STROKE = "#a78bfa";

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
  const text = typeof widget.props.text === "string" ? widget.props.text : "Text";

  return (
    <KonvaText
      width={widget.width}
      height={widget.height}
      text={text}
      fontFamily={fontFamily}
      fontSize={fontSize}
      fontStyle={`${fontStyle} ${fontWeight}`.trim()}
      align={typeof widget.props.align === "string" ? widget.props.align : "left"}
      lineHeight={
        typeof widget.props.lineHeight === "number" ? widget.props.lineHeight : 1.2
      }
      wrap="word"
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
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
      lineCap="round"
      lineJoin="round"
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
      pointerLength={typeof widget.props.pointerLength === "number" ? widget.props.pointerLength : 10}
      pointerWidth={typeof widget.props.pointerWidth === "number" ? widget.props.pointerWidth : 8}
      lineCap="round"
      lineJoin="round"
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

const SHAPE_COMPONENTS: Record<
  ShapeTool,
  ComponentType<ShapeComponentProps>
> = {
  rectangle: RectangleShape,
  ellipse: EllipseShape,
  text: TextShape,
  line: LineShape,
  arrow: ArrowShape,
  icon: IconShape,
};

const SHAPE_REGISTRY = Object.fromEntries(
  Object.entries(SHAPE_TOOL_DEFINITIONS).map(([type, definition]) => [
    type,
    { ...definition, component: SHAPE_COMPONENTS[type as ShapeTool] },
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
  const lines = text.split(/\r?\n/);
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
): ReactNode {
  const definition = getShapeDefinition(widget.type);
  const ShapeComponent = definition?.component ?? RectangleShape;
  const fill =
    widget.type === "text"
      ? (widget.style.fill ?? "#e9e9ec")
      : (widget.style.fill ?? (widget.type === "icon" ? undefined : "#5c4a89"));
  const stroke = selected
    ? "#bba5ff"
    : widget.style.stroke === null
      ? undefined
      : (widget.style.stroke ?? DEFAULT_STROKE);
  const strokeWidth = selected
    ? Math.max(widget.style.strokeWidth ?? 1, 1.5)
    : (widget.style.strokeWidth ?? 1);

  return (
    <ShapeComponent
      widget={widget}
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
    />
  );
}
