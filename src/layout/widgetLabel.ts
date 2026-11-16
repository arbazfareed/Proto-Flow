import type { Widget } from "../project/schema";
import { getShapeToolDefinition } from "../canvas/shapeTools";

/** The name a widget goes by in Layers: its own name, else its words, else its kind. */
export function widgetLabel(widget: Widget): string {
  if (widget.name) return widget.name;
  const values = widget.type === "image"
    ? [widget.props.fileName, widget.props.alt, widget.props.text]
    : [widget.props.label, widget.props.text, widget.props.fileName];
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  if (widget.type === "image") return "Untitled asset";
  return getShapeToolDefinition(widget.type)?.label ?? widget.type;
}

/** What kind of widget this is, e.g. "Button" or "Rectangle". */
export function widgetKind(widget: Widget): string {
  return getShapeToolDefinition(widget.type)?.label ?? widget.type;
}

/**
 * Names for a list of widgets in a picker (B93): the layer name plus its kind when that adds
 * something ("Pay now · Button"), numbered when two would otherwise read the same.
 */
export function widgetPickerLabels(widgets: readonly Widget[]): Map<string, string> {
  const labels = widgets.map((widget) => {
    const name = widgetLabel(widget);
    const kind = widgetKind(widget);
    return { id: widget.id, text: name === kind ? kind : `${name} · ${kind}` };
  });
  const seen = new Map<string, number>();
  const totals = new Map<string, number>();
  for (const { text } of labels) totals.set(text, (totals.get(text) ?? 0) + 1);
  return new Map(labels.map(({ id, text }) => {
    if ((totals.get(text) ?? 0) < 2) return [id, text];
    const count = (seen.get(text) ?? 0) + 1;
    seen.set(text, count);
    return [id, `${text} ${count}`];
  }));
}
