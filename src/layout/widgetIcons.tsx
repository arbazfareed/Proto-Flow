import {
  Activity,
  AlignLeft,
  AlignJustify,
  AppWindow,
  AlertCircle,
  ArrowRight,
  Award,
  BadgeCheck,
  BadgeDollarSign,
  BellRing,
  Calendar,
  CalendarDays,
  ChartPie,
  CheckSquare,
  ChevronsLeftRight,
  ChevronsRight,
  ChevronsUpDown,
  ChevronDown,
  Circle,
  CircleGauge,
  CircleDot,
  CloudOff,
  Component,
  CodeXml,
  Columns2,
  ContactRound,
  CreditCard,
  FileText,
  Folder,
  Frame,
  GalleryVerticalEnd,
  Hash,
  Grid3X3,
  Heading1,
  Image,
  Inbox,
  Gauge,
  LayoutTemplate,
  LayoutDashboard,
  LayoutPanelTop,
  Laptop,
  Link,
  List,
  ListChecks,
  ListOrdered,
  Loader,
  Loader2,
  Maximize,
  Megaphone,
  MonitorPlay,
  MousePointer2,
  Menu,
  MessageCircle,
  MessageSquare,
  Minus,
  MoveVertical,
  Monitor,
  Navigation,
  PanelBottom,
  PanelLeft,
  PanelLeftClose,
  PanelRightOpen,
  PanelTop,
  PanelTopOpen,
  PanelsTopLeft,
  PenTool,
  ListPlus,
  Rows2,
  Puzzle,
  RectangleHorizontal,
  RectangleEllipsis,
  Repeat,
  Search,
  SeparatorHorizontal,
  Smartphone,
  SlidersHorizontal,
  Sparkles,
  Spline,
  Shapes,
  Square,
  SquareDashed,
  SquareChevronDown,
  Star,
  Table,
  Tablet,
  Tag,
  Tags,
  TextCursorInput,
  ToggleRight,
  UserRound,
  TrendingUp,
  Triangle,
  Waypoints,
  Type,
  Upload,
  Watch,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { DeviceCategory } from "../devices/types";

export type WidgetCategory =
  | "shape"
  | "text"
  | "layout"
  | "media"
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
const FORM_COLOR = "#34d399";
const DISPLAY_COLOR = "#a78bfa";
const NAVIGATION_COLOR = "#38bdf8";
const DATA_COLOR = "#fbbf24";
const MEDIA_COLOR = "#f472b6";
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
const form = (icon: LucideIcon) => definition(icon, FORM_COLOR, "form");
const display = (icon: LucideIcon) => definition(icon, DISPLAY_COLOR, "display");
const navigation = (icon: LucideIcon) => definition(icon, NAVIGATION_COLOR, "navigation");
const data = (icon: LucideIcon) => definition(icon, DATA_COLOR, "data");
const advanced = (icon: LucideIcon) => definition(icon, ADVANCED_COLOR, "advanced");
const container = (icon: LucideIcon) => definition(icon, CONTAINER_COLOR, "container");
const layout = (icon: LucideIcon) => definition(icon, CONTAINER_COLOR, "layout");
const media = (icon: LucideIcon) => definition(icon, MEDIA_COLOR, "media");
const symbol = (icon: LucideIcon) => definition(icon, SYMBOL_COLOR, "symbol");

export const WIDGET_ICON_REGISTRY: Record<string, WidgetIconDefinition> = {
  container: layout(LayoutTemplate),
  "flex-row": layout(Rows2),
  "flex-column": layout(Columns2),
  spacer: layout(MoveVertical),
  rectangle: shape(Square),
  ellipse: shape(Circle),
  circle: shape(Circle),
  polygon: shape(Triangle),
  star: shape(Star),
  line: shape(Minus),
  arrow: shape(ArrowRight),
  divider: shape(SeparatorHorizontal),
  vector: shape(PenTool),
  path: shape(Spline),
  icon: shape(Sparkles),
  "custom-icon": shape(Shapes),
  customIcon: shape(Sparkles),

  text: text(Type),
  heading: text(Heading1),
  paragraph: text(AlignLeft),
  link: text(Link),
  label: text(Hash),

  frame: container(Frame),
  group: container(Folder),
  card: container(CreditCard),
  modal: container(Maximize),
  overlay: container(SquareDashed),
  drawer: container(PanelRightOpen),
  section: container(LayoutPanelTop),

  panel: advanced(PanelsTopLeft),
  "dynamic-panel": advanced(PanelLeftClose),
  dynamicPanel: advanced(PanelLeftClose),
  repeater: advanced(Repeat),
  accordion: advanced(ChevronsUpDown),
  carousel: advanced(GalleryVerticalEnd),
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

  image: media(Image),
  avatar: display(UserRound),
  video: media(MonitorPlay),
  "mobile-app": media(Smartphone),
  "web-app": media(AppWindow),
  badge: display(BadgeCheck),
  chip: display(Tags),
  tag: display(Tag),
  tooltip: display(MessageSquare),
  popover: display(MessageCircle),
  alert: display(AlertCircle),
  banner: display(Megaphone),
  progress: display(CircleGauge),
  "progress-bar": display(Loader),
  progressBar: display(Loader),
  spinner: display(Loader2),
  skeleton: display(RectangleEllipsis),
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
  chart: data(ChartPie),
  stat: data(TrendingUp),
  kpi: data(Activity),
  timeline: data(Waypoints),
  calendar: data(CalendarDays),

  symbol: symbol(Puzzle),
  "symbol-instance": symbol(Puzzle),
  symbolInstance: symbol(Puzzle),
  "component-master": symbol(Component),
  componentMaster: symbol(Component),
  toast: display(BellRing),
  notification: display(Inbox),
  "metric-card": data(Gauge),
  "profile-card": display(ContactRound),
  "empty-state": display(CloudOff),
  "code-block": text(CodeXml),
  "segmented-control": form(ListChecks),
  "step-indicator": advanced(ListOrdered),
  "bottom-nav": navigation(Navigation),
  "pricing-card": container(BadgeDollarSign),
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
