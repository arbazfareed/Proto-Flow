import type { Project, Widget, WidgetNotes } from "./schema";
import { collectWidgetsDeep, mapWidgetsDeep } from "./dynamicPanels";

export type WidgetNoteRecord = {
  screenId: string;
  screenName: string;
  widget: Widget & { notes: WidgetNotes };
};

export interface WidgetNotesFilter {
  query: string;
  status: string;
  priority: string;
}

export function getWidgetNoteRecords(project: Project): WidgetNoteRecord[] {
  return project.screens.flatMap((screen) =>
    collectWidgetsDeep(screen.widgets)
      .filter(
        (widget): widget is Widget & { notes: WidgetNotes } =>
          Boolean(widget.notes && hasWidgetNotes(widget.notes)),
      )
      .map((widget) => ({ screenId: screen.id, screenName: screen.name, widget })),
  );
}

export function hasWidgetNotes(notes: WidgetNotes): boolean {
  return Boolean(
    notes.description.trim() ||
    notes.requirementId.trim() ||
    notes.priority !== "low" ||
    notes.status !== "draft" ||
    notes.tags.length ||
    Object.keys(notes.custom).length,
  );
}

export function filterWidgetNotes(
  records: WidgetNoteRecord[],
  filter: WidgetNotesFilter,
): WidgetNoteRecord[] {
  const query = filter.query.trim().toLocaleLowerCase();
  return records.filter(({ widget }) => {
    const notes = widget.notes;
    if (!notes) return false;
    if (filter.status && notes.status !== filter.status) return false;
    if (filter.priority && notes.priority !== filter.priority) return false;
    if (!query) return true;
    const searchable = [
      widget.name ?? "",
      widget.type,
      notes.description,
      notes.requirementId,
      ...notes.tags,
      ...Object.entries(notes.custom).flat(),
    ].join(" ").toLocaleLowerCase();
    return searchable.includes(query);
  });
}

export function updateWidgetNotes(
  project: Project,
  widgetId: string,
  update: (notes: WidgetNotes) => WidgetNotes,
): Project {
  let found = false;
  const screens = project.screens.map((screen) => ({
    ...screen,
    widgets: mapWidgetsDeep(screen.widgets, (widget) => {
      if (widget.id !== widgetId) return widget;
      found = true;
      const notes = widget.notes ?? {
        description: "",
        requirementId: "",
        priority: "low" as const,
        status: "draft" as const,
        tags: [],
        custom: {},
      };
      return { ...widget, notes: update(notes) };
    }),
  }));
  return found ? { ...project, updatedAt: new Date().toISOString(), screens } : project;
}

function csvCell(value: string): string {
  const safeValue = /^[\t\r ]*[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safeValue.replaceAll('"', '""')}"`;
}

export function exportWidgetNotesCsv(records: WidgetNoteRecord[]): string {
  const rows = [
    ["Screen", "Widget", "Type", "Requirement ID", "Priority", "Status", "Tags", "Description", "Custom fields"],
    ...records.map(({ screenName, widget }) => {
      const notes = widget.notes;
      return [
        screenName,
        widget.name ?? widget.type,
        widget.type,
        notes?.requirementId ?? "",
        notes?.priority ?? "",
        notes?.status ?? "",
        notes?.tags.join(", ") ?? "",
        notes?.description ?? "",
        Object.entries(notes?.custom ?? {}).map(([key, value]) => `${key}: ${value}`).join("; "),
      ];
    }),
  ];
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

export function exportWidgetNotesMarkdown(records: WidgetNoteRecord[]): string {
  if (records.length === 0) return "# Widget notes\n\nNo widget notes are recorded.\n";
  return [
    "# Widget notes",
    "",
    ...records.flatMap(({ screenName, widget }) => {
      const notes = widget.notes;
      if (!notes) return [];
      const lines = [
        `## ${widget.name ?? widget.type}`,
        "",
        `- Screen: ${screenName}`,
        `- Requirement: ${notes.requirementId || "—"}`,
        `- Priority: ${notes.priority}`,
        `- Status: ${notes.status}`,
        `- Tags: ${notes.tags.join(", ") || "—"}`,
      ];
      for (const [key, value] of Object.entries(notes.custom)) lines.push(`- ${key}: ${value}`);
      if (notes.description.trim()) lines.push("", notes.description);
      return [...lines, ""];
    }),
  ].join("\n");
}

export function widgetNotesCodeComments(project: Project): string {
  return getWidgetNoteRecords(project).map(({ screenName, widget }) => {
    const notes = widget.notes;
    const details = [
      `${notes.priority}, ${notes.status}`,
      notes.requirementId ? `requirement ${notes.requirementId}` : "",
      notes.tags.length ? `tags ${notes.tags.join(", ")}` : "",
      notes.description ? `description ${notes.description}` : "",
      ...Object.entries(notes.custom).map(([key, value]) => `${key}: ${value}`),
    ].filter(Boolean).map((value) => JSON.stringify(value)).join(" | ");
    return `// Widget note for ${JSON.stringify(screenName)} / ${JSON.stringify(widget.name ?? widget.type)}: ${details}`;
  }).join("\n");
}

export function widgetNotesHtmlComments(project: Project): string {
  return getWidgetNoteRecords(project).map(({ screenName, widget }) => {
    const notes = widget.notes;
    const description = [
      `${notes.priority}, ${notes.status}`,
      notes.requirementId ? `requirement ${notes.requirementId}` : "",
      notes.tags.length ? `tags ${notes.tags.join(", ")}` : "",
      notes.description ? `description ${notes.description}` : "",
      ...Object.entries(notes.custom).map(([key, value]) => `${key}: ${value}`),
    ].filter(Boolean).join(" | ")
      .replaceAll("--", "—")
      .replaceAll("<", "‹")
      .replaceAll(">", "›")
      .replaceAll("\r", " ")
      .replaceAll("\n", " ");
    return `<!-- Widget note for ${screenName} / ${widget.name ?? widget.type}: ${description} -->`;
  }).join("\n");
}
