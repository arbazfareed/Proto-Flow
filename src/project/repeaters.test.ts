import { describe, expect, it } from "vitest";
import {
  collectRepeaterTemplateWidgets,
  MAX_REPEATER_ROWS,
  getRepeaterBoundWidgetIds,
  getRepeaterDataset,
  getRepeaterTemplate,
  interpolateItem,
  isRepeaterItemVisible,
  parseRepeaterCsv,
  parseRepeaterDataset,
  repeaterDataBytes,
  repeaterDatasetToCsv,
  mergeActiveRepeaterWidgets,
  updateRepeater,
  withRepeaterTemplate,
} from "./repeaters";
import { getPanelStates, withPanelStates } from "./dynamicPanels";
import { createEmptyProject, parseProject, type Widget } from "./schema";

function widget(type: string, props: Record<string, unknown>): Widget {
  return {
    id: crypto.randomUUID(),
    type,
    x: 10,
    y: 20,
    width: 200,
    height: 120,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    zIndex: 0,
    style: {},
    props,
  };
}

describe("repeater data helpers", () => {
  it("parses and serializes CSV with quoted delimiters and primitive values", () => {
    const rows = parseRepeaterCsv('name,score,active\r\n"Ada, Lovelace",12,true\r\nGrace,9,false');
    expect(rows).toEqual([
      { name: "Ada, Lovelace", score: 12, active: true },
      { name: "Grace", score: 9, active: false },
    ]);
    expect(parseRepeaterCsv(repeaterDatasetToCsv(rows))).toEqual(rows);
  });

  it("rejects malformed or oversized data and interpolates item fields", () => {
    expect(() => parseRepeaterDataset("{")).toThrow(/valid JSON/i);
    expect(() => parseRepeaterDataset(Array.from({ length: MAX_REPEATER_ROWS + 1 }, () => ({}))))
      .toThrow(/at most 1000/i);
    expect(() => parseRepeaterCsv('name\n"missing quote')).toThrow(/unterminated/i);
    expect(interpolateItem("Hello {{ item.name }} / {{item.missing}}", { name: "Ada" }))
      .toBe("Hello Ada / ");
    expect(repeaterDataBytes([{ content: "x".repeat(100) }])).toBeGreaterThan(100);
  });

  it("evaluates per-record visibility conditions with typed comparisons", () => {
    const templateWidget = widget("text", {
      visibleWhen: { field: "active", operator: "equals", value: true },
    });
    expect(isRepeaterItemVisible(templateWidget, { active: true })).toBe(true);
    expect(isRepeaterItemVisible(templateWidget, { active: false })).toBe(false);
    expect(isRepeaterItemVisible(widget("text", {
      visibleWhen: { field: "score", operator: "greaterThan", value: 10 },
    }), { score: 12 })).toBe(true);
    expect(isRepeaterItemVisible(widget("text", {
      visibleWhen: { field: "name", operator: "contains", value: "Ada" },
    }), { name: "Ada Lovelace" })).toBe(true);
  });

  it("migrates old repeaters and validates the row-template schema", () => {
    const project = createEmptyProject("Repeater migration");
    const legacyWidget = widget("repeater", { label: "Legacy list" });
    project.screens[0].widgets.push(legacyWidget);
    const migrated = parseProject({ ...project, schemaVersion: "1.4.0" });
    const repeater = migrated.screens[0].widgets[0];
    expect(repeater.props).toMatchObject({
      rowTemplate: { widgets: [] },
      dataset: [],
      layout: "vertical",
      gap: 8,
      itemBinding: {},
    });
    expect(getRepeaterDataset(repeater)).toEqual([]);
    expect(() => parseProject({
      ...migrated,
      screens: [{
        ...migrated.screens[0],
        widgets: [{
          ...repeater,
          props: { ...repeater.props, dataset: Array.from({ length: 1_001 }, () => ({})) },
        }],
      }],
    })).toThrow(/at most 1,000 record objects/i);
  });

  it("filters malformed datasets and validates every row and primitive field", () => {
    const repeater = widget("repeater", { dataset: [{ value: 1 }, null, [], "bad"] });
    expect(getRepeaterDataset(repeater)).toEqual([{ value: 1 }]);
    expect(getRepeaterTemplate(widget("repeater", { rowTemplate: [] }))).toEqual([]);
    expect(() => parseRepeaterDataset([null])).toThrow(/row 1 must be an object/i);
    expect(() => parseRepeaterDataset([{ value: {} }])).toThrow(/must be text/i);
    expect(() => parseRepeaterDataset([{ value: Number.POSITIVE_INFINITY }])).toThrow(/must be finite/i);
    expect(() => parseRepeaterDataset([{ value: 1 }])).not.toThrow();
  });

  it("merges edited repeater rows in local coordinates and updates nested repeaters", () => {
    const repeater = widget("repeater", { rowTemplate: { widgets: [] } });
    const child = widget("text", {});
    child.groupId = repeater.id;
    const configured = withRepeaterTemplate(repeater, [child]);
    const addition = { ...widget("button", {}), groupId: repeater.id, x: 50, y: 80 };
    const movedChild = { ...child, x: 30, y: 45 };
    const merged = mergeActiveRepeaterWidgets(
      [configured],
      [movedChild, addition],
      repeater.id,
    );

    expect(merged[0].props.rowTemplate).toEqual({
      widgets: [
        expect.objectContaining({ id: child.id, x: 20, y: 25 }),
        expect.objectContaining({ id: addition.id, x: 40, y: 60 }),
      ],
    });
    const rootWidgets = [configured];
    expect(mergeActiveRepeaterWidgets(rootWidgets, [child], null)).toBe(rootWidgets);
    const renamed = updateRepeater(merged, repeater.id, (item) => ({
      ...item,
      props: { ...item.props, label: "Updated" },
    }));
    expect(renamed[0].props.label).toBe("Updated");
    expect(updateRepeater(merged, crypto.randomUUID(), (item) => item)).toEqual(merged);
  });

  it("checks data binding IDs and collects widgets nested in panel and repeater states", () => {
    const bound = widget("text", {});
    const panelChild = widget("button", {});
    const state = { id: crypto.randomUUID(), name: "Open", widgets: [panelChild] };
    const panel = withPanelStates(widget("dynamic-panel", {}), [state], state.id);
    const nestedRepeater = withRepeaterTemplate(widget("repeater", {}), [bound]);
    const repeater = withRepeaterTemplate(widget("repeater", {
      itemBinding: { title: bound.id, ignored: 42, nested: null },
    }), [panel, nestedRepeater]);

    expect(getRepeaterBoundWidgetIds(repeater)).toEqual([bound.id]);
    expect(getRepeaterBoundWidgetIds(widget("repeater", { itemBinding: [] }))).toEqual([]);
    expect(collectRepeaterTemplateWidgets(repeater).map((item) => item.id))
      .toEqual([panel.id, panelChild.id, nestedRepeater.id, bound.id]);
    expect(getPanelStates(panel)[0].widgets).toContainEqual(panelChild);
  });

  it("covers visibility rules for malformed, typed, and fallback operators", () => {
    expect(isRepeaterItemVisible(widget("text", {}), {})).toBe(true);
    expect(isRepeaterItemVisible(widget("text", { visibleWhen: [] }), {})).toBe(true);
    expect(isRepeaterItemVisible(widget("text", {
      visibleWhen: { field: 1, operator: "equals" },
    }), {})).toBe(true);
    expect(isRepeaterItemVisible(widget("text", {
      visibleWhen: { field: "status", operator: "notEquals", value: "closed" },
    }), { status: "open" })).toBe(true);
    expect(isRepeaterItemVisible(widget("text", {
      visibleWhen: { field: "score", operator: "lessThan", value: 4 },
    }), { score: 2 })).toBe(true);
    expect(isRepeaterItemVisible(widget("text", {
      visibleWhen: { field: "score", operator: "greaterThan", value: 4 },
    }), { score: "5" })).toBe(false);
    expect(isRepeaterItemVisible(widget("text", {
      visibleWhen: { field: "score", operator: "other", value: 4 },
    }), { score: 4 })).toBe(true);
  });

  it("handles empty CSV, UTF-8 BOM, escaped quotes, blank rows, and invalid headers", () => {
    expect(parseRepeaterCsv("")).toEqual([]);
    expect(parseRepeaterCsv('\uFEFFname,quote\nAda,"said ""hello"""\n,\n'))
      .toEqual([{ name: "Ada", quote: 'said "hello"' }]);
    expect(() => parseRepeaterCsv("name,name\nAda,Grace")).toThrow(/non-empty and unique/i);
    expect(() => parseRepeaterCsv("name,\nAda,Grace")).toThrow(/non-empty and unique/i);
    expect(repeaterDatasetToCsv([])).toBe("");
    expect(repeaterDatasetToCsv([{ value: 'a"b' }])).toBe('value\r\n"a""b"');
  });
});
