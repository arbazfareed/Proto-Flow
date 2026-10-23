import { describe, expect, it } from "vitest";
import { createEmptyProject, type Widget } from "./schema";
import {
  exportWidgetNotesCsv,
  exportWidgetNotesMarkdown,
  filterWidgetNotes,
  getWidgetNoteRecords,
  updateWidgetNotes,
} from "./widgetNotes";

function makeWidget(name: string): Widget {
  return {
    id: crypto.randomUUID(),
    type: "button",
    name,
    x: 0,
    y: 0,
    width: 100,
    height: 40,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    zIndex: 0,
    style: {},
    props: {},
  };
}

describe("widget notes", () => {
  it("updates notes without changing unrelated widgets and preserves nested widgets", () => {
    const project = createEmptyProject();
    const target = makeWidget("Continue");
    const unrelated = makeWidget("Cancel");
    project.screens[0].widgets = [target, unrelated];

    const changed = updateWidgetNotes(project, target.id, (notes) => ({
      ...notes,
      requirementId: "REQ-12",
      tags: ["checkout"],
    }));
    expect(changed.screens[0].widgets[0].notes?.requirementId).toBe("REQ-12");
    expect(changed.screens[0].widgets[1]).toBe(unrelated);
    expect(updateWidgetNotes(project, crypto.randomUUID(), (notes) => notes)).toBe(project);

    const panelId = crypto.randomUUID();
    const stateId = crypto.randomUUID();
    project.screens[0].widgets = [{
      ...makeWidget("Panel"),
      id: panelId,
      type: "dynamic-panel",
      props: { states: [{ id: stateId, name: "Default", widgets: [target] }] },
    }];
    const nestedChanged = updateWidgetNotes(project, target.id, (notes) => ({
      ...notes,
      description: "Nested note",
    }));
    expect(getWidgetNoteRecords(nestedChanged).find((record) => record.widget.id === target.id)?.widget.notes?.description)
      .toBe("Nested note");
  });

  it("filters by description, requirement, tag, status, and priority", () => {
    const project = createEmptyProject();
    const widget = makeWidget("Continue");
    widget.notes = {
      description: "Validates email before checkout",
      requirementId: "REQ-22",
      priority: "high",
      status: "in review",
      tags: ["accessibility"],
      custom: {},
    };
    project.screens[0].widgets = [widget];
    const records = getWidgetNoteRecords(project);

    expect(filterWidgetNotes(records, { query: "email", status: "", priority: "" })).toHaveLength(1);
    expect(filterWidgetNotes(records, { query: "req-22", status: "in review", priority: "high" })).toHaveLength(1);
    expect(filterWidgetNotes(records, { query: "missing", status: "", priority: "" })).toEqual([]);
    expect(filterWidgetNotes(records, { query: "", status: "approved", priority: "" })).toEqual([]);
  });

  it("exports CSV-safe values and readable Markdown specifications", () => {
    const project = createEmptyProject();
    const widget = makeWidget('Say "hello"');
    widget.notes = {
      description: "Show **confirmation**",
      requirementId: "REQ-7",
      priority: "critical",
      status: "blocked",
      tags: ["form", "release"],
      custom: { owner: "UI team" },
    };
    project.screens[0].widgets = [widget];
    const records = getWidgetNoteRecords(project);
    const csv = exportWidgetNotesCsv(records);
    const markdown = exportWidgetNotesMarkdown(records);

    expect(csv).toContain('"Say ""hello"""');
    expect(csv).toContain('"REQ-7"');
    expect(markdown).toContain("## Say \"hello\"");
    expect(markdown).toContain("- Priority: critical");
    expect(markdown).toContain("Show **confirmation**");
    expect(exportWidgetNotesMarkdown([])).toContain("No widget notes");
  });

  it("neutralizes spreadsheet formula prefixes in CSV fields", () => {
    const project = createEmptyProject();
    const widget = makeWidget("Formula");
    widget.notes = {
      description: "=HYPERLINK(\"https://example.invalid\")",
      requirementId: "",
      priority: "low",
      status: "draft",
      tags: [],
      custom: {},
    };
    project.screens[0].widgets = [widget];

    expect(exportWidgetNotesCsv(getWidgetNoteRecords(project)))
      .toContain(`"'=HYPERLINK(""https://example.invalid"")"`);
  });
});
