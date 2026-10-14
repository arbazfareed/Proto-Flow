import { describe, expect, it } from "vitest";
import type { Widget } from "../project/schema";
import {
  buildLayerHierarchy,
  filterLayerHierarchy,
  flattenLayerHierarchy,
  getContainerBadge,
  isLayerContainer,
} from "./layerTree";

function widget(
  id: string,
  type: string,
  zIndex: number,
  groupId?: string,
): Widget {
  return {
    id,
    type,
    groupId,
    x: 0,
    y: 0,
    width: 100,
    height: 40,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    zIndex,
    style: {},
    props: {},
  };
}

describe("layer hierarchy", () => {
  it("nests container children and semantic groups without flattening descendants", () => {
    const widgets = [
      widget("frame", "frame", 0),
      widget("title", "text", 4, "frame"),
      widget("form", "group", 3, "frame"),
      widget("button", "button", 2, "form"),
      widget("shape", "rectangle", 1),
    ];
    const roots = buildLayerHierarchy(widgets, (item) => item.id);

    expect(roots.map((node) => node.id)).toEqual(["frame", "shape"]);
    expect(roots[0].children.map((node) => node.id)).toEqual(["title", "form"]);
    expect(roots[0].children[1].children.map((node) => node.id)).toEqual(["button"]);
    expect(roots[0].descendantCount).toBe(3);
  });

  it("treats a selected shape with explicit children as an expandable parent", () => {
    const roots = buildLayerHierarchy([
      widget("rectangle-parent", "rectangle", 3),
      widget("text-child", "text", 2, "rectangle-parent"),
      widget("image-grandchild", "image", 1, "text-child"),
    ], (item) => item.id);

    expect(roots).toHaveLength(1);
    expect(roots[0].id).toBe("rectangle-parent");
    expect(roots[0].children[0].id).toBe("text-child");
    expect(roots[0].children[0].children[0].id).toBe("image-grandchild");
    expect(flattenLayerHierarchy(roots, new Set(["container:rectangle-parent"])))
      .toHaveLength(1);
    expect(flattenLayerHierarchy(roots, new Set()).map(({ node }) => node.id))
      .toEqual(["rectangle-parent", "text-child", "image-grandchild"]);
  });

  it("updates parentage from containment and keeps outside widgets at the screen root", () => {
    const parent = { ...widget("panel", "panel", 3), x: 20, y: 20, width: 200, height: 120 };
    const progress = { ...widget("progress", "progress-bar", 2), x: 40, y: 40 };
    const label = { ...widget("label", "text", 1), x: 60, y: 50 };
    const roots = buildLayerHierarchy([parent, progress, label], (item) => item.id);

    expect(roots.map((node) => node.id)).toEqual(["panel"]);
    expect(roots[0].children.map((node) => node.id)).toEqual(["progress", "label"]);

    const movedProgress = { ...progress, x: 400 };
    const movedRoots = buildLayerHierarchy([parent, movedProgress, label], (item) => item.id);
    expect(movedRoots.map((node) => node.id)).toEqual(["panel", "progress"]);
    expect(movedRoots[0].children.map((node) => node.id)).toEqual(["label"]);
  });

  it("nests a widget under its nearest containing container", () => {
    const outer = { ...widget("outer", "frame", 1), x: 0, y: 0, width: 500, height: 500 };
    const inner = { ...widget("inner", "card", 2), x: 100, y: 100, width: 200, height: 200 };
    const child = { ...widget("child", "text", 3), x: 120, y: 120, width: 50, height: 20 };
    const roots = buildLayerHierarchy([outer, inner, child], (item) => item.id);

    expect(roots).toHaveLength(1);
    expect(roots[0].id).toBe("outer");
    expect(roots[0].children[0].id).toBe("inner");
    expect(roots[0].children[0].children[0].id).toBe("child");
  });

  it("represents Ctrl+G groups as expandable virtual containers", () => {
    const roots = buildLayerHierarchy(
      [widget("one", "text", 5, "semantic-id"), widget("two", "image", 4, "semantic-id")],
      (item) => item.id,
    );

    expect(roots).toHaveLength(1);
    expect(roots[0]).toMatchObject({ kind: "group", groupId: "semantic-id", descendantCount: 2 });
    expect(roots[0].children.map((node) => node.id)).toEqual(["one", "two"]);
  });

  it("flattens nested nodes with depth, branch metadata, and persisted collapse keys", () => {
    const roots = buildLayerHierarchy([
      widget("frame", "frame", 5),
      widget("first", "text", 4, "frame"),
      widget("second", "text", 3, "frame"),
      widget("last", "text", 2),
    ], (item) => item.id);
    const entries = flattenLayerHierarchy(roots, new Set());

    expect(entries.map(({ node, depth, isLastChild }) => [node.id, depth, isLastChild]))
      .toEqual([
        ["frame", 0, false],
        ["first", 1, false],
        ["second", 1, true],
        ["last", 0, true],
      ]);
    expect(entries[1].ancestorContinues).toEqual([true]);
    expect(entries.map(({ position, siblingCount }) => [position, siblingCount]))
      .toEqual([[1, 2], [1, 2], [2, 2], [2, 2]]);
    expect(flattenLayerHierarchy(roots, new Set(["container:frame"])).map(({ node }) => node.id))
      .toEqual(["frame", "last"]);
  });

  it("keeps container brackets open through descendants and closes them at the last child", () => {
    const roots = buildLayerHierarchy([
      widget("frame", "frame", 3),
      widget("first", "text", 2, "frame"),
      widget("nested-frame", "frame", 1, "frame"),
      widget("grandchild", "text", 0, "nested-frame"),
    ], (item) => item.id);
    const entries = flattenLayerHierarchy(roots, new Set());

    expect(entries.map(({ node, ancestorContinues }) => [node.id, ancestorContinues]))
      .toEqual([
        ["frame", []],
        ["first", [true]],
        ["nested-frame", [true]],
        ["grandchild", [false, false]],
      ]);
  });

  it("retains matching descendants and only the ancestors needed to show their hierarchy", () => {
    const roots = buildLayerHierarchy([
      widget("frame", "frame", 5),
      widget("button", "button", 4, "frame"),
      widget("unmatched", "text", 3),
    ], (item) => item.id);
    const filtered = filterLayerHierarchy(
      roots,
      (node) => node.widget?.type === "button",
    );

    expect(filtered.map((node) => node.id)).toEqual(["frame"]);
    expect(filtered[0].children.map((node) => node.id)).toEqual(["button"]);
  });

  it("handles cyclic or orphaned parent references without recursing forever", () => {
    const roots = buildLayerHierarchy([
      widget("first", "frame", 2, "second"),
      widget("second", "frame", 1, "first"),
      widget("orphan", "text", 0, "missing-container"),
    ], (item) => item.id);

    expect(flattenLayerHierarchy(roots, new Set())
      .flatMap(({ node }) => node.widget ? [node.widget.id] : [])
      .sort())
      .toEqual(["first", "orphan", "second"]);
  });

  it("flattens large expanded trees so the sidebar can virtualize their rows", () => {
    const widgets = Array.from({ length: 500 }, (_, index) =>
      widget(`widget-${index}`, "text", 500 - index),
    );
    const entries = flattenLayerHierarchy(buildLayerHierarchy(widgets, (item) => item.id), new Set());

    expect(entries).toHaveLength(500);
    expect(entries[0].node.id).toBe("widget-0");
  });

  it("identifies container types and renders useful state and row count badges", () => {
    const frame = widget("frame", "frame", 0);
    const repeater = { ...widget("repeater", "repeater", 0), props: { rows: 3 } };
    const panel = { ...widget("panel", "panel", 0), props: { states: ["default", "open"] } };

    expect(isLayerContainer(frame)).toBe(true);
    expect(isLayerContainer(widget("card", "card", 0))).toBe(true);
    expect(isLayerContainer(widget("modal", "modal", 0))).toBe(true);
    expect(isLayerContainer(widget("overlay", "overlay", 0))).toBe(true);
    expect(isLayerContainer(widget("drawer", "drawer", 0))).toBe(true);
    expect(isLayerContainer(widget("section", "section", 0))).toBe(true);
    expect(isLayerContainer(widget("accordion", "accordion", 0))).toBe(true);
    expect(isLayerContainer(widget("carousel", "carousel", 0))).toBe(true);
    expect(isLayerContainer(widget("tabs", "tabs", 0))).toBe(true);
    expect(isLayerContainer(widget("menu", "menu", 0))).toBe(true);
    expect(isLayerContainer(widget("footer", "footer", 0))).toBe(true);
    expect(isLayerContainer(widget("form", "form", 0))).toBe(true);
    expect(isLayerContainer(widget("master", "component-master", 0))).toBe(true);
    expect(isLayerContainer(widget("button", "button", 0))).toBe(false);
    expect(getContainerBadge(frame, 0)).toBe("empty");
    expect(getContainerBadge(frame, 1)).toBe("1 child");
    expect(getContainerBadge(repeater, 0)).toBe("3 rows");
    expect(getContainerBadge(panel, 0)).toBe("2 states");
  });
});
