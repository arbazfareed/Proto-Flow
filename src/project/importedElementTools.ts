import type { ShapeTool } from "../canvas/shapeTools";

const REQUIRED_ICON_TOOLS: Record<string, readonly ShapeTool[]> = {
  AlignLeft: ["paragraph"],
  AppWindow: ["web-app"],
  Calendar: ["date-picker"],
  Check: ["checkbox"],
  CheckSquare: ["checkbox"],
  ChevronDown: ["dropdown-menu"],
  ChevronDownSquare: ["select"],
  CircleDot: ["radio"],
  Code2: ["code-block"],
  CodeXml: ["code-block"],
  Compass: ["navbar"],
  FileText: ["form"],
  Heading1: ["heading"],
  Heading2: ["heading"],
  Image: ["image"],
  Layout: ["container"],
  Link: ["link"],
  List: ["list"],
  ListOrdered: ["list"],
  Lock: ["input"],
  Mail: ["input"],
  Menu: ["navbar"],
  MousePointer2: ["button"],
  Music: ["audio"],
  PanelBottom: ["footer"],
  PanelLeft: ["sidebar"],
  PanelTop: ["section"],
  Quote: ["paragraph"],
  RectangleHorizontal: ["button"],
  Search: ["search"],
  Square: ["container"],
  SquareStack: ["card"],
  Table: ["table"],
  TextCursorInput: ["input"],
  Type: ["text"],
  Video: ["video"],
};

export function getImportedElementTools(requiredIcons: readonly string[]): ShapeTool[] {
  const tools = new Set<ShapeTool>();
  for (const icon of requiredIcons) {
    for (const tool of REQUIRED_ICON_TOOLS[icon] ?? []) tools.add(tool);
  }
  return [...tools];
}
