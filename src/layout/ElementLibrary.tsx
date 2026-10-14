import { useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  CircleSlash,
  Eye,
  EyeOff,
  Lock,
  Search,
  Sparkles,
  Unlock,
  X,
} from "lucide-react";
import type { DeviceCategory } from "../devices/types";
import {
  ELEMENT_LIBRARY_TOOL_TYPES,
  getShapeToolDefinition,
  type ShapeTool,
} from "../canvas/shapeTools";
import { ELEMENT_DRAG_MIME } from "../canvas/elementDrag";
import {
  getScreenIconDefinition,
  getWidgetIconDefinition,
  WidgetIcon,
} from "./widgetIcons";

const TOOL_GROUPS = [
  { id: "container", label: "Containers" },
  { id: "advanced", label: "Advanced" },
  { id: "shape", label: "Shapes" },
  { id: "text", label: "Text" },
  { id: "form", label: "Forms" },
  { id: "display", label: "Display" },
  { id: "navigation", label: "Navigation" },
  { id: "data", label: "Data" },
  { id: "symbol", label: "Symbols" },
] as const;

const SCREEN_TOOLS: { category: DeviceCategory; label: string }[] = [
  { category: "desktop", label: "Desktop screen" },
  { category: "laptop", label: "Laptop screen" },
  { category: "tablet", label: "Tablet screen" },
  { category: "phone", label: "Mobile screen" },
  { category: "watch", label: "Watch screen" },
];

const STATUS_INDICATORS = [
  { label: "Visible", icon: Eye, color: "#9ca3af" },
  { label: "Hidden", icon: EyeOff, color: "#9ca3af" },
  { label: "Locked", icon: Lock, color: "#9ca3af" },
  { label: "Unlocked", icon: Unlock, color: "#9ca3af" },
  { label: "Overflow", icon: AlertTriangle, color: "#ef4444" },
  { label: "Empty container", icon: CircleSlash, color: "#9ca3af" },
  { label: "Just created", icon: Sparkles, color: "#10b981" },
] as const;

function getToolGroup(type: ShapeTool): string {
  if (
    type === "image" ||
    ["avatar", "video", "badge", "chip", "tooltip", "popover", "alert", "banner", "progress-bar", "spinner", "skeleton", "rating"].includes(type)
  ) {
    return "display";
  }
  if (
    ["button", "input", "icon-button", "checkbox", "radio", "toggle", "textarea", "select", "slider", "stepper", "date-picker", "file-upload", "search", "form"].includes(type)
  ) {
    return "form";
  }
  return getWidgetIconDefinition(type).category;
}

export interface ElementLibraryProps {
  activeTool: ShapeTool | null;
  mode?: "popover" | "sidebar";
  anchorRef?: RefObject<HTMLDivElement | null>;
  onSelectTool?: (tool: ShapeTool) => void;
  onAddScreen: (category: DeviceCategory) => void;
  onClose?: () => void;
}

interface ElementLibrarySectionProps {
  activeTool: ShapeTool | null;
  mode: "popover" | "sidebar";
  anchorRef?: RefObject<HTMLDivElement | null>;
  onSelectTool: (tool: ShapeTool) => void;
  onAddScreen: (category: DeviceCategory) => void;
  onClose: () => void;
}

function ElementLibraryContents({
  activeTool,
  mode,
  anchorRef,
  onSelectTool,
  onAddScreen,
  onClose,
}: ElementLibrarySectionProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const suppressClickAfterDragRef = useRef(false);
  const [query, setQuery] = useState("");
  const matchingToolTypes = ELEMENT_LIBRARY_TOOL_TYPES.filter((tool) =>
    `${tool} ${getShapeToolDefinition(tool)?.label ?? tool}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const [placement, setPlacement] = useState({ left: 12, top: 80, width: 760 });
  const groupedTools = new Map<string, ShapeTool[]>();
  for (const tool of matchingToolTypes) {
    const group = getToolGroup(tool);
    groupedTools.set(group, [...(groupedTools.get(group) ?? []), tool]);
  }

  useLayoutEffect(() => {
    if (mode === "sidebar") return;
    const placePopover = () => {
      const anchor = anchorRef?.current;
      const popover = popoverRef.current;
      if (!anchor || !popover) return;
      const anchorRect = anchor.getBoundingClientRect();
      const width = Math.min(760, Math.max(0, window.innerWidth - 24));
      const left = Math.max(
        12,
        Math.min(anchorRect.right - width, window.innerWidth - width - 12),
      );
      const maxHeight = Math.min(window.innerHeight * 0.76, 720);
      const naturalTop = anchorRect.bottom + 8;
      const top =
        naturalTop + Math.min(popover.scrollHeight, maxHeight) <= window.innerHeight - 12
          ? naturalTop
          : Math.max(
              12,
              anchorRect.top - Math.min(popover.scrollHeight, maxHeight) - 8,
            );
      setPlacement({ left, top, width });
    };

    placePopover();
    window.addEventListener("resize", placePopover);
    return () => window.removeEventListener("resize", placePopover);
  }, [anchorRef, mode]);

  const contents = (
    <div
      ref={popoverRef}
      className={`element-library-content${mode === "popover" ? " element-library-popover" : " element-library-sidebar"}`}
      role={mode === "popover" ? "dialog" : undefined}
      aria-label={mode === "popover" ? "Element library" : undefined}
      style={mode === "popover" ? placement : undefined}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <div className="element-library-header">
        <div>
          <strong>{mode === "sidebar" ? "ELEMENTS" : "Element library"}</strong>
          <span>
            {mode === "sidebar"
              ? "Drag an element onto the canvas or select it to draw. To nest it, place it fully inside a container."
              : "Drag an element onto the canvas to place it, or click it then drag to draw."}
          </span>
        </div>
        {mode === "popover" && (
          <button
            className="icon-button small-icon"
            type="button"
            aria-label="Close element library"
            onClick={onClose}
          >
            <X size={15} />
          </button>
        )}
      </div>

      <label className="element-library-search">
        <Search size={14} aria-hidden="true" />
        <input
          ref={searchRef}
          type="search"
          value={query}
          aria-label="Search elements"
          placeholder="Search elements"
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        {query && (
          <button type="button" aria-label="Clear element search" onClick={() => setQuery("")}>
            <X size={12} />
          </button>
        )}
      </label>

      <section className="element-library-section" aria-label="Screens">
        <h3>Screens</h3>
        <div className="element-library-grid">
          {SCREEN_TOOLS.map(({ category, label }) => {
            const { icon: ScreenDeviceIcon, color } = getScreenIconDefinition(category);
            return (
              <button
                className="element-library-item"
                key={category}
                type="button"
                title={`Create ${label.toLowerCase()}`}
                aria-label={`Create ${label}`}
                onClick={() => onAddScreen(category)}
              >
                <ScreenDeviceIcon size={16} style={{ color }} aria-hidden="true" />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </section>

      {TOOL_GROUPS.map(({ id, label }) => {
        const tools = groupedTools.get(id);
        if (!tools?.length) return null;
        return (
          <section className="element-library-section" key={id} aria-label={label}>
            <h3>
              {label}
              <span>{tools.length}</span>
            </h3>
            <div className="element-library-grid">
              {tools.map((tool) => {
                const definition = getShapeToolDefinition(tool);
                if (!definition) return null;
                return (
                  <button
                    className={`element-library-item${activeTool === tool ? " is-active" : ""}`}
                    key={tool}
                    type="button"
                    draggable
                    title={`${definition.label} — drag onto the canvas or click, then drag to draw`}
                    aria-label={`Add ${definition.label}`}
                    aria-pressed={activeTool === tool}
                    onDragStart={(event) => {
                      suppressClickAfterDragRef.current = true;
                      event.dataTransfer.effectAllowed = "copy";
                      event.dataTransfer.setData(ELEMENT_DRAG_MIME, tool);
                      event.dataTransfer.setData("text/plain", definition.label);
                    }}
                    onDragEnd={() => {
                      window.setTimeout(() => {
                        suppressClickAfterDragRef.current = false;
                      }, 0);
                    }}
                    onClick={(event) => {
                      if (suppressClickAfterDragRef.current) {
                        suppressClickAfterDragRef.current = false;
                        event.preventDefault();
                        return;
                      }
                      onSelectTool(tool);
                      if (mode === "popover") onClose();
                    }}
                  >
                    <WidgetIcon type={tool} size={16} />
                    <span>{definition.label}</span>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}

      <section className="element-library-section element-library-status" aria-label="Status indicators">
        <h3>Status indicators</h3>
        <div className="element-library-status-list">
          {STATUS_INDICATORS.map(({ label, icon: StatusIcon, color }) => (
            <span className="element-library-status-item" key={label}>
              <StatusIcon size={14} style={{ color }} aria-hidden="true" />
              {label}
            </span>
          ))}
        </div>
      </section>
    </div>
  );

  return mode === "popover" ? createPortal(contents, document.body) : contents;
}

export function ElementLibrary({
  activeTool,
  mode = "popover",
  anchorRef,
  onSelectTool,
  onAddScreen,
  onClose,
}: ElementLibraryProps) {
  return (
    <ElementLibraryContents
      activeTool={activeTool}
      mode={mode}
      anchorRef={anchorRef}
      onSelectTool={onSelectTool ?? (() => undefined)}
      onAddScreen={onAddScreen}
      onClose={onClose ?? (() => undefined)}
    />
  );
}
