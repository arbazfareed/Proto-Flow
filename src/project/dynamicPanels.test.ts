import { describe, expect, it } from "vitest";
import type { Widget } from "./schema";
import {
  addWidgetsToPanelState,
  collectWidgetsDeep,
  flattenRepeaterTemplateWidgets,
  flattenActivePanelWidgets,
  getActivePanelState,
  getPanelStates,
  mapWidgetsDeep,
  mergeActivePanelWidgets,
  updatePanelState,
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

  it("falls back to the first valid state and safely handles empty or malformed state lists", () => {
    const panel = widget("dynamic-panel");
    const firstState = { id: crypto.randomUUID(), name: "One", widgets: [] };
    const malformed = {
      ...panel,
      props: { states: [null, {}, firstState], activeStateId: "missing" },
    };

    expect(getPanelStates(malformed)).toEqual([firstState]);
    expect(getActivePanelState(malformed)).toBe(firstState);
    expect(getActivePanelState(panel)).toBeUndefined();
    expect(withPanelStates(panel, []).props.activeStateId).toBe("");
  });

  it("flattens repeater templates, collects nested children, and deeply updates or removes widgets", () => {
    const repeater = widget("repeater", 10);
    const panel = widget("dynamic-panel", 20);
    const child = { ...widget("text", 3), groupId: undefined };
    const nestedChild = widget("button", 5);
    const state = { id: crypto.randomUUID(), name: "One", widgets: [nestedChild] };
    const nestedPanel = withPanelStates(panel, [state], state.id);
    const configured = {
      ...repeater,
      props: { rowTemplate: { widgets: [child, nestedPanel] } },
    };

    expect(flattenRepeaterTemplateWidgets(configured, 100, 200)).toEqual([
      expect.objectContaining({ id: child.id, x: child.x + 100, y: child.y + 200, groupId: repeater.id }),
      expect.objectContaining({ id: nestedPanel.id, groupId: repeater.id }),
    ]);
    expect(flattenRepeaterTemplateWidgets(widget("rectangle"))).toEqual([]);
    expect(collectWidgetsDeep([configured]).map((item) => item.id))
      .toEqual([configured.id, child.id, nestedPanel.id, nestedChild.id]);

    const updated = mapWidgetsDeep([configured], (item) =>
      item.id === nestedChild.id ? null : { ...item, name: "Updated" },
    );
    expect(collectWidgetsDeep(updated).some((item) => item.id === nestedChild.id)).toBe(false);
    expect(collectWidgetsDeep(updated).every((item) => item.name === "Updated")).toBe(true);
  });

  it("recursively maps nested panels and ignores panel updates that do not match", () => {
    const panel = widget("dynamic-panel");
    const state = { id: crypto.randomUUID(), name: "One", widgets: [widget("button")] };
    const configured = withPanelStates(panel, [state], state.id);
    const updated = updatePanelState([configured], crypto.randomUUID(), (item) => item);
    expect(updated).toEqual([configured]);
    expect(mapWidgetsDeep([configured], (item) =>
      item.type === "button" ? { ...item, props: { label: "Changed" } } : item,
    )[0].props.states).toEqual([
      expect.objectContaining({
        widgets: [expect.objectContaining({ props: { label: "Changed" } })],
      }),
    ]);
  });

  it("places new widgets at the root when the edit scope is missing or stale", () => {
    const panel = widget("dynamic-panel");
    const state = { id: crypto.randomUUID(), name: "One", widgets: [] };
    const configured = withPanelStates(panel, [state], state.id);
    const addition = widget("text", 12);

    expect(mergeActivePanelWidgets([configured], [configured, addition], null))
      .toEqual([configured, addition]);
    expect(mergeActivePanelWidgets([configured], [configured, addition], {
      panelId: configured.id,
      stateId: crypto.randomUUID(),
    })).toEqual([configured, addition]);
  });
});
