import type { ComponentType } from "react";
import {
  Activity,
  ArrowDownRight,
  CheckSquare,
  Image,
  MousePointer2,
  Radio,
  Shapes,
  Star,
  ToggleRight,
  Type,
  TextCursorInput,
} from "lucide-react";
import type { WidgetStyle } from "../project/schema";

export const PRIMITIVE_TOOLS = [
  "rectangle",
  "ellipse",
  "text",
  "line",
  "arrow",
  "icon",
] as const;
export const WIDGET_TOOLS = [
  "button",
  "input",
  "image",
  "checkbox",
  "radio",
  "toggle",
] as const;
export type PrimitiveTool = (typeof PRIMITIVE_TOOLS)[number];
export type WidgetTool = (typeof WIDGET_TOOLS)[number];
export type ShapeTool = PrimitiveTool | WidgetTool;

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
    shortcut: "",
    width: 32,
    height: 32,
    style: { fill: null, stroke: "#e9e9ec", strokeWidth: 1.8 },
    props: { iconName: "Star" },
    icon: Star,
  },
  button: {
    label: "Button",
    shortcut: "B",
    width: 120,
    height: 40,
    style: { fill: "#8b69ed", stroke: "#8b69ed", strokeWidth: 1, cornerRadius: 7 },
    props: { label: "Button", variant: "primary", state: "default" },
    icon: MousePointer2,
  },
  input: {
    label: "Input",
    shortcut: "I",
    width: 240,
    height: 40,
    style: { fill: "#1e1f23", stroke: "#45464e", strokeWidth: 1, cornerRadius: 6 },
    props: { label: "", placeholder: "Enter text…", value: "", type: "text" },
    icon: TextCursorInput,
  },
  image: {
    label: "Image",
    shortcut: "M",
    width: 200,
    height: 200,
    style: { fill: "#202126", stroke: "#56515f", strokeWidth: 1, cornerRadius: 4 },
    props: { src: "", mime: "", fileName: "" },
    icon: Image,
  },
  checkbox: {
    label: "Checkbox",
    shortcut: "C",
    width: 160,
    height: 24,
    style: { fill: null, stroke: null, strokeWidth: 0 },
    props: { label: "Checkbox", checked: false },
    icon: CheckSquare,
  },
  radio: {
    label: "Radio",
    shortcut: "Shift+R",
    width: 160,
    height: 24,
    style: { fill: null, stroke: null, strokeWidth: 0 },
    props: { label: "Radio", selected: false, groupName: "radio-group" },
    icon: Radio,
  },
  toggle: {
    label: "Toggle",
    shortcut: "Shift+T",
    width: 60,
    height: 32,
    style: { fill: "#34353b", stroke: null, strokeWidth: 0, cornerRadius: 16 },
    props: { on: false, label: "" },
    icon: ToggleRight,
  },
};

export const SHAPE_TOOLS = [...PRIMITIVE_TOOLS, ...WIDGET_TOOLS];

export function getShapeToolDefinition(
  type: string,
): ShapeToolDefinition | undefined {
  return Object.hasOwn(SHAPE_TOOL_DEFINITIONS, type)
    ? SHAPE_TOOL_DEFINITIONS[type as ShapeTool]
    : undefined;
}
