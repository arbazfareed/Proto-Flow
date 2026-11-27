import { describe, expect, it } from "vitest";
import type { Widget } from "./schema";
import { getDeletableWidgetIds } from "./widgetSelection";

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
