import type { Widget } from "./schema";
import { getPanelStates, mapWidgetsDeep } from "./dynamicPanels";

export const MAX_REPEATER_ROWS = 1_000;
export const REPEATER_DATA_WARNING_BYTES = 100 * 1024;

export type RepeaterRecord = Record<string, string | number | boolean | null>;
export type RepeaterLayout = "vertical" | "horizontal" | "grid";

export interface RepeaterTemplate {
  widgets: Widget[];
}

export function getRepeaterDataset(widget: Widget): RepeaterRecord[] {
  const value = widget.props.dataset;
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is RepeaterRecord =>
    typeof row === "object" && row !== null && !Array.isArray(row),
  );
}

export function getRepeaterTemplate(widget: Widget): Widget[] {
  const template = widget.props.rowTemplate;
  if (typeof template !== "object" || template === null || Array.isArray(template)) return [];
  const widgets = (template as Record<string, unknown>).widgets;
  return Array.isArray(widgets) ? widgets as Widget[] : [];
}

export function withRepeaterTemplate(widget: Widget, widgets: Widget[]): Widget {
  return {
    ...widget,
    props: { ...widget.props, rowTemplate: { widgets } },
  };
}

export function mergeActiveRepeaterWidgets(
  rootWidgets: Widget[],
  visibleWidgets: Widget[],
  repeaterId: string | null,
): Widget[] {
  if (!repeaterId) return rootWidgets;
  const visibleById = new Map(visibleWidgets.map((widget) => [widget.id, widget]));
  return updateRepeater(rootWidgets, repeaterId, (repeater) => {
    const children = getRepeaterTemplate(repeater);
    const offsetX = repeater.x;
    const offsetY = repeater.y;
    const updated = children.flatMap((child) => {
      const visible = visibleById.get(child.id);
      if (!visible) return [];
      const { x, y } = visible;
      return [{
        ...visible,
        x: x - offsetX,
        y: y - offsetY,
        groupId: child.groupId ?? repeaterId,
      }];
    });
    const childIds = new Set(children.map((child) => child.id));
    const added = visibleWidgets
      .filter((widget) => widget.groupId === repeaterId && !childIds.has(widget.id))
      .map((widget) => ({
        ...widget,
        x: widget.x - offsetX,
        y: widget.y - offsetY,
        groupId: repeaterId,
      }));
    return withRepeaterTemplate(repeater, [...updated, ...added]);
  });
}

export function updateRepeater(
  widgets: Widget[],
  repeaterId: string,
  update: (repeater: Widget) => Widget,
): Widget[] {
  return mapWidgetsDeep(widgets, (widget) =>
    widget.id === repeaterId && widget.type === "repeater" ? update(widget) : widget,
  );
}

export function interpolateItem(
  value: string,
  item: RepeaterRecord,
): string {
  return value.replace(/\{\{\s*item\.([\w$.-]+)\s*\}\}/g, (_match, field: string) => {
    const fieldValue = item[field];
    return fieldValue === null || fieldValue === undefined ? "" : String(fieldValue);
  });
}

export function isRepeaterItemVisible(widget: Widget, item: RepeaterRecord): boolean {
  const condition = widget.props.visibleWhen;
  if (typeof condition !== "object" || condition === null || Array.isArray(condition)) return true;
  const rule = condition as Record<string, unknown>;
  if (typeof rule.field !== "string" || typeof rule.operator !== "string") return true;
  const actual = item[rule.field];
  switch (rule.operator) {
    case "notEquals": return actual !== rule.value;
    case "contains": return typeof actual === "string" && actual.includes(String(rule.value ?? ""));
    case "greaterThan": return typeof actual === "number" && typeof rule.value === "number" && actual > rule.value;
    case "lessThan": return typeof actual === "number" && typeof rule.value === "number" && actual < rule.value;
    default: return actual === rule.value;
  }
}

export function repeaterDataBytes(dataset: RepeaterRecord[]): number {
  return new TextEncoder().encode(JSON.stringify(dataset)).byteLength;
}

export function parseRepeaterDataset(value: unknown): RepeaterRecord[] {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch (error) {
      throw new Error(`Repeater data must be valid JSON: ${error instanceof Error ? error.message : "invalid JSON"}`);
    }
  }
  if (!Array.isArray(parsed) || parsed.length > MAX_REPEATER_ROWS) {
    throw new Error(`Repeater data must be an array with at most ${MAX_REPEATER_ROWS} rows.`);
  }
  return parsed.map((row, index) => {
    if (typeof row !== "object" || row === null || Array.isArray(row)) {
      throw new Error(`Repeater row ${index + 1} must be an object.`);
    }
    for (const [key, field] of Object.entries(row)) {
      if (
        field !== null &&
        typeof field !== "string" &&
        typeof field !== "number" &&
        typeof field !== "boolean"
      ) throw new Error(`Repeater field "${key}" in row ${index + 1} must be text, a number, a boolean, or null.`);
      if (typeof field === "number" && !Number.isFinite(field)) {
        throw new Error(`Repeater field "${key}" in row ${index + 1} must be finite.`);
      }
    }
    return Object.fromEntries(Object.entries(row)) as RepeaterRecord;
  });
}

function parseCsvRows(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error("CSV contains an unterminated quoted field.");
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function parseRepeaterCsv(source: string): RepeaterRecord[] {
  const rows = parseCsvRows(source.replace(/^\uFEFF/, ""));
  if (rows.length === 0) return [];
  const headers = rows[0].map((field) => field.trim());
  if (headers.some((header) => !header) || new Set(headers).size !== headers.length) {
    throw new Error("CSV headers must be non-empty and unique.");
  }
  return parseRepeaterDataset(rows.slice(1).filter((row) => row.some((field) => field !== ""))
    .map((row) => Object.fromEntries(headers.map((header, index) => {
      const raw = row[index] ?? "";
      if (raw === "true") return [header, true];
      if (raw === "false") return [header, false];
      if (raw !== "" && Number.isFinite(Number(raw))) return [header, Number(raw)];
      return [header, raw];
    }))));
}

function csvField(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function repeaterDatasetToCsv(dataset: RepeaterRecord[]): string {
  const fields = [...new Set(dataset.flatMap((record) => Object.keys(record)))];
  if (fields.length === 0) return "";
  return [
    fields.map(csvField).join(","),
    ...dataset.map((record) => fields.map((field) => csvField(record[field])).join(",")),
  ].join("\r\n");
}

export function getRepeaterBoundWidgetIds(widget: Widget): string[] {
  const binding = widget.props.itemBinding;
  if (typeof binding !== "object" || binding === null || Array.isArray(binding)) return [];
  return Object.values(binding).filter((id): id is string => typeof id === "string");
}

export function collectRepeaterTemplateWidgets(widget: Widget): Widget[] {
  const children = getRepeaterTemplate(widget);
  return children.flatMap((child) => [
    child,
    ...(child.type === "dynamic-panel"
      ? getPanelStates(child).flatMap((state) => collectTemplate(state.widgets))
      : child.type === "repeater"
        ? collectRepeaterTemplateWidgets(child)
        : []),
  ]);
}

function collectTemplate(widgets: Widget[]): Widget[] {
  return widgets.flatMap((widget) => [
    widget,
    ...(widget.type === "dynamic-panel"
      ? getPanelStates(widget).flatMap((state) => collectTemplate(state.widgets))
      : widget.type === "repeater"
        ? collectRepeaterTemplateWidgets(widget)
        : []),
  ]);
}
