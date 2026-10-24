import { CANVAS_ICON_LIBRARY } from "../canvas/iconLibrary";
import type { LucideIcon } from "lucide-react";

export function getPreviewIconComponent(name: string): LucideIcon {
  return CANVAS_ICON_LIBRARY[name] ?? CANVAS_ICON_LIBRARY.Star;
}