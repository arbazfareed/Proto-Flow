import type { ShapeTool } from "../canvas/shapeTools";

const REQUIRED_ICON_TOOLS: Record<string, readonly ShapeTool[]> = {
  Calendar: ["date-picker"],
  Check: ["checkbox"],
  ChevronDown: ["dropdown-menu"],
  Code2: ["code-block"],
  Compass: ["navbar"],
  FileText: ["form"],
  Image: ["image"],
  Link: ["link"],
  List: ["list"],
  ListOrdered: ["list"],
  Mail: ["input"],
  MousePointer2: ["button"],
  Music: ["video"],
  Search: ["search"],
  Table: ["table"],
  Type: ["text"],
  Video: ["video"],
  Layout: ["container"],
};

export function getImportedElementTools(requiredIcons: readonly string[]): ShapeTool[] {
  const tools = new Set<ShapeTool>();
  for (const icon of requiredIcons) {
    for (const tool of REQUIRED_ICON_TOOLS[icon] ?? []) tools.add(tool);
  }
  return [...tools];
}
