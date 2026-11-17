import type { Project } from "../project/schema";
import { CANVAS_ICON_LIBRARY, iconSvgMarkup, isFullIconSetLoaded, loadFullIconSet } from "../canvas/iconLibrary";

/** Every icon name a project uses, wherever it appears (widgets, panel states, repeaters). */
export function projectIconNames(project: Project): string[] {
  const names = new Set<string>();
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== "object" || value === null) return;
    for (const [key, entry] of Object.entries(value)) {
      if (key === "iconName" && typeof entry === "string" && entry) names.add(entry);
      else visit(entry);
    }
  };
  visit(project.screens);
  return [...names];
}

/** Makes sure every icon the project uses can be drawn (loads the full set if needed). */
export async function ensureProjectIcons(project: Project): Promise<void> {
  const needsFullSet = projectIconNames(project).some((name) => !(name in CANVAS_ICON_LIBRARY));
  if (needsFullSet && !isFullIconSetLoaded()) await loadFullIconSet();
}

/**
 * The real SVG for each icon the project uses, keyed by name (B77), so exported pages draw
 * Camera, Lock, User and the rest instead of text symbols.
 */
export function projectIconSvgs(project: Project): Record<string, string> {
  const svgs: Record<string, string> = {};
  for (const name of projectIconNames(project)) {
    const svg = iconSvgMarkup(name);
    if (svg) svgs[name] = svg;
  }
  return svgs;
}

/** JSON safe to place inside a <script> element. */
export function iconDataScript(project: Project): string {
  const json = JSON.stringify(projectIconSvgs(project))
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026");
  return `<script id="icon-data" type="application/json">${json}</script>`;
}
