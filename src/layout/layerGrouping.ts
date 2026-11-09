import type { Widget } from "../project/schema";
import { isWidgetContainer } from "../project/layers";
import {
  WIDGET_ICON_REGISTRY,
  type WidgetCategory,
} from "./widgetIcons";

export const LAYER_VIEW_MODES = ["category", "z-order", "type"] as const;
export type LayerViewMode = (typeof LAYER_VIEW_MODES)[number];

export const LAYER_CATEGORIES = [
  "shapes",
  "widgets",
  "advanced",
  "symbols",
  "containers",
  "other",
] as const;
export type LayerCategoryId = (typeof LAYER_CATEGORIES)[number];

export interface LayerCategoryDefinition {
  id: LayerCategoryId;
  label: string;
  icon: "square" | "layout-grid" | "layers" | "puzzle" | "folder" | "help";
  background: string;
  badge: string;
}

export interface LayerGroup {
  id: string;
  label: string;
  category: LayerCategoryId;
  widgets: Widget[];
}

export const LAYER_CATEGORY_DEFINITIONS: Record<LayerCategoryId, LayerCategoryDefinition> = {
  shapes: {
    id: "shapes",
    label: "Shapes",
    icon: "square",
    background: "#EEF2FF",
    badge: "#6366F1",
  },
  widgets: {
    id: "widgets",
    label: "Widgets",
    icon: "layout-grid",
    background: "#ECFDF5",
    badge: "#10B981",
  },
  advanced: {
    id: "advanced",
    label: "Advanced",
    icon: "layers",
    background: "#FFF7ED",
    badge: "#F97316",
  },
  symbols: {
    id: "symbols",
    label: "Symbols",
    icon: "puzzle",
    background: "#F5F3FF",
    badge: "#8B5CF6",
  },
  containers: {
    id: "containers",
    label: "Containers",
    icon: "folder",
    background: "#FEF9C3",
    badge: "#EAB308",
  },
  other: {
    id: "other",
    label: "Other",
    icon: "help",
    background: "#F9FAFB",
    badge: "#6B7280",
  },
};

const LAYER_CATEGORY_BY_WIDGET_CATEGORY: Record<WidgetCategory, LayerCategoryId> = {
  shape: "shapes",
  text: "shapes",
  layout: "containers",
  container: "containers",
  widget: "widgets",
  form: "widgets",
  display: "widgets",
  navigation: "widgets",
  data: "widgets",
  media: "widgets",
  advanced: "advanced",
  symbol: "symbols",
};

const LAYER_CATEGORY_OVERRIDES: Partial<
  Record<string, Exclude<LayerCategoryId, "other">>
> = {
  spacer: "shapes",
  form: "containers",
  navbar: "containers",
  sidebar: "containers",
  tabs: "containers",
  menu: "containers",
  "dropdown-menu": "containers",
  dropdownMenu: "containers",
  footer: "containers",
  "app-bar": "containers",
  database: "advanced",
};

const LAYER_ACCENT_COLORS: Record<LayerCategoryId, string> = {
  shapes: "#94A3B8",
  widgets: "#3B82F6",
  advanced: "#F97316",
  symbols: "#8B5CF6",
  containers: "#F59E0B",
  other: "#94A3B8",
};

export function getLayerAccentColor(widget: Widget): string {
  const category = getLayerCategory(widget.type, widget.layerCategory);
  if (category === "advanced") return LAYER_ACCENT_COLORS.advanced;
  if (category === "symbols") return LAYER_ACCENT_COLORS.symbols;
  if (category === "containers" || (category === "shapes" && isWidgetContainer(widget))) {
    return LAYER_ACCENT_COLORS.containers;
  }
  return LAYER_ACCENT_COLORS[category];
}

export function getLayerCategory(
  type: string,
  categoryOverride?: LayerCategoryId,
): LayerCategoryId {
  if (categoryOverride) return categoryOverride;
  const override = LAYER_CATEGORY_OVERRIDES[type];
  if (override) return override;
  const definition = WIDGET_ICON_REGISTRY[type];
  return definition
    ? LAYER_CATEGORY_BY_WIDGET_CATEGORY[definition.category]
    : "other";
}

function defaultCategoryOrder(order: string[]): string[] {
  const validOrder = order.filter((id, index) => LAYER_CATEGORIES.includes(id as LayerCategoryId) && order.indexOf(id) === index);
  return [...validOrder, ...LAYER_CATEGORIES.filter((id) => !validOrder.includes(id))];
}

function compareWidgetOrder(first: Widget, second: Widget): number {
  return second.zIndex - first.zIndex;
}

export function buildLayerGroups(
  widgets: Widget[],
  mode: LayerViewMode,
  groupOrder: string[] = [],
  labelForType: (type: string) => string = (type) => type,
): LayerGroup[] {
  if (mode === "z-order") {
    const orderedWidgets = [...widgets].sort(compareWidgetOrder);
    return orderedWidgets.length > 0
      ? [{ id: "z-order", label: "Z-Order", category: "other", widgets: orderedWidgets }]
      : [];
  }

  const groupsById = new Map<string, LayerGroup>();
  for (const widget of widgets) {
    const category = mode === "category"
      ? getLayerCategory(widget.type, widget.layerCategory)
      : "other";
    const id = mode === "category" ? category : widget.type;
    const label = mode === "category" ? LAYER_CATEGORY_DEFINITIONS[category].label : labelForType(widget.type);
    const group = groupsById.get(id) ?? { id, label, category, widgets: [] };
    group.widgets.push(widget);
    groupsById.set(id, group);
  }
  for (const group of groupsById.values()) group.widgets.sort(compareWidgetOrder);

  const defaultOrder = mode === "category"
    ? defaultCategoryOrder(groupOrder)
    : [...groupOrder, ...[...groupsById.keys()].filter((id) => !groupOrder.includes(id))];
  const remaining = [...groupsById.values()].sort(
    (first, second) => compareWidgetOrder(first.widgets[0], second.widgets[0]) || first.label.localeCompare(second.label),
  );
  const orderIndex = new Map(defaultOrder.map((id, index) => [id, index]));
  return remaining.sort((first, second) => {
    const firstIndex = orderIndex.get(first.id);
    const secondIndex = orderIndex.get(second.id);
    if (firstIndex !== undefined || secondIndex !== undefined) {
      return (firstIndex ?? Number.MAX_SAFE_INTEGER) - (secondIndex ?? Number.MAX_SAFE_INTEGER);
    }
    return compareWidgetOrder(first.widgets[0], second.widgets[0]) || first.label.localeCompare(second.label);
  });
}
