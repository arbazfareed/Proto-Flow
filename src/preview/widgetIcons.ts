import { CANVAS_ICON_LIBRARY, getIconComponent } from "../canvas/iconLibrary";
import type { LucideIcon } from "lucide-react";

export function getPreviewIconComponent(name: string): LucideIcon {
  return getIconComponent(name) ?? CANVAS_ICON_LIBRARY.Star;
}
