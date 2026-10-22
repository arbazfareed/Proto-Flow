import { describe, expect, it } from "vitest";
import type { Widget } from "../project/schema";
import {
  getSelectedContainingParentId,
  syncWidgetGroupIdsToContainment,
} from "../project/layers";
import {
  buildLayerHierarchy,
  filterLayerHierarchy,
  flattenLayerHierarchy,
  getContainerBadge,
  getLayerTreeCollapseStateAtDepth,
  getLayerTreeMaxDepth,
  isLayerContainer,
} from "./layerTree";
import { getLayerAccentColor } from "./layerGrouping";

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
  it("nests children of an Ellipse under it instead of its enclosing Rectangle", () => {
    const rectangle = {
      ...widget("rectangle", "rectangle", 0),
      x: 10,
      y: 10,
      width: 500,
      height: 300,
    };
    const ellipse = {
      ...widget("ellipse", "ellipse", 1, rectangle.id),
      x: 50,
      y: 40,
      width: 140,
      height: 60,
    };
    const iconInsideEllipse = {
      ...widget("icon-inside-ellipse", "icon", 2, rectangle.id),
      x: 100,
      y: 55,
      width: 20,
      height: 20,
    };
    const iconOutsideEllipse = {
      ...widget("icon-outside-ellipse", "icon", 3),
      x: 100,
      y: 150,
      width: 20,
      height: 20,
    };
    const widgets = syncWidgetGroupIdsToContainment([
      rectangle,
      ellipse,
      iconInsideEllipse,
      iconOutsideEllipse,
    ]);
    const roots = buildLayerHierarchy(widgets, (item) => item.id);

    expect(widgets.find((item) => item.id === iconInsideEllipse.id)?.groupId)
      .toBe(ellipse.id);
    expect(roots).toHaveLength(1);
    expect(roots[0].children.map((node) => node.id)).toEqual([
      ellipse.id,
      iconOutsideEllipse.id,
    ]);
    expect(roots[0].children[0].children.map((node) => node.id))
      .toEqual([iconInsideEllipse.id]);
    expect(getContainerBadge(roots[0].widget!, roots[0].children.length))
      .toBe("2 children");
    expect(getContainerBadge(
      roots[0].children[0].widget!,
      roots[0].children[0].children.length,
    )).toBe("1 child");
    expect(flattenLayerHierarchy(roots, new Set()).map(({ node, depth }) => [
      node.id,
      depth,
    ])).toEqual([
      [rectangle.id, 0],
      [ellipse.id, 1],
      [iconInsideEllipse.id, 2],
      [iconOutsideEllipse.id, 1],
    ]);
  });

  it("uses semantic category accents for layer rows", () => {
    expect(getLayerAccentColor(widget("screen-shape", "star", 0))).toBe("#94A3B8");
    expect(getLayerAccentColor(widget("container", "rectangle", 0))).toBe("#F59E0B");
    expect(getLayerAccentColor(widget("frame", "frame", 0))).toBe("#F59E0B");
    expect(getLayerAccentColor(widget("button", "button", 0))).toBe("#3B82F6");
    expect(getLayerAccentColor(widget("panel", "panel", 0))).toBe("#F97316");
    expect(getLayerAccentColor(widget("symbol", "symbol-instance", 0))).toBe("#8B5CF6");
  });

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

  it("nests dynamic-panel widgets beneath their named state nodes", () => {
    const first = widget("first", "text", 1, "panel");
    const second = widget("second", "button", 2, "panel");
    const panel = {
      ...widget("panel", "dynamic-panel", 0),
      props: {
        activeStateId: "state-one",
        states: [
          { id: "state-one", name: "One", widgets: [first] },
          { id: "state-two", name: "Two", widgets: [second] },
        ],
      },
    };
    const roots = buildLayerHierarchy([panel, first, second], (item) => item.id);
    const rows = flattenLayerHierarchy(roots, new Set());

    expect(rows.map(({ node }) => [node.kind, node.label])).toEqual([
      ["widget", "panel"],
      ["state", "One"],
      ["widget", "first"],
      ["state", "Two"],
      ["widget", "second"],
    ]);
  });

  it("expands a tree to a selected depth while keeping deeper containers collapsed", () => {
    const roots = buildLayerHierarchy([
      widget("frame", "frame", 0),
      widget("rectangle", "rectangle", 1, "frame"),
      widget("star", "star", 2, "rectangle"),
    ], (item) => item.id);
    const frame = roots[0];

    expect(getLayerTreeMaxDepth(frame)).toBe(2);
    expect(getLayerTreeCollapseStateAtDepth(frame, 2)).toEqual({
      expandedKeys: ["container:frame", "container:rectangle"],
      collapsedKeys: [],
    });
    expect(getLayerTreeCollapseStateAtDepth(frame, 1)).toEqual({
      expandedKeys: ["container:frame"],
      collapsedKeys: ["container:rectangle"],
    });
    expect(flattenLayerHierarchy(roots, new Set(["container:rectangle"]))
      .map(({ node, depth }) => [node.id, depth]))
      .toEqual([
        ["frame", 0],
        ["rectangle", 1],
      ]);
  });

  it("does not mark empty containers as collapsed", () => {
    const roots = buildLayerHierarchy([widget("empty-frame", "frame", 0)], (item) => item.id);

    expect(getLayerTreeCollapseStateAtDepth(roots[0], 1)).toEqual({
      expandedKeys: [],
      collapsedKeys: [],
    });
    expect(flattenLayerHierarchy(roots, new Set(["container:empty-frame"]))[0].collapsed)
      .toBe(false);
  });

  it("shows every direct child of a nested rectangle with matching count and depth", () => {
    const roots = buildLayerHierarchy([
      { ...widget("screen-parent", "frame", 0), x: 0, y: 0, width: 600, height: 500 },
      { ...widget("rectangle-parent", "rectangle", 1, "screen-parent"), x: 20, y: 20, width: 300, height: 240 },
      { ...widget("nested-rectangle", "rectangle", 2, "rectangle-parent"), x: 40, y: 40, width: 100, height: 80 },
      { ...widget("star", "star", 3, "rectangle-parent"), x: 180, y: 40, width: 40, height: 40 },
      { ...widget("screen-text", "text", 4, "screen-parent"), x: 20, y: 300, width: 80, height: 24 },
    ], (item) => item.id);
    const entries = flattenLayerHierarchy(roots, new Set());
    const rectangle = roots[0].children[0];

    expect(rectangle.children.map((node) => node.id)).toEqual([
      "nested-rectangle",
      "star",
    ]);
    expect(getContainerBadge(rectangle.widget!, rectangle.children.length))
      .toBe("2 children");
    expect(entries.map(({ node, depth }) => [node.id, depth])).toEqual([
      ["screen-parent", 0],
      ["rectangle-parent", 1],
      ["nested-rectangle", 2],
      ["star", 2],
      ["screen-text", 1],
    ]);
  });

  it("lists clicked Text inside a selected Rectangle as its expandable child", () => {
    const rectangle = {
      ...widget("rectangle", "rectangle", 0),
      x: 100,
      y: 80,
      width: 240,
      height: 160,
    };
    const text = {
      ...widget("text", "text", 1),
      x: 120,
      y: 100,
      width: 64,
      height: 32,
    };
    const selectedParentId = getSelectedContainingParentId(
      [rectangle],
      ["rectangle"],
      text,
    );
    const persistedWidgets = syncWidgetGroupIdsToContainment([
      rectangle,
      { ...text, groupId: selectedParentId },
    ]);
    const roots = buildLayerHierarchy(persistedWidgets, (item) => item.id);
    const entries = flattenLayerHierarchy(roots, new Set());

    expect(persistedWidgets[1].groupId).toBe("rectangle");
    expect(roots).toHaveLength(1);
    expect(roots[0].children.map((node) => node.id)).toEqual(["text"]);
    expect(getContainerBadge(roots[0].widget!, roots[0].children.length))
      .toBe("1 child");
    expect(entries.map(({ node, depth }) => [node.id, depth])).toEqual([
      ["rectangle", 0],
      ["text", 1],
    ]);
  });

  it("infers visual children under Rectangle, Card, and Modal containers", () => {
    const widgets = [
      { ...widget("modal", "modal", 0), x: 10, y: 10, width: 120, height: 100 },
      { ...widget("icon", "icon", 1), x: 20, y: 20, width: 20, height: 20 },
      { ...widget("card", "card", 2), x: 160, y: 10, width: 140, height: 100 },
      { ...widget("card-text-a", "text", 3), x: 170, y: 20, width: 50, height: 20 },
      { ...widget("card-text-b", "text", 4), x: 170, y: 50, width: 50, height: 20 },
      { ...widget("blue-box", "rectangle", 5), x: 330, y: 10, width: 160, height: 100 },
      { ...widget("video", "video", 6), x: 340, y: 20, width: 60, height: 40 },
      { ...widget("link", "link", 7), x: 340, y: 70, width: 60, height: 20 },
    ];
    const roots = buildLayerHierarchy(widgets, (item) => item.id);
    const entries = flattenLayerHierarchy(roots, new Set());

    expect(roots.map((node) => [node.id, node.children.map((child) => child.id)]))
      .toEqual([
        ["modal", ["icon"]],
        ["card", ["card-text-a", "card-text-b"]],
        ["blue-box", ["video", "link"]],
      ]);
    expect(entries.map(({ node, depth }) => [node.id, depth])).toEqual([
      ["modal", 0],
      ["icon", 1],
      ["card", 0],
      ["card-text-a", 1],
      ["card-text-b", 1],
      ["blue-box", 0],
      ["video", 1],
      ["link", 1],
    ]);
    expect(entries.find(({ node }) => node.id === "icon")?.ancestorAccents)
      .toEqual(["#EAB308"]);
    expect(entries.find(({ node }) => node.id === "video")?.ancestorAccents)
      .toEqual(["#6366F1"]);

    const movedRoots = buildLayerHierarchy(
      widgets.map((item) =>
        item.id === "blue-box" ? { ...item, x: 600 } : item,
      ),
      (item) => item.id,
    );
    expect(movedRoots.find((node) => node.id === "blue-box")?.children).toHaveLength(0);
    expect(movedRoots.map((node) => node.id)).toContain("video");
    expect(movedRoots.map((node) => node.id)).toContain("link");
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

  it("shows a contained Timeline below its Calendar parent", () => {
    const calendar = {
      ...widget("calendar", "calendar", 3),
      x: 90,
      y: 70,
      width: 623,
      height: 191,
    };
    const timeline = {
      ...widget("timeline", "timeline", 4),
      x: 255,
      y: 140,
      width: 464,
      height: 74,
    };
    const roots = buildLayerHierarchy([calendar, timeline], (item) => item.id);
    const entries = flattenLayerHierarchy(roots, new Set());

    expect(roots.map((node) => node.id)).toEqual(["calendar"]);
    expect(entries.map(({ node }) => node.id)).toEqual(["calendar", "timeline"]);
    expect(entries[1]).toMatchObject({ depth: 1 });
  });

  it("keeps a child nested when it overhangs a container edge by only a few pixels", () => {
    const calendar = {
      ...widget("calendar", "calendar", 3),
      x: 90,
      y: 70,
      width: 622.85,
      height: 190.02,
    };
    const timeline = {
      ...widget("timeline", "timeline", 4),
      x: 254.99,
      y: 140,
      width: 464.49,
      height: 73.9,
    };
    const roots = buildLayerHierarchy([calendar, timeline], (item) => item.id);

    expect(roots.map((node) => node.id)).toEqual(["calendar"]);
    expect(roots[0].children.map((node) => node.id)).toEqual(["timeline"]);
  });

  it("orders siblings by top-to-bottom, then left-to-right position", () => {
    const firstState = buildLayerHierarchy([
      { ...widget("lower-left", "calendar", 10), x: 0, y: 100 },
      { ...widget("upper-right", "timeline", 1), x: 100, y: 0 },
      { ...widget("upper-left", "rectangle", 0), x: 0, y: 0 },
    ], (item) => item.id);

    expect(firstState.map((node) => node.id)).toEqual([
      "upper-left",
      "upper-right",
      "lower-left",
    ]);
  });

  it("uses z-order only to break ties at the same screen position", () => {
    const roots = buildLayerHierarchy([
      { ...widget("back", "rectangle", 0), x: 20, y: 20 },
      { ...widget("front", "ellipse", 1), x: 20, y: 20 },
    ], (item) => item.id);

    expect(roots.map((node) => node.id)).toEqual(["front", "back"]);
  });

  it("matches the requested screen-root hierarchy and visual order", () => {
    const roots = buildLayerHierarchy([
      { ...widget("root-rectangle", "rectangle", 1), x: 20, y: 20, width: 240, height: 140 },
      { ...widget("nested-text", "text", 4, "root-rectangle"), x: 40, y: 40, width: 80, height: 24 },
      { ...widget("screen-rectangle", "rectangle", 3), x: 20, y: 190 },
      { ...widget("screen-text", "text", 2), x: 20, y: 250 },
    ], (item) => item.id);

    expect(roots.map((node) => node.id)).toEqual([
      "root-rectangle",
      "screen-rectangle",
      "screen-text",
    ]);
    expect(roots[0].children.map((node) => node.id)).toEqual(["nested-text"]);
  });

  it("keeps an explicitly nested child below its parent while ordering siblings by canvas stack", () => {
    const calendar = { ...widget("calendar", "calendar", 1), x: 0, y: 0, width: 300, height: 200 };
    const timeline = {
      ...widget("timeline", "timeline", 2, "calendar"),
      x: 10,
      y: 10,
      width: 100,
      height: 40,
    };
    const roots = buildLayerHierarchy([calendar, timeline], (item) => item.id);
    const entries = flattenLayerHierarchy(roots, new Set());

    expect(entries.map(({ node }) => node.id)).toEqual(["calendar", "timeline"]);
    expect(entries[0].node.children.map((node) => node.id)).toEqual(["timeline"]);
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
