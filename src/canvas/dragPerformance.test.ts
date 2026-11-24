import { describe, expect, it, vi } from "vitest";
import type { Widget } from "../project/schema";
import { computeDropTargets, createGuideStore, sameGuides } from "./dragPerformance";
import type { CanvasGuide } from "./snapping";

function widget(id: string, type: string, x: number, y: number, width: number, height: number): Widget {
  return {
    id,
    type,
    x,
    y,
    width,
    height,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    zIndex: 0,
    style: {},
    props: {},
  } as Widget;
}

const guide = (coordinate: number): CanvasGuide => ({ axis: "x", coordinate, distance: 4 } as CanvasGuide);

describe("guide store (B44)", () => {
  it("tells listeners only when the guides really change", () => {
    const store = createGuideStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.set([guide(10)]);
    store.set([guide(10)]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.get()).toEqual([guide(10)]);

    store.set([guide(20)]);
    expect(listener).toHaveBeenCalledTimes(2);

    store.set([]);
    store.set([]);
    expect(listener).toHaveBeenCalledTimes(3);
    expect(store.get()).toEqual([]);
  });

  it("stops telling a listener after it unsubscribes", () => {
    const store = createGuideStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    store.set([guide(5)]);
    expect(listener).not.toHaveBeenCalled();
  });

  it("compares guides by value", () => {
    expect(sameGuides([guide(1)], [guide(1)])).toBe(true);
    expect(sameGuides([guide(1)], [guide(2)])).toBe(false);
    expect(sameGuides([], [guide(1)])).toBe(false);
  });
});

describe("drop targets while dragging (B44, B4, B17)", () => {
  const card = widget("card", "card", 100, 100, 200, 200);
  const other = widget("other", "rectangle", 500, 500, 50, 50);

  it("finds the container whose area holds the centre of the moving widget", () => {
    const moving = widget("moving", "rectangle", 150, 150, 40, 40);
    const targets = computeDropTargets(moving, new Set(["moving"]), [card, other, moving]);
    expect(targets.container?.id).toBe("card");
  });

  it("finds nothing when the centre is outside every container", () => {
    const moving = widget("moving", "rectangle", 400, 20, 40, 40);
    const targets = computeDropTargets(moving, new Set(["moving"]), [card, other, moving]);
    expect(targets.container).toBeUndefined();
    expect(targets.blockedRepeater).toBeUndefined();
  });

  it("does not offer a widget that is moving as a container for itself", () => {
    const moving = { ...card, x: 120, y: 120 };
    const targets = computeDropTargets(moving, new Set(["card"]), [card, other]);
    expect(targets.container).toBeUndefined();
  });

  it("returns nothing at all when the screen has no containers", () => {
    const moving = widget("moving", "rectangle", 10, 10, 20, 20);
    const targets = computeDropTargets(moving, new Set(["moving"]), [other, moving]);
    expect(targets).toEqual({ container: undefined, blockedRepeater: undefined });
  });
});
