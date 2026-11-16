import { describe, expect, it } from "vitest";
import type { Widget } from "../project/schema";
import { widgetPickerLabels } from "./widgetLabel";

const widget = (type: string, props: Record<string, unknown> = {}, name?: string): Widget => ({
  id: crypto.randomUUID(), type, x: 0, y: 0, width: 10, height: 10, rotation: 0, opacity: 1,
  visible: true, locked: false, zIndex: 0, style: {}, props, ...(name ? { name } : {}),
});

describe("target picker names (B93)", () => {
  it("uses layer names and words, with the kind of widget", () => {
    const pay = widget("button", { label: "Pay now" });
    const panel = widget("rectangle", {}, "Side panel");
    const box = widget("rectangle");
    const labels = widgetPickerLabels([pay, panel, box]);
    expect(labels.get(pay.id)).toBe("Pay now · Button");
    expect(labels.get(panel.id)).toBe("Side panel · Rectangle");
    expect(labels.get(box.id)).toBe("Rectangle");
  });

  it("numbers widgets that would read the same", () => {
    const first = widget("rectangle");
    const second = widget("rectangle");
    const labels = widgetPickerLabels([first, second]);
    expect(labels.get(first.id)).toBe("Rectangle 1");
    expect(labels.get(second.id)).toBe("Rectangle 2");
  });
});
