import {
  getPanelStates,
} from "../project/dynamicPanels";
import {
  getRepeaterDataset,
  getRepeaterTemplate,
} from "../project/repeaters";
import type { Widget } from "../project/schema";

export const LITE_MODE_WIDGET_THRESHOLD = 10_000;

export function estimateWidgetCount(
  widgets: Widget[],
  repeaterData: Record<string, unknown> = {},
  limit = LITE_MODE_WIDGET_THRESHOLD,
): number {
  const countWidgets = (items: Widget[]): number => {
    let count = 0;
    for (const widget of items) {
      count += 1;
      if (widget.type === "dynamic-panel") {
        for (const state of getPanelStates(widget)) {
          count += countWidgets(state.widgets);
          if (count > limit) return limit + 1;
        }
      } else if (widget.type === "repeater") {
        const runtimeRows = repeaterData[widget.id];
        const rows = Array.isArray(runtimeRows)
          ? runtimeRows
          : getRepeaterDataset(widget);
        const templateCount = countWidgets(getRepeaterTemplate(widget));
        count += rows.length * templateCount;
        if (count > limit) return limit + 1;
      }
      if (count > limit) return limit + 1;
    }
    return count;
  };
  return countWidgets(widgets);
}
