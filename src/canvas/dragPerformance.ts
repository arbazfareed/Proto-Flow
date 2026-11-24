import type { Widget } from "../project/schema";
import {
  findRepeaterThatCannotTake,
  getWidgetParentIdMap,
  isWidgetContainer,
} from "../project/layers";
import type { CanvasGuide } from "./snapping";

// B44: which container (and which repeater that cannot take it) a moving widget would land in.
// A drag asks this on every mouse move and only updates React when the answer changes.
export function computeDropTargets(
  moving: Widget,
  excludedIds: ReadonlySet<string>,
  widgets: Widget[],
): { container: Widget | undefined; blockedRepeater: Widget | undefined } {
  const none = { container: undefined, blockedRepeater: undefined };
  const candidates = widgets.filter((item) =>
    !excludedIds.has(item.id) && item.id !== moving.id && isWidgetContainer(item),
  );
  if (candidates.length === 0) return none;
  const parentId = getWidgetParentIdMap([
    ...candidates,
    { ...moving, groupId: undefined },
  ]).get(moving.id);
  return {
    container: parentId ? candidates.find((item) => item.id === parentId) : undefined,
    // B17: a repeater needs the whole widget inside it, so a widget hanging over its edge is
    // left outside; say so instead of failing silently.
    blockedRepeater: findRepeaterThatCannotTake(moving, candidates),
  };
}

export function sameGuides(first: CanvasGuide[], second: CanvasGuide[]): boolean {
  return first.length === second.length && JSON.stringify(first) === JSON.stringify(second);
}

// B44: alignment guides change on almost every mouse move while dragging among many widgets. They
// live outside the canvas component's state so that only the guide overlay is drawn again, not
// every widget on the screen.
export interface GuideStore {
  get: () => CanvasGuide[];
  set: (next: CanvasGuide[]) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createGuideStore(): GuideStore {
  let guides: CanvasGuide[] = [];
  const listeners = new Set<() => void>();
  return {
    get: () => guides,
    set: (next) => {
      if (sameGuides(guides, next)) return;
      guides = next;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
