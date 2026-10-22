import { describe, expect, it } from "vitest";
import type { Widget } from "./schema";
import {
  addWidgetsToPanelState,
  flattenActivePanelWidgets,
  getPanelStates,
  mergeActivePanelWidgets,
  withPanelStates,
} from "./dynamicPanels";

function widget(type: string, x = 0): Widget {
  return {
    id: crypto.randomUUID(),
    type,
    x,
    y: 0,
    width: 50,
    height: 30,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    zIndex: 0,
    style: {},
    props: {},
  };
}

describe("dynamic panel helpers", () => {
  it("flattens only the active state recursively and keeps panel children in their layer", () => {
    const panel = widget("dynamic-panel");
    const firstChild = { ...widget("text", 12), groupId: panel.id };
    const otherChild = widget("button", 32);
    const firstState = { id: crypto.randomUUID(), name: "One", widgets: [firstChild] };
    const secondState = { id: crypto.randomUUID(), name: "Two", widgets: [otherChild] };
    const configured = withPanelStates(panel, [firstState, secondState], firstState.id);

    expect(flattenActivePanelWidgets([configured]).map((item) => item.id))
      .toEqual([configured.id, firstChild.id]);
    expect(flattenActivePanelWidgets([configured], { [configured.id]: secondState.id })
      .map((item) => item.id))
      .toEqual([configured.id, otherChild.id]);
    expect(flattenActivePanelWidgets([configured])[1].groupId).toBe(configured.id);
  });

  it("adds widgets to the requested state and merges active canvas changes without losing inactive states", () => {
    const panel = widget("dynamic-panel");
    const firstState = { id: crypto.randomUUID(), name: "One", widgets: [] as Widget[] };
    const hiddenChild = widget("ellipse", 80);
    const secondState = { id: crypto.randomUUID(), name: "Two", widgets: [hiddenChild] };
    const configured = withPanelStates(panel, [firstState, secondState], firstState.id);
    const added = widget("button", 10);
    let projectWidgets = addWidgetsToPanelState(
      [configured],
      configured.id,
      firstState.id,
      [added],
    );
    const active = flattenActivePanelWidgets(projectWidgets);
    const moved = active.map((item) => item.id === added.id ? { ...item, x: 24 } : item);
    projectWidgets = mergeActivePanelWidgets(
      projectWidgets,
      moved,
      { panelId: configured.id, stateId: firstState.id },
    );

    const states = getPanelStates(projectWidgets[0]);
    expect(states[0].widgets[0]).toMatchObject({ id: added.id, x: 24, groupId: configured.id });
    expect(states[1].widgets).toEqual([hiddenChild]);
  });
});
