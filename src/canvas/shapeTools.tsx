import type { ComponentType } from "react";
import {
  Activity,
  ArrowDownRight,
  Shapes,
  Star,
  Type,
} from "lucide-react";
import type { WidgetStyle } from "../project/schema";

export type ShapeTool = "rectangle" | "ellipse" | "text" | "line" | "arrow" | "icon";

export interface ShapeToolDefinition {
  label: string;
  shortcut: string;
  width: number;
  height: number;
  style: WidgetStyle;
  props: Record<string, unknown>;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
}

const DEFAULT_STROKE = "#a78bfa";

export const SHAPE_TOOL_DEFINITIONS: Record<ShapeTool, ShapeToolDefinition> = {
  rectangle: {
    label: "Rectangle",
    shortcut: "R",
    width: 100,
    height: 100,
    style: { fill: "#5c4a89", stroke: DEFAULT_STROKE, strokeWidth: 1, cornerRadius: 0 },
    props: {},
    icon: Shapes,
  },
  ellipse: {
    label: "Ellipse",
    shortcut: "O",
    width: 100,
    height: 100,
    style: { fill: "#5c4a89", stroke: DEFAULT_STROKE, strokeWidth: 1 },
    props: {},
    icon: Activity,
  },
  text: {
    label: "Text",
    shortcut: "T",
    width: 64,
    height: 32,
    style: { fill: "#e9e9ec", stroke: null, strokeWidth: 0 },
    props: {
      text: "Text",
      fontFamily: "Arial",
      fontSize: 24,
      fontWeight: "normal",
      fontStyle: "normal",
      align: "left",
      lineHeight: 1.2,
      autoSize: true,
    },
    icon: Type,
  },
  line: {
    label: "Line",
    shortcut: "L",
    width: 200,
    height: 1,
    style: { fill: null, stroke: DEFAULT_STROKE, strokeWidth: 2 },
    props: { points: [0, 0, 200, 0] },
    icon: ArrowDownRight,
  },
  arrow: {
    label: "Arrow",
    shortcut: "",
    width: 200,
    height: 1,
    style: { fill: null, stroke: DEFAULT_STROKE, strokeWidth: 2 },
    props: { points: [0, 0, 200, 0], pointerLength: 10, pointerWidth: 8 },
    icon: ArrowDownRight,
  },
  icon: {
    label: "Icon",
    shortcut: "I",
    width: 32,
    height: 32,
    style: { fill: null, stroke: "#e9e9ec", strokeWidth: 1.8 },
    props: { iconName: "Star" },
    icon: Star,
  },
};

export const SHAPE_TOOLS = Object.keys(SHAPE_TOOL_DEFINITIONS) as ShapeTool[];

export function getShapeToolDefinition(
  type: string,
): ShapeToolDefinition | undefined {
  return Object.hasOwn(SHAPE_TOOL_DEFINITIONS, type)
    ? SHAPE_TOOL_DEFINITIONS[type as ShapeTool]
    : undefined;
}
