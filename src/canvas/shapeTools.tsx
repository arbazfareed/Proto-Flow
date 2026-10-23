import type { ComponentType } from "react";
import {
  Activity,
  ArrowDownRight,
  AppWindow,
  Columns3,
  CheckSquare,
  CodeXml,
  Container,
  Image,
  MousePointer2,
  Radio,
  Rows3,
  Shapes,
  Smartphone,
  Star,
  Space,
  ToggleRight,
  Type,
  TextCursorInput,
  Video,
} from "lucide-react";
import type { WidgetStyle } from "../project/schema";
import { getWidgetIconDefinition } from "../layout/widgetIcons";

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

export const GENERIC_ELEMENT_TOOL_LABELS = {
  container: "Container",
  "flex-row": "Flex Row",
  "flex-column": "Flex Column",
  spacer: "Spacer",
  "mobile-app": "Mobile app icon",
  "web-app": "Web app icon",
  polygon: "Polygon",
  star: "Star",
  divider: "Divider",
  vector: "Vector",
  path: "Path",
  "custom-icon": "Custom icon",
  heading: "Heading",
  paragraph: "Paragraph",
  link: "Link",
  label: "Label",
  frame: "Frame",
  group: "Group",
  card: "Card",
  modal: "Modal",
  overlay: "Overlay",
  drawer: "Drawer",
  section: "Section",
  panel: "Panel",
  "dynamic-panel": "Dynamic panel",
  repeater: "Repeater",
  accordion: "Accordion",
  carousel: "Carousel",
  "tabs-container": "Tabs container",
  "icon-button": "Icon button",
  textarea: "Textarea",
  select: "Select",
  slider: "Slider",
  stepper: "Stepper",
  "date-picker": "Date picker",
  "file-upload": "File upload",
  search: "Search",
  form: "Form",
  avatar: "Avatar",
  video: "Video",
  badge: "Badge",
  chip: "Chip",
  tag: "Tag",
  tooltip: "Tooltip",
  popover: "Popover",
  alert: "Alert",
  banner: "Banner",
  "progress-bar": "Progress bar",
  spinner: "Spinner",
  skeleton: "Skeleton",
  rating: "Rating",
  navbar: "Navbar",
  sidebar: "Sidebar",
  tabs: "Tabs",
  breadcrumb: "Breadcrumb",
  pagination: "Pagination",
  menu: "Menu",
  "dropdown-menu": "Dropdown menu",
  footer: "Footer",
  table: "Table",
  list: "List",
  grid: "Grid",
  chart: "Chart",
  stat: "Stat",
  timeline: "Timeline",
  calendar: "Calendar",
  "symbol-instance": "Symbol instance",
  "component-master": "Component master",
  toast: "Toast",
  notification: "Notification",
  "metric-card": "Metric card",
  "profile-card": "Profile card",
  "empty-state": "Empty state",
  "code-block": "Code block",
  "segmented-control": "Segmented control",
  "step-indicator": "Step indicator",
  "bottom-nav": "Bottom navigation",
  "pricing-card": "Pricing card",
} as const;

export type GenericElementTool = keyof typeof GENERIC_ELEMENT_TOOL_LABELS;
export type ShapeTool = PrimitiveTool | WidgetTool | GenericElementTool;

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

const CORE_SHAPE_TOOL_DEFINITIONS: Record<
  PrimitiveTool | WidgetTool,
  ShapeToolDefinition
> = {
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
    style: { fill: "#1e1f23", stroke: "#777780", strokeWidth: 1.4, cornerRadius: 4 },
    props: { label: "Checkbox", checked: false },
    icon: CheckSquare,
  },
  radio: {
    label: "Radio",
    shortcut: "Shift+R",
    width: 160,
    height: 24,
    style: { fill: "#1e1f23", stroke: "#777780", strokeWidth: 1.4 },
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

const TEXT_ELEMENT_TOOLS = new Set<GenericElementTool>([
  "heading",
  "paragraph",
  "link",
  "label",
]);
const CONTAINER_ELEMENT_TOOLS = new Set<GenericElementTool>([
  "container",
  "flex-row",
  "flex-column",
  "frame",
  "group",
  "card",
  "modal",
  "overlay",
  "drawer",
  "section",
  "panel",
  "dynamic-panel",
  "repeater",
  "accordion",
  "carousel",
  "tabs-container",
  "form",
  "navbar",
  "sidebar",
  "tabs",
  "menu",
  "dropdown-menu",
  "footer",
  "bottom-nav",
  "pricing-card",
]);

function genericElementDimensions(type: GenericElementTool): [number, number] {
  if (type === "spacer") return [48, 24];
  if (type === "container") return [240, 160];
  if (type === "flex-row" || type === "flex-column") return [280, 144];
  if (type === "card") return [260, 196];
  if (type === "chart") return [240, 160];
  if (type === "video") return [240, 150];
  if (type === "icon-button") return [40, 40];
  if (type === "custom-icon") return [32, 32];
  if (type === "badge") return [88, 28];
  if (type === "chip" || type === "tag") return [96, 32];
  if (type === "spinner") return [40, 40];
  if (type === "profile-card" || type === "pricing-card") return [240, 160];
  if (type === "toast" || type === "notification" || type === "empty-state") {
    return [240, 96];
  }
  if (type === "metric-card") return [180, 104];
  if (type === "code-block") return [240, 120];
  if (type === "segmented-control") return [220, 40];
  if (type === "step-indicator") return [240, 48];
  if (type === "bottom-nav") return [240, 64];
  if (CONTAINER_ELEMENT_TOOLS.has(type)) return [240, 140];
  if (type === "avatar") return [56, 56];
  if (type === "table" || type === "grid") {
    return [200, 120];
  }
  if (type === "list") return [220, 96];
  return [160, 48];
}

function genericElementDefinition(
  type: GenericElementTool,
  label: string,
): ShapeToolDefinition {
  const { color } = getWidgetIconDefinition(type);
  const [width, height] = genericElementDimensions(type);
  const isText = TEXT_ELEMENT_TOOLS.has(type);
  const style: WidgetStyle = {
    fill: color,
    fillOpacity: isText ? 1 : 0.1,
    stroke: isText ? null : color,
    strokeWidth: isText ? 0 : 1,
    cornerRadius: isText ? 0 : CONTAINER_ELEMENT_TOOLS.has(type) ? 8 : 5,
  };
  if (type === "avatar") {
    style.fillOpacity = 1;
    style.stroke = null;
  }
  const props = TEXT_ELEMENT_TOOLS.has(type)
    ? {
        text: label,
        fontFamily: "Arial",
        fontSize: type === "heading" ? 28 : 16,
        fontWeight: type === "heading" ? "bold" : "normal",
        align: "left",
        lineHeight: 1.2,
      }
    : type === "avatar"
      ? { label: "Alex Morgan", initials: "AM" }
      : type === "icon-button"
        ? { label: "", iconName: "Plus" }
        : type === "textarea"
          ? { label: "Message", placeholder: "Write something..." }
          : type === "select"
            ? { label: "Choose an option", placeholder: "Select..." }
            : type === "date-picker"
              ? { label: "Select date", placeholder: "MM/DD/YYYY" }
              : type === "search"
                ? { label: "Search", placeholder: "Search..." }
                : type === "file-upload"
                  ? { label: "Upload file", placeholder: "Browse or drop a file" }
                  : type === "slider"
                    ? { label: "Volume", value: 65 }
                    : type === "stepper"
                      ? { label: "Quantity", value: 2 }
        : type === "custom-icon"
          ? { label, iconName: "Star" }
          : type === "metric-card"
            ? { label: "Revenue", value: "$24,800", trend: "+12.8%" }
            : type === "profile-card"
              ? { label: "Alex Morgan", subtitle: "Product designer", initials: "AM" }
              : type === "empty-state"
                ? { label: "Nothing here yet", subtitle: "New items will appear here." }
                : type === "code-block"
                  ? { label: "const app = 'Proto Flow';", language: "JavaScript" }
                  : type === "segmented-control"
                    ? { label: "Overview  |  Activity  |  Settings", selected: 0 }
                    : type === "step-indicator"
                      ? { label: "Details  |  Shipping  |  Review", step: 1 }
                      : type === "bottom-nav"
                        ? { label: "Home  |  Search  |  Profile", selected: 0 }
                        : type === "pricing-card"
                          ? { label: "Pro", subtitle: "$19 / month" }
                          : type === "toast" || type === "notification"
                            ? { label: type === "toast" ? "Changes saved" : "New message", subtitle: "Just now" }
    : type === "card"
      ? {
          title: "Product card",
          subtitle: "A short description goes here.",
          imageSrc: "",
          actionLabel: "Learn more",
        }
      : type === "chart"
        ? {
            label: "Monthly activity",
            chartType: "bar",
            values: [38, 68, 50, 88, 62],
          }
        : type === "alert"
          ? {
              label: "Changes saved",
              subtitle: "Your work is up to date.",
              variant: "info",
              dismissible: true,
            }
          : type === "video"
            ? { label: "Product overview", src: "", poster: "" }
            : type === "mobile-app"
              ? { label: "Mobile app", iconName: "Smartphone" }
              : type === "web-app"
                ? { label: "Web app", iconName: "AppWindow" }
            : type === "container"
              ? { label, layout: "freeform", gap: 12, padding: 16 }
              : type === "flex-row" || type === "flex-column"
                ? {
                    label,
                    layout: type,
                    gap: 12,
                    padding: 12,
                    alignItems: "center",
                    justifyContent: "flex-start",
                  }
                : type === "spacer"
                  ? { label: "Spacer", size: 24 }
    : type === "list"
      ? {
          items: ["List item 1", "List item 2", "List item 3"],
          listStyle: "bullet",
          fontFamily: "Arial",
          fontSize: 16,
          fontWeight: "normal",
          lineHeight: 1.4,
        }
      : type === "repeater"
        ? {
            label,
            rowTemplate: { widgets: [] },
            dataset: [{ title: "Item 1" }, { title: "Item 2" }, { title: "Item 3" }],
            layout: "vertical",
            gap: 8,
            itemBinding: {},
          }
        : { label };
  if (type === "spacer") {
    style.fillOpacity = 0;
    style.stroke = null;
    style.strokeWidth = 0;
  }
  return {
    label,
    shortcut: "",
    width,
    height,
    style,
    props,
    icon: type === "container"
      ? Container
      : type === "flex-row"
        ? Rows3
        : type === "flex-column"
          ? Columns3
          : type === "spacer"
            ? Space
            : type === "video"
              ? Video
              : type === "mobile-app"
                ? Smartphone
                : type === "web-app"
                  ? AppWindow
                  : type === "code-block"
                    ? CodeXml
                    : getWidgetIconDefinition(type).icon,
  };
}

const GENERIC_ELEMENT_TOOL_DEFINITIONS = Object.fromEntries(
  Object.entries(GENERIC_ELEMENT_TOOL_LABELS).map(([type, label]) => [
    type,
    genericElementDefinition(type as GenericElementTool, label),
  ]),
) as Record<GenericElementTool, ShapeToolDefinition>;

export const SHAPE_TOOL_DEFINITIONS: Record<ShapeTool, ShapeToolDefinition> = {
  ...CORE_SHAPE_TOOL_DEFINITIONS,
  ...GENERIC_ELEMENT_TOOL_DEFINITIONS,
};

export const SHAPE_TOOLS = [...PRIMITIVE_TOOLS, ...WIDGET_TOOLS];
export const ELEMENT_LIBRARY_TOOL_TYPES = [
  ...SHAPE_TOOLS,
  ...Object.keys(GENERIC_ELEMENT_TOOL_LABELS),
] as ShapeTool[];

export function getShapeToolDefinition(
  type: string,
): ShapeToolDefinition | undefined {
  return Object.hasOwn(SHAPE_TOOL_DEFINITIONS, type)
    ? SHAPE_TOOL_DEFINITIONS[type as ShapeTool]
    : undefined;
}
