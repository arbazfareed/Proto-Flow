import { describe, expect, it } from "vitest";
import type { Widget } from "./schema";
import {
  flattenActivePanelWidgets,
  mergeActivePanelWidgets,
  withPanelStates,
} from "./dynamicPanels";
import {
  flattenRepeaterTemplateWidgets,
  mergeActiveRepeaterWidgets,
  withRepeaterTemplate,
} from "./repeaters";
import { removeSelectedWidgets } from "./widgetSelection";

function widget(id: string, type = "rectangle", locked = false): Widget {
  return {
    id, type, x: 10, y: 20, width: 80, height: 40, rotation: 0,
    opacity: 1, visible: true, locked, zIndex: 0, style: {}, props: {},
  };
}

describe("removeSelectedWidgets", () => {
  it("deletes a selected normal widget and leaves unrelated widgets unchanged", () => {
    const first = widget("first");
    const second = widget("second", "text");
    const result = removeSelectedWidgets([first, second], ["first"]);
    expect(result.deletedIds).toEqual(["first"]);
    expect(result.widgets).toEqual([second]);
  });

  it("deletes multiple selected widgets in one operation", () => {
    const widgets = [widget("one"), widget("two"), widget("three")];
    const result = removeSelectedWidgets(widgets, ["one", "three"]);
    expect(result.deletedIds).toEqual(["one", "three"]);
    expect(result.widgets.map((item) => item.id)).toEqual(["two"]);
  });

  it("never deletes locked widgets, including mixed locked and unlocked selections", () => {
    const widgets = [widget("locked", "rectangle", true), widget("unlocked")];
    const result = removeSelectedWidgets(widgets, ["locked", "unlocked"]);
    expect(result.deletedIds).toEqual(["unlocked"]);
    expect(result.widgets).toEqual([widgets[0]]);
    expect(removeSelectedWidgets([widgets[0]], ["locked"])).toEqual({
      widgets: [widgets[0]],
      deletedIds: [],
    });
  });

  it("removes a child from the active dynamic-panel state without changing inactive states", () => {
    const activeChild = widget("active-child");
    const inactiveChild = widget("inactive-child");
    const first = { id: "open", name: "Open", widgets: [activeChild] };
    const second = { id: "closed", name: "Closed", widgets: [inactiveChild] };
    const panel = withPanelStates(widget("panel", "dynamic-panel"), [first, second], "open");
    const active = flattenActivePanelWidgets([panel]);
    const result = removeSelectedWidgets(active, ["active-child"]);
    const merged = mergeActivePanelWidgets([panel], result.widgets, { panelId: "panel", stateId: "open" });
    expect((merged[0].props.states as Array<{id:string;widgets:Widget[]}>)[0].widgets).toEqual([]);
    expect((merged[0].props.states as Array<{id:string;widgets:Widget[]}>)[1].widgets).toEqual([inactiveChild]);
  });

  it("removes a child from the active repeater template without deleting the repeater", () => {
    const child = widget("row-child");
    const repeater = withRepeaterTemplate(widget("repeater", "repeater"), [child]);
    const visible = [...[repeater], ...flattenRepeaterTemplateWidgets(repeater, repeater.x, repeater.y)];
    const result = removeSelectedWidgets(visible, ["row-child"]);
    const merged = mergeActiveRepeaterWidgets([repeater], result.widgets, "repeater");
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("repeater");
    expect(merged[0].props.rowTemplate).toEqual({ widgets: [] });
  });
});
