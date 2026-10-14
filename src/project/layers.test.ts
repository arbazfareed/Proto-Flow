import { describe, expect, it } from "vitest";
import { createEmptyProject, parseProject } from "./schema";
import {
  getSelectedContainingParentId,
  isWidgetContainedBy,
  isWidgetContainer,
  reorderScreens,
  reorderWidgets,
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

  it("checks whether a widget is fully inside a parent widget", () => {
    const parent = { x: 10, y: 20, width: 100, height: 60 };
    expect(isWidgetContainedBy({ x: 10, y: 20, width: 100, height: 60 }, parent)).toBe(true);
    expect(isWidgetContainedBy({ x: 20, y: 30, width: 20, height: 10 }, parent)).toBe(true);
    expect(isWidgetContainedBy({ x: 100, y: 30, width: 20, height: 10 }, parent)).toBe(false);
    expect(isWidgetContainedBy({ x: 20, y: 70, width: 20, height: 20 }, parent)).toBe(false);
  });

  it("nests a new widget only when it is placed inside the single selected parent", () => {
    const parent = { ...widget("parent", 1), x: 10, y: 10, width: 100, height: 60 };
    const inside = { ...widget("inside", 2), x: 20, y: 20 };
    const outside = { ...widget("outside", 3), x: 200, y: 20 };

    expect(getSelectedContainingParentId([parent], ["parent"], inside)).toBe("parent");
    expect(getSelectedContainingParentId([parent], ["parent"], outside)).toBeUndefined();
    expect(getSelectedContainingParentId([parent], ["parent", "another"], inside)).toBeUndefined();
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
