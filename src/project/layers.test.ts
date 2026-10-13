import { describe, expect, it } from "vitest";
import { createEmptyProject, parseProject } from "./schema";
import { reorderScreens, reorderWidgets } from "./layers";

function widget(id: string, zIndex: number) {
  return {
    id,
    type: "rectangle",
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
