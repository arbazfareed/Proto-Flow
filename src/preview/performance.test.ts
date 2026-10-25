import { describe, expect, it } from "vitest";
import { LITE_MODE_WIDGET_THRESHOLD, estimateWidgetCount } from "./performance";
import type { Widget } from "../project/schema";

function widget(
  id: string,
  type: string,
  props: Record<string, unknown> = {},
): Widget {
  return {
    id,
    type,
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
    props,
  };
}

describe("preview workload estimation", () => {
  it("counts panel states and repeater row instances", () => {
    const panel = widget("panel", "dynamic-panel", {
      states: [{
        id: "panel-state",
        name: "Open",
        widgets: [widget("panel-child", "text")],
      }],
    });
    const repeater = widget("repeater", "repeater", {
      dataset: [{ value: 1 }, { value: 2 }],
      rowTemplate: { widgets: [widget("row-child", "text"), widget("row-label", "text")] },
    });

    expect(estimateWidgetCount([panel, repeater])).toBe(7);
  });

  it("uses runtime row data and caps expensive estimates above the lite-mode threshold", () => {
    const repeater = widget("repeater", "repeater", {
      dataset: [],
      rowTemplate: { widgets: Array.from({ length: 5 }, (_, index) => widget(`row-${index}`, "text")) },
    });
    expect(estimateWidgetCount([repeater], {
      repeater: Array.from({ length: 2_001 }, () => ({})),
    })).toBe(LITE_MODE_WIDGET_THRESHOLD + 1);
  });
});
