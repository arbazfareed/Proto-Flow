import {
  ArrowRight,
  CheckSquare,
  Circle,
  CircleDot,
  Frame,
  Folder,
  Image,
  Layers,
  Minus,
  PanelTop,
  Puzzle,
  RectangleHorizontal,
  Repeat,
  Sparkles,
  Square,
  TextCursorInput,
  ToggleRight,
  Type,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

type WidgetCategory = "shape" | "widget" | "advanced" | "symbol" | "container";

export interface WidgetIconDefinition {
  icon: LucideIcon;
  color: string;
  category: WidgetCategory;
}

const SHAPE_COLOR = "#6b7280";
const WIDGET_COLOR = "#2563eb";
const ADVANCED_COLOR = "#ea580c";
const SYMBOL_COLOR = "#7c3aed";
const CONTAINER_COLOR = "#ca8a04";

function definition(
  icon: LucideIcon,
  color: string,
  category: WidgetCategory,
): WidgetIconDefinition {
  return { icon, color, category };
}

export const WIDGET_ICON_REGISTRY: Record<string, WidgetIconDefinition> = {
  rectangle: definition(Square, SHAPE_COLOR, "shape"),
  ellipse: definition(Circle, SHAPE_COLOR, "shape"),
  circle: definition(Circle, SHAPE_COLOR, "shape"),
  text: definition(Type, SHAPE_COLOR, "shape"),
  line: definition(Minus, SHAPE_COLOR, "shape"),
  arrow: definition(ArrowRight, SHAPE_COLOR, "shape"),
  icon: definition(Sparkles, SHAPE_COLOR, "shape"),
  button: definition(RectangleHorizontal, WIDGET_COLOR, "widget"),
  input: definition(TextCursorInput, WIDGET_COLOR, "widget"),
  image: definition(Image, WIDGET_COLOR, "widget"),
  checkbox: definition(CheckSquare, WIDGET_COLOR, "widget"),
  radio: definition(CircleDot, WIDGET_COLOR, "widget"),
  toggle: definition(ToggleRight, WIDGET_COLOR, "widget"),
  panel: definition(Layers, ADVANCED_COLOR, "advanced"),
  "dynamic-panel": definition(Layers, ADVANCED_COLOR, "advanced"),
  dynamicPanel: definition(Layers, ADVANCED_COLOR, "advanced"),
  repeater: definition(Repeat, ADVANCED_COLOR, "advanced"),
  symbol: definition(Puzzle, SYMBOL_COLOR, "symbol"),
  "symbol-instance": definition(Puzzle, SYMBOL_COLOR, "symbol"),
  symbolInstance: definition(Puzzle, SYMBOL_COLOR, "symbol"),
  group: definition(Folder, CONTAINER_COLOR, "container"),
  frame: definition(Frame, CONTAINER_COLOR, "container"),
  card: definition(RectangleHorizontal, CONTAINER_COLOR, "container"),
  modal: definition(PanelTop, CONTAINER_COLOR, "container"),
  overlay: definition(Layers, CONTAINER_COLOR, "container"),
};

export const UNKNOWN_WIDGET_ICON = definition(Square, "#9ca3af", "shape");

export function getWidgetIconDefinition(type: string): WidgetIconDefinition {
  return Object.hasOwn(WIDGET_ICON_REGISTRY, type)
    ? WIDGET_ICON_REGISTRY[type]
    : UNKNOWN_WIDGET_ICON;
}

export function WidgetIcon({
  type,
  size = 16,
}: {
  type: string;
  size?: number;
}) {
  const { icon: Icon, color } = getWidgetIconDefinition(type);
  return <Icon size={size} style={{ color }} aria-hidden="true" />;
}
