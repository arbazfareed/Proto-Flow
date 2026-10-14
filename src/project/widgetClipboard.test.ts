import { afterEach, describe, expect, it } from "vitest";
import { createShapeWidget } from "../canvas/shapes";
import type { Widget } from "./schema";
import {
  clearInternalWidgetClipboard,
  copyWidgetsToClipboard,
  createWidgetCopies,
  parseWidgetClipboard,
  readWidgetClipboard,
  reorderWidgetSelection,
} from "./widgetClipboard";

function widget(id: string, zIndex: number, groupId?: string): Widget {
  return {
    ...createShapeWidget("rectangle", zIndex * 10, 0),
    id,
    zIndex,
    ...(groupId ? { groupId } : {}),
  };
}

afterEach(() => {
  clearInternalWidgetClipboard();
});

describe("widget clipboard and z-order actions", () => {
  it("validates serialized widget payloads and rejects invalid JSON", () => {
    const source = widget("00000000-0000-4000-8000-000000000001", 1);
    const payload = JSON.stringify({
      format: "protoflow/widgets",
      version: 1,
      widgets: [source],
    });
    expect(parseWidgetClipboard(payload)).toEqual([source]);
    expect(() => parseWidgetClipboard("{")).toThrow(/valid ProtoFlow widget JSON/);
    expect(() => parseWidgetClipboard(JSON.stringify({
      format: "protoflow/widgets",
      version: 1,
      widgets: [{ ...source, opacity: 4 }],
    }))).toThrow(/valid ProtoFlow widget JSON/);
  });

  it("keeps an internal copy when system clipboard access is unavailable", async () => {
    const source = widget("00000000-0000-4000-8000-000000000002", 1);
    expect(await copyWidgetsToClipboard([source])).toBe(false);
    expect(await readWidgetClipboard()).toEqual([source]);
  });

  it("creates multi-widget copies with new IDs, preserved parent references, offsets, and top z-order", () => {
    const parent = {
      ...widget("00000000-0000-4000-8000-000000000003", 1),
      overrides: { mobile: { x: 15, y: 25 } },
    };
    const child = widget(
      "00000000-0000-4000-8000-000000000004",
      2,
      parent.id,
    );
    const ids = [
      "00000000-0000-4000-8000-000000000005",
      "00000000-0000-4000-8000-000000000006",
    ];
    const copies = createWidgetCopies(
      [parent, child],
      [parent, child],
      { x: 20, y: 20 },
      () => ids.shift()!,
    );
    expect(copies.map((copy) => copy.id)).toEqual([
      "00000000-0000-4000-8000-000000000005",
      "00000000-0000-4000-8000-000000000006",
    ]);
    expect(copies.map((copy) => [copy.x, copy.y, copy.zIndex])).toEqual([
      [30, 20, 3],
      [40, 20, 4],
    ]);
    expect(copies[1].groupId).toBe(copies[0].id);
    expect(copies[0].overrides?.mobile).toMatchObject({ x: 35, y: 45 });
  });

  it("moves selected widgets front, back, forward, or backward as one stable block", () => {
    const items = [widget("a", 1), widget("b", 2), widget("c", 3), widget("d", 4)];
    expect(reorderWidgetSelection(items, ["b", "c"], "forward").map((item) => item.id))
      .toEqual(["a", "d", "b", "c"]);
    expect(reorderWidgetSelection(items, ["b", "c"], "backward").map((item) => item.id))
      .toEqual(["b", "c", "a", "d"]);
    expect(reorderWidgetSelection(items, ["b", "c"], "front").map((item) => item.id))
      .toEqual(["a", "d", "b", "c"]);
    expect(reorderWidgetSelection(items, ["b", "c"], "back").map((item) => item.id))
      .toEqual(["b", "c", "a", "d"]);
    expect(reorderWidgetSelection(items, ["a"], "back")).toEqual(items);
    expect(reorderWidgetSelection(items, ["d"], "front")).toEqual(items);
  });
});
