import {
  Activity,
  AppWindow,
  AlertCircle,
  AlignJustify,
  AlignLeft,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bell,
  BarChart3,
  Blocks,
  Bookmark,
  CalendarDays,
  Camera,
  Check,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  CircleDot,
  CircleHelp,
  Clock3,
  Cloud,
  Code2,
  CodeXml,
  Component,
  Copy,
  CreditCard,
  Database,
  Download,
  Edit3,
  ExternalLink,
  Eye,
  File,
  FileText,
  Frame,
  GalleryHorizontal,
  Filter,
  Flag,
  Folder,
  GitCommitHorizontal,
  Grid3X3,
  Globe2,
  Heart,
  Home,
  Image,
  Info,
  KeyRound,
  LayoutPanelTop,
  Layers,
  Link,
  List,
  ListOrdered,
  Lock,
  Mail,
  MapPin,
  Menu,
  MessageCircle,
  Minus,
  MoreHorizontal,
  PanelBottom,
  PanelLeft,
  PanelRightOpen,
  PanelTop,
  Package,
  Pause,
  Pencil,
  Phone,
  Play,
  Plus,
  Search,
  Server,
  Settings,
  Share2,
  Shield,
  Smartphone,
  ShoppingBag,
  ShoppingCart,
  SlidersHorizontal,
  Sparkles,
  Star,
  Square,
  Sun,
  Repeat,
  Table,
  TabletSmartphone,
  Tag,
  Terminal,
  ThumbsUp,
  ToggleRight,
  Triangle,
  Trash2,
  TrendingUp,
  Upload,
  User,
  UserRound,
  Users,
  Video,
  Workflow,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { createElement, useSyncExternalStore } from "react";
import { renderToStaticMarkup } from "react-dom/server";

export const CANVAS_ICON_LIBRARY: Record<string, LucideIcon> = {
  Activity,
  AppWindow,
  AlertCircle,
  AlignJustify,
  AlignLeft,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bell,
  Bookmark,
  BarChart3,
  Blocks,
  CalendarDays,
  Camera,
  Check,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  CircleDot,
  CircleHelp,
  Clock3,
  Cloud,
  Code2,
  CodeXml,
  Component,
  Copy,
  CreditCard,
  Database,
  Download,
  Edit3,
  ExternalLink,
  Eye,
  File,
  FileText,
  Frame,
  GalleryHorizontal,
  Filter,
  Flag,
  Folder,
  GitCommitHorizontal,
  Grid3X3,
  Globe2,
  Heart,
  Home,
  Image,
  Info,
  KeyRound,
  LayoutPanelTop,
  Layers,
  Link,
  List,
  ListOrdered,
  Lock,
  Mail,
  MapPin,
  Menu,
  MessageCircle,
  Minus,
  MoreHorizontal,
  PanelBottom,
  PanelLeft,
  PanelRightOpen,
  PanelTop,
  Package,
  Pause,
  Pencil,
  Phone,
  Play,
  Plus,
  Search,
  Server,
  Settings,
  Share2,
  Shield,
  Smartphone,
  ShoppingBag,
  ShoppingCart,
  SlidersHorizontal,
  Sparkles,
  Star,
  Square,
  Sun,
  Repeat,
  Table,
  TabletSmartphone,
  Tag,
  Terminal,
  ThumbsUp,
  ToggleRight,
  Triangle,
  Trash2,
  TrendingUp,
  Upload,
  User,
  UserRound,
  Users,
  Video,
  Workflow,
  Wallet,
  X,
  Zap,
};

export const CANVAS_ICON_NAMES = Object.keys(CANVAS_ICON_LIBRARY);

// The full Lucide set (B76): the common icons above are built in; the rest load on demand.
let fullIconSet: Record<string, LucideIcon> | null = null;
let fullIconSetRequest: Promise<Record<string, LucideIcon>> | null = null;
const iconSetListeners = new Set<() => void>();

/** Loads every Lucide icon once; components re-render when it arrives. */
export function loadFullIconSet(): Promise<Record<string, LucideIcon>> {
  if (fullIconSet) return Promise.resolve(fullIconSet);
  fullIconSetRequest ??= import("./fullIconSet").then(({ icons }) => {
    fullIconSet = icons as Record<string, LucideIcon>;
    iconSetListeners.forEach((listener) => listener());
    return fullIconSet;
  }).catch((error: unknown) => {
    fullIconSetRequest = null;
    console.error("Could not load the full icon set.", error);
    throw error;
  });
  return fullIconSetRequest;
}

export function isFullIconSetLoaded(): boolean {
  return fullIconSet !== null;
}

function subscribeIconSet(listener: () => void): () => void {
  iconSetListeners.add(listener);
  return () => iconSetListeners.delete(listener);
}

/** Re-renders the caller once the full icon set has loaded. */
export function useFullIconSet(): boolean {
  return useSyncExternalStore(subscribeIconSet, isFullIconSetLoaded, isFullIconSetLoaded);
}

/**
 * The icon for a name: built-in, or from the full set. Asking for one that is not loaded yet
 * starts loading the full set and returns undefined for now.
 */
export function getIconComponent(name: string): LucideIcon | undefined {
  const icon = CANVAS_ICON_LIBRARY[name] ?? fullIconSet?.[name];
  if (!icon && name && !fullIconSet) void loadFullIconSet().catch(() => undefined);
  return icon;
}

/** Every icon name available now: the full set once loaded, the common ones before that. */
export function getAvailableIconNames(): string[] {
  return fullIconSet ? Object.keys(fullIconSet) : CANVAS_ICON_NAMES;
}

/** Icon names matching a search, common icons first. */
export function searchIconNames(query: string, limit = 60): string[] {
  const words = query.toLowerCase().split(/[\s-]+/).filter(Boolean);
  const matches = (name: string) => {
    const lower = name.toLowerCase();
    return words.every((word) => lower.includes(word));
  };
  const common = CANVAS_ICON_NAMES.filter(matches);
  const rest = getAvailableIconNames().filter((name) => !(name in CANVAS_ICON_LIBRARY) && matches(name));
  return [...common, ...rest].slice(0, limit);
}

/** An icon as a standalone SVG that follows the text colour (for exports, B77). */
export function iconSvgMarkup(name: string, strokeWidth = 2): string | null {
  const Icon = getIconComponent(name);
  if (!Icon) return null;
  return renderToStaticMarkup(createElement(Icon, {
    width: "100%",
    height: "100%",
    strokeWidth,
    "aria-hidden": "true",
    focusable: "false",
  }));
}

export function renderCanvasIconSvg(
  name: string,
  color: string,
  strokeWidth: number,
): string {
  const Icon = getIconComponent(name) ?? CANVAS_ICON_LIBRARY.Star;
  const svg = renderToStaticMarkup(
    createElement(Icon, {
      width: 24,
      height: 24,
      color,
      stroke: color,
      strokeWidth,
      fill: "none",
    }),
  );
  return svg.replaceAll("currentColor", color);
}
