import { describe, expect, it } from "vitest";
import { createEmptyProject, parseProject } from "./schema";
import {
  containerAdoptsWidget,
  getSelectedContainingParentId,
  getWidgetParentIdMap,
  isWidgetCentreInside,
  isWidgetContainedBy,
  isWidgetContainer,
  reorderScreens,
  reorderWidgets,
  syncWidgetGroupIdsToContainment,
} from "./layers";

function widget(id: string, zIndex: number) {
  return {
    id,
    type: "rectangle",
    groupId: undefined,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    zIndex,
    style: {},
    props: {},
  };
}

describe("layer and screen ordering", () => {
  it("recognizes Calendar as a layout container", () => {
    expect(isWidgetContainer({ type: "calendar" })).toBe(true);
  });

  it("treats plain shapes as artwork, not containers (B74)", () => {
    expect(isWidgetContainer({ type: "rectangle" })).toBe(false);
    expect(isWidgetContainer({ type: "ellipse" })).toBe(false);
    expect(isWidgetContainer({ type: "container" })).toBe(true);
  });

  it("does not adopt widgets drawn on top of a rectangle, but keeps explicit links (B74)", () => {
    const rectangle = { ...widget("rectangle", 0), x: 10, y: 10, width: 100, height: 80 };
    const text = { ...widget("text", 1), type: "text", x: 20, y: 20, width: 30, height: 20 };
    expect(syncWidgetGroupIdsToContainment([rectangle, text])[1].groupId).toBeUndefined();
    const linked = { ...text, groupId: "rectangle" };
    expect(syncWidgetGroupIdsToContainment([rectangle, linked])[1].groupId).toBe("rectangle");
  });

  it("syncs persisted group IDs when widgets move into or out of a container", () => {
    const rectangle = { ...widget("rectangle", 0), type: "container", x: 10, y: 10, width: 100, height: 80 };
    const text = { ...widget("text", 1), type: "text", x: 20, y: 20, width: 30, height: 20 };
    const inside = syncWidgetGroupIdsToContainment([rectangle, text]);
    expect(inside.find((item) => item.id === "text")?.groupId).toBe("rectangle");

    const movedOutside = syncWidgetGroupIdsToContainment([
      rectangle,
      { ...inside[1], x: 200 },
    ]);
    expect(movedOutside.find((item) => item.id === "text")?.groupId).toBeUndefined();

    const semanticGroup = { ...widget("grouped", 2), type: "text", groupId: "semantic-id" };
    expect(syncWidgetGroupIdsToContainment([rectangle, semanticGroup])[1].groupId)
      .toBe("semantic-id");
  });

  it("checks whether a widget is fully inside a parent widget", () => {
    const parent = { x: 10, y: 20, width: 100, height: 60 };
    expect(isWidgetContainedBy({ x: 10, y: 20, width: 100, height: 60 }, parent)).toBe(true);
    expect(isWidgetContainedBy({ x: 20, y: 30, width: 20, height: 10 }, parent)).toBe(true);
    expect(isWidgetContainedBy({ x: 100, y: 30, width: 20, height: 10 }, parent)).toBe(false);
    expect(isWidgetContainedBy({ x: 20, y: 70, width: 20, height: 20 }, parent)).toBe(false);
  });

  it("nests a new widget only when it is placed inside the single selected parent", () => {
    const parent = { ...widget("parent", 1), type: "container", x: 10, y: 10, width: 100, height: 60 };
    const inside = { ...widget("inside", 2), type: "text", x: 20, y: 20 };
    const outside = { ...widget("outside", 3), type: "text", x: 200, y: 20 };

    expect(getSelectedContainingParentId([parent], ["parent"], inside)).toBe("parent");
    expect(getSelectedContainingParentId([parent], ["parent"], outside)).toBeUndefined();
    expect(getSelectedContainingParentId([parent], ["parent", "another"], inside)).toBeUndefined();
  });

  it("chooses the nearest containing container when the outer parent is selected", () => {
    const rectangle = {
      ...widget("rectangle", 1),
      type: "container",
      x: 10,
      y: 10,
      width: 500,
      height: 300,
    };
    const ellipse = {
      ...widget("ellipse", 2),
      type: "card",
      groupId: rectangle.id,
      x: 50,
      y: 40,
      width: 140,
      height: 60,
    };
    const icon = {
      ...widget("icon", 3),
      type: "icon",
      groupId: rectangle.id,
      x: 100,
      y: 55,
      width: 20,
      height: 20,
    };

    expect(getSelectedContainingParentId(
      [rectangle, ellipse],
      [rectangle.id],
      icon,
    )).toBe(ellipse.id);
  });

  it("does not nest a new widget inside a selected rectangle (B7)", () => {
    const shape = { ...widget("shape", 1), x: 10, y: 10, width: 100, height: 60 };
    const inside = { ...widget("inside", 2), type: "text", x: 20, y: 20 };
    expect(getSelectedContainingParentId([shape], ["shape"], inside)).toBeUndefined();
  });

  it("keeps new widgets at screen level when the selected widget is already nested", () => {
    const parent = {
      ...widget("parent", 1),
      x: 10,
      y: 10,
      width: 100,
      height: 60,
    };
    const selectedChild = {
      ...widget("selected-child", 2),
      groupId: "parent",
      x: 20,
      y: 20,
      width: 80,
      height: 40,
    };
    const newWidget = {
      ...widget("new-widget", 3),
      x: 25,
      y: 25,
      width: 20,
      height: 10,
    };

    expect(
      getSelectedContainingParentId(
        [parent, selectedChild],
        ["selected-child"],
        newWidget,
      ),
    ).toBeUndefined();
  });

  it("keeps new containers as siblings unless nesting is explicitly established", () => {
    const parent = { ...widget("parent", 1), x: 10, y: 10, width: 100, height: 60 };
    const newContainer = {
      ...widget("new-container", 2),
      type: "panel",
      x: 20,
      y: 20,
    };

    expect(getSelectedContainingParentId([parent], ["parent"], newContainer))
      .toBeUndefined();
  });

  it("moves a layer to the top-list target position and assigns descending z-index", () => {
    const result = reorderWidgets(
      [widget("a", 1), widget("b", 2), widget("c", 3)],
      "a",
      "b",
      "before",
    );

    expect(result.map((item) => [item.id, item.zIndex])).toEqual([
      ["c", 3],
      ["a", 2],
      ["b", 1],
    ]);
  });

  it("leaves widget order unchanged for unknown or identical drag targets", () => {
    const items = [widget("a", 1), widget("b", 2)];
    expect(reorderWidgets(items, "missing", "a", "before")).toEqual(items);
    expect(reorderWidgets(items, "a", "a", "after")).toEqual(items);
  });

  it("reorders screens without changing their identities", () => {
    const screens = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(reorderScreens(screens, "c", "a", "after").map((item) => item.id)).toEqual([
      "a",
      "c",
      "b",
    ]);
  });

  it("supports the persisted optional widget name and group metadata", () => {
    const project = createEmptyProject();
    const parsed = parseProject({
      ...project,
      screens: project.screens.map((screen) => ({
        ...screen,
        widgets: [{
          ...widget(crypto.randomUUID(), 1),
          name: "Card",
          groupId: crypto.randomUUID(),
        }],
      })),
    });
    expect(parsed.screens[0].widgets[0]).toMatchObject({
      name: "Card",
      groupId: expect.any(String),
    });
  });
});

describe("B4: containers nest by centre point", () => {
  const box = (id: string, type: string, x: number, y: number, width: number, height: number) => ({
    id, type, groupId: undefined as string | undefined, x, y, width, height, zIndex: 0,
  });

  it("adopts a widget whose centre is inside a container even if it hangs over the edge", () => {
    const card = box("card", "container", 0, 0, 200, 100);
    const halfOver = box("child", "rectangle", 150, 20, 80, 40); // centre (190, 40) is inside
    const outside = box("other", "rectangle", 180, 20, 80, 40); // centre (220, 40) is outside
    const map = getWidgetParentIdMap([card, halfOver, outside]);
    expect(map.get("child")).toBe("card");
    expect(map.has("other")).toBe(false);
  });

  it("keeps the full-fit rule for repeaters", () => {
    const repeater = box("rep", "repeater", 0, 0, 200, 100);
    const halfOver = box("child", "rectangle", 150, 20, 80, 40);
    expect(containerAdoptsWidget(repeater, halfOver)).toBe(false);
    expect(containerAdoptsWidget(repeater, box("in", "rectangle", 10, 10, 50, 50))).toBe(true);
  });

  it("does not let a plain shape adopt by centre", () => {
    const shape = box("bg", "rectangle", 0, 0, 200, 100);
    expect(getWidgetParentIdMap([shape, box("t", "text", 150, 20, 80, 40)]).has("t")).toBe(false);
  });

  it("puts the centre exactly on the edge inside", () => {
    expect(isWidgetCentreInside(box("a", "text", 160, 0, 80, 20), box("p", "container", 0, 0, 200, 100))).toBe(true);
  });
});
