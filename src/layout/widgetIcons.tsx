import {
  AlignLeft,
  AlignJustify,
  AlertCircle,
  ArrowRight,
  Award,
  Badge,
  BarChart3,
  Box,
  Calendar,
  CalendarDays,
  CheckSquare,
  ChevronsLeftRight,
  ChevronsRight,
  ChevronsUpDown,
  ChevronDown,
  Circle,
  CircleDot,
  CircleUser,
  Component,
  FileText,
  Folder,
  Frame,
  GalleryHorizontal,
  GitCommitHorizontal,
  Grid3X3,
  Heading1,
  Image,
  Layers,
  LayoutDashboard,
  LayoutPanelTop,
  Laptop,
  Link,
  List,
  Loader,
  Loader2,
  Maximize,
  MousePointer2,
  Menu,
  MessageCircle,
  MessageSquare,
  Minus,
  Monitor,
  PanelBottom,
  PanelLeft,
  PanelRightOpen,
  PanelTop,
  PanelTopOpen,
  PanelsTopLeft,
  PenTool,
  ListPlus,
  Puzzle,
  RectangleHorizontal,
  Repeat,
  Search,
  SeparatorHorizontal,
  Smartphone,
  SlidersHorizontal,
  Sparkles,
  Square,
  SquareChevronDown,
  SquareStack,
  Star,
  Table,
  Tablet,
  Tag,
  Tags,
  TextCursorInput,
  ToggleRight,
  TrendingUp,
  Triangle,
  Type,
  Upload,
  Video,
  Watch,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { DeviceCategory } from "../devices/types";

export type WidgetCategory =
  | "shape"
  | "text"
  | "widget"
  | "form"
  | "display"
  | "navigation"
  | "data"
  | "advanced"
  | "symbol"
  | "container";

export interface WidgetIconDefinition {
  icon: LucideIcon;
  color: string;
  category: WidgetCategory;
}

const SHAPE_COLOR = "#64748b";
const WIDGET_COLOR = "#3b82f6";
const ADVANCED_COLOR = "#f97316";
const SYMBOL_COLOR = "#8b5cf6";
const CONTAINER_COLOR = "#f59e0b";
const SCREEN_COLOR = "#6366f1";

function definition(
  icon: LucideIcon,
  color: string,
  category: WidgetCategory,
): WidgetIconDefinition {
  return { icon, color, category };
}

const shape = (icon: LucideIcon) => definition(icon, SHAPE_COLOR, "shape");
const text = (icon: LucideIcon) => definition(icon, SHAPE_COLOR, "text");
const widget = (icon: LucideIcon) => definition(icon, WIDGET_COLOR, "widget");
const form = (icon: LucideIcon) => definition(icon, WIDGET_COLOR, "form");
const display = (icon: LucideIcon) => definition(icon, WIDGET_COLOR, "display");
const navigation = (icon: LucideIcon) => definition(icon, WIDGET_COLOR, "navigation");
const data = (icon: LucideIcon) => definition(icon, WIDGET_COLOR, "data");
const advanced = (icon: LucideIcon) => definition(icon, ADVANCED_COLOR, "advanced");
const container = (icon: LucideIcon) => definition(icon, CONTAINER_COLOR, "container");
const symbol = (icon: LucideIcon) => definition(icon, SYMBOL_COLOR, "symbol");

export const WIDGET_ICON_REGISTRY: Record<string, WidgetIconDefinition> = {
  rectangle: shape(Square),
  ellipse: shape(Circle),
  circle: shape(Circle),
  polygon: shape(Triangle),
  star: shape(Star),
  line: shape(Minus),
  arrow: shape(ArrowRight),
  divider: shape(SeparatorHorizontal),
  vector: shape(PenTool),
  path: shape(PenTool),
  icon: shape(Sparkles),
  "custom-icon": shape(Sparkles),
  customIcon: shape(Sparkles),

  text: text(Type),
  heading: text(Heading1),
  paragraph: text(AlignLeft),
  link: text(Link),
  label: text(Tag),

  frame: container(Frame),
  group: container(Folder),
  card: container(SquareStack),
  modal: container(Maximize),
  overlay: container(Layers),
  drawer: container(PanelRightOpen),
  section: container(LayoutPanelTop),

  panel: advanced(PanelsTopLeft),
  "dynamic-panel": advanced(PanelsTopLeft),
  dynamicPanel: advanced(PanelsTopLeft),
  repeater: advanced(Repeat),
  accordion: advanced(ChevronsUpDown),
  carousel: advanced(GalleryHorizontal),
  "tabs-container": advanced(LayoutDashboard),
  tabsContainer: advanced(LayoutDashboard),

  button: widget(RectangleHorizontal),
  "icon-button": form(MousePointer2),
  iconButton: form(MousePointer2),
  input: widget(TextCursorInput),
  textarea: form(AlignJustify),
  "text-area": form(AlignJustify),
  select: form(SquareChevronDown),
  dropdown: form(SquareChevronDown),
  checkbox: widget(CheckSquare),
  radio: widget(CircleDot),
  toggle: widget(ToggleRight),
  switch: widget(ToggleRight),
  slider: form(SlidersHorizontal),
  stepper: form(ListPlus),
  "date-picker": form(Calendar),
  datePicker: form(Calendar),
  "file-upload": form(Upload),
  fileUpload: form(Upload),
  search: form(Search),
  "search-bar": form(Search),
  searchBar: form(Search),
  form: form(FileText),

  image: widget(Image),
  avatar: display(CircleUser),
  video: display(Video),
  badge: display(Badge),
  chip: display(Tags),
  tag: display(Tags),
  tooltip: display(MessageSquare),
  popover: display(MessageCircle),
  alert: display(AlertCircle),
  banner: display(AlertCircle),
  progress: display(Loader),
  "progress-bar": display(Loader),
  progressBar: display(Loader),
  spinner: display(Loader2),
  skeleton: display(Box),
  rating: display(Award),

  navbar: navigation(PanelTop),
  sidebar: navigation(PanelLeft),
  tabs: navigation(PanelTopOpen),
  breadcrumb: navigation(ChevronsRight),
  pagination: navigation(ChevronsLeftRight),
  menu: navigation(Menu),
  "dropdown-menu": navigation(ChevronDown),
  dropdownMenu: navigation(ChevronDown),
  footer: navigation(PanelBottom),

  table: data(Table),
  list: data(List),
  grid: data(Grid3X3),
  chart: data(BarChart3),
  stat: data(TrendingUp),
  kpi: data(TrendingUp),
  timeline: data(GitCommitHorizontal),
  calendar: data(CalendarDays),

  symbol: symbol(Puzzle),
  "symbol-instance": symbol(Puzzle),
  symbolInstance: symbol(Puzzle),
  "component-master": symbol(Component),
  componentMaster: symbol(Component),
};

export const UNKNOWN_WIDGET_ICON = definition(Square, "#9ca3af", "shape");

const SCREEN_ICON_REGISTRY: Record<DeviceCategory, LucideIcon> = {
  phone: Smartphone,
  tablet: Tablet,
  laptop: Laptop,
  desktop: Monitor,
  watch: Watch,
};

export function getScreenIconDefinition(category: DeviceCategory): WidgetIconDefinition {
  return definition(SCREEN_ICON_REGISTRY[category], SCREEN_COLOR, "widget");
}

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

export function ScreenIcon({
  category,
  size = 16,
}: {
  category: DeviceCategory;
  size?: number;
}) {
  const { icon: Icon, color } = getScreenIconDefinition(category);
  return <Icon size={size} style={{ color }} aria-hidden="true" />;
}
