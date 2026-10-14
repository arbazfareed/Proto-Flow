import { useRef } from "react";
import {
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Folder,
  Layers,
  LayoutGrid,
  Puzzle,
  Square,
} from "lucide-react";
import type { LayerCategoryDefinition } from "./layerGrouping";
import type { DragEvent, KeyboardEvent, MouseEvent } from "react";

const CATEGORY_ICONS = {
  square: Square,
  "layout-grid": LayoutGrid,
  layers: Layers,
  puzzle: Puzzle,
  folder: Folder,
  help: CircleHelp,
} as const;

export function CategoryIcon({
  category,
  size = 16,
}: {
  category: LayerCategoryDefinition;
  size?: number;
}) {
  const Icon = CATEGORY_ICONS[category.icon];
  return (
    <span
      className="layer-category-icon"
      style={{ backgroundColor: category.background, color: category.badge }}
      aria-hidden="true"
    >
      <Icon size={size} />
    </span>
  );
}

export function CategoryHeader({
  category,
  groupId,
  entryIndex,
  label,
  count,
  collapsed,
  onToggle,
  onMenu,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onKeyDown,
  dropEdge,
  isDropTarget,
  onRename,
  onRenameCommit,
}: {
  category: LayerCategoryDefinition;
  groupId: string;
  entryIndex?: number;
  label: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  onMenu: (event: MouseEvent<HTMLButtonElement>) => void;
  onDragStart: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  dropEdge?: "before" | "after";
  isDropTarget?: boolean;
  onRename?: (value: string) => void;
  onRenameCommit?: (value: string) => void;
}) {
  const cancelRenameRef = useRef(false);
  return (
    <div
      className={`layer-category-header${isDropTarget ? " is-drop-target" : ""}`}
      style={{ backgroundColor: `${category.badge}18` }}
      data-drop-edge={dropEdge}
      data-entry-index={entryIndex}
      id={`layer-category-${groupId}`}
      role="presentation"
      tabIndex={-1}
      data-group-id={groupId}
      draggable={!onRename}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onKeyDown={onKeyDown}
    >
      <button
        className="layer-category-toggle"
        aria-label={`${collapsed ? "Expand" : "Collapse"} ${label}, ${count} ${count === 1 ? "layer" : "layers"}`}
        aria-expanded={!collapsed}
        onClick={onToggle}
      >
        {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        <CategoryIcon category={category} />
        {!onRename && (
          <span className="layer-category-label">{label}</span>
        )}
        {!onRename && (
          <span className="layer-category-count" style={{ backgroundColor: category.badge }}>
            {count}
          </span>
        )}
      </button>
      {onRename && (
        <>
          <input
            className="layer-category-rename"
            aria-label={`Rename ${label}`}
            autoFocus
            value={label}
            onChange={(event) => onRename(event.target.value)}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onRenameCommit?.(event.currentTarget.value);
                event.currentTarget.blur();
              } else if (event.key === "Escape") {
                event.preventDefault();
                cancelRenameRef.current = true;
                event.currentTarget.blur();
              }
              event.stopPropagation();
            }}
            onBlur={(event) => {
              if (cancelRenameRef.current) {
                cancelRenameRef.current = false;
                onRenameCommit?.("");
                return;
              }
              onRenameCommit?.(event.currentTarget.value);
            }}
          />
          <span className="layer-category-count" style={{ backgroundColor: category.badge }}>
            {count}
          </span>
        </>
      )}
      <button
        className="layer-category-menu-button"
        aria-label={`Group options for ${label}`}
        aria-haspopup="menu"
        onClick={onMenu}
      >
        <span aria-hidden="true">⋯</span>
      </button>
    </div>
  );
}
