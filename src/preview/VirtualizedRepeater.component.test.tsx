import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PreviewRuntime } from "./runtime";
import { VirtualizedRepeater } from "./PreviewWindow";
import { createEmptyProject, type Widget } from "../project/schema";

function makeWidget(type: string, props: Record<string, unknown> = {}): Widget {
  return {
    id: crypto.randomUUID(),
    type,
    x: 0,
    y: 0,
    width: 240,
    height: 520,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    zIndex: 0,
    style: {},
    props,
  };
}

describe("VirtualizedRepeater", () => {
  it("renders a 500-row dataset within 300 ms by mounting only the visible rows", () => {
    const project = createEmptyProject("Repeater performance");
    const screen = project.screens[0];
    const repeater = makeWidget("repeater", { rowHeight: 52 });
    const template = makeWidget("text", { text: "{{item.name}}" });
    const runtime = new PreviewRuntime(project);
    const rows = Array.from({ length: 500 }, (_, index) => ({ name: `Row ${index + 1}` }));
    const startedAt = performance.now();
    const markup = renderToStaticMarkup(createElement(VirtualizedRepeater, {
      widget: repeater,
      rows,
      template: [template],
      layout: "vertical",
      gap: 0,
      runtime,
      screenId: screen.id,
      snapshot: { ...runtime.snapshot(), visibility: { [template.id]: true } },
      runEvent: () => undefined,
      onError: () => undefined,
      inputMode: screen.inputMode,
      controlValues: {},
      onControlValueChange: () => undefined,
      onGestureFeedback: () => undefined,
      commonHandlers: {},
      liteMode: false,
    }));

    expect(performance.now() - startedAt).toBeLessThan(300);
    expect(markup).toContain('data-repeater-row-count="500"');
    expect(markup).toContain('data-rendered-row-count="12"');
    expect(markup.match(/class="preview-repeater-row"/g)).toHaveLength(12);
    expect(markup).toContain("Row 1");
    expect(markup).not.toContain("Row 500");
  });
});
