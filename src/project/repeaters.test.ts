import { describe, expect, it } from "vitest";
import {
  MAX_REPEATER_ROWS,
  getRepeaterDataset,
  interpolateItem,
  parseRepeaterCsv,
  parseRepeaterDataset,
  repeaterDataBytes,
  repeaterDatasetToCsv,
} from "./repeaters";
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
});
