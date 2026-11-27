import { describe, expect, it } from "vitest";
import type { Widget } from "./schema";
import { getDeletableWidgetIds } from "./widgetSelection";
import {
  flattenActivePanelWidgets,
  mergeActivePanelWidgets,
  withPanelStates,
} from "./dynamicPanels";
import {
  collectRepeaterTemplateWidgets,
  mergeActiveRepeaterWidgets,
  withRepeaterTemplate,
} from "./repeaters";
import { removeSelectedWidgets } from "./widgetSelection";

function widget(id: string, options: Partial<Widget> = {}): Widget {
  return {
    id,
    type: "container",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    zIndex: 0,
    style: {},
    props: {},
    ...options,
  } as Widget;
}

describe("getDeletableWidgetIds", () => {
  it("deletes a selected container and all unlocked descendants", () => {
    const widgets = [
      widget("parent"),
      widget("child", { groupId: "parent" }),
      widget("grandchild", { groupId: "child" }),
      widget("other"),
    ];
    expect([...getDeletableWidgetIds(widgets, ["parent"])]).toEqual([
      "parent", "child", "grandchild",
    ]);
  });

  it("preserves locked selected widgets and locked descendants", () => {
    const widgets = [
      widget("parent"),
      widget("locked-child", { groupId: "parent", locked: true }),
      widget("unlocked-child", { groupId: "parent" }),
      widget("locked-root", { locked: true }),
    ];
    expect([...getDeletableWidgetIds(widgets, ["parent", "locked-root"])]).toEqual([
      "parent", "unlocked-child",
    ]);
  });

  it("ignores selected IDs that are not in the active canvas scope", () => {
    expect([...getDeletableWidgetIds([widget("one")], ["missing"])]).toEqual([]);
  });
});


describe("removeSelectedWidgets", () => {
  function scopedWidget(id: string, type = "rectangle", locked = false): Widget {
    return {
      id, type, x: 10, y: 20, width: 80, height: 40, rotation: 0,
      opacity: 1, visible: true, locked, zIndex: 0, style: {}, props: {},
    } as Widget;
  }

  it("deletes selected unlocked widgets and leaves unrelated widgets unchanged", () => {
    const first = scopedWidget("first");
    const second = scopedWidget("second", "text");
    const result = removeSelectedWidgets([first, second], ["first"]);
    expect(result.deletedIds).toEqual(["first"]);
    expect(result.widgets).toEqual([second]);
  });

  it("leaves widgets unchanged when no selected unlocked widget exists", () => {
    const widgets = [scopedWidget("one"), scopedWidget("locked", "rectangle", true)];
    const result = removeSelectedWidgets(widgets, ["missing", "locked"]);
    expect(result.deletedIds).toEqual([]);
    expect(result.widgets).toEqual(widgets);
  });

  it("deletes multiple selected widgets in one operation", () => {
    const widgets = [scopedWidget("one"), scopedWidget("two"), scopedWidget("three")];
    const result = removeSelectedWidgets(widgets, ["one", "three"]);
    expect(result.deletedIds).toEqual(["one", "three"]);
    expect(result.widgets.map((item) => item.id)).toEqual(["two"]);
  });

  it("never deletes locked widgets in a mixed selection", () => {
    const locked = scopedWidget("locked", "rectangle", true);
    const unlocked = scopedWidget("unlocked");
    const result = removeSelectedWidgets([locked, unlocked], ["locked", "unlocked"]);
    expect(result.deletedIds).toEqual(["unlocked"]);
    expect(result.widgets).toEqual([locked]);
  });

  it("removes a child from the active dynamic-panel state without changing inactive states", () => {
    const activeChild = scopedWidget("active-child");
    const inactiveChild = scopedWidget("inactive-child");
    const first = { id: "open", name: "Open", widgets: [activeChild] };
    const second = { id: "closed", name: "Closed", widgets: [inactiveChild] };
    const panel = withPanelStates(scopedWidget("panel", "dynamic-panel"), [first, second], "open");
    const active = flattenActivePanelWidgets([panel]);
    const result = removeSelectedWidgets(active, ["active-child"]);
    const merged = mergeActivePanelWidgets([panel], result.widgets, { panelId: "panel", stateId: "open" });
    expect((merged[0].props.states as Array<{id:string;widgets:Widget[]}>)[0].widgets).toEqual([]);
    expect((merged[0].props.states as Array<{id:string;widgets:Widget[]}>)[1].widgets).toEqual([inactiveChild]);
  });

  it("removes a child from the active repeater template without deleting the repeater", () => {
    const child = scopedWidget("row-child");
    const repeater = withRepeaterTemplate(scopedWidget("repeater", "repeater"), [child]);
    const visible = [repeater, ...collectRepeaterTemplateWidgets(repeater)];
    const result = removeSelectedWidgets(visible, ["row-child"]);
    const merged = mergeActiveRepeaterWidgets([repeater], result.widgets, "repeater");
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("repeater");
    expect(merged[0].props.rowTemplate).toEqual({ widgets: [] });
  });
});
