import { describe, expect, it } from "vitest";
import { createShapeWidget } from "../canvas/shapes";
import {
  createSymbolDefinition,
  createSymbolInstance,
  createSymbolInstanceAtCenter,
  detachSymbolInstances,
  expandSymbolInstance,
  replaceWidgetsWithSymbolInstance,
  swapSymbolReference,
} from "./symbols";

describe("project symbols", () => {
  it("creates normalized masters and remaps child references", () => {
    const parent = {
      ...createShapeWidget("rectangle", 100, 50, 200, 100),
      id: "parent",
      zIndex: 1,
    };
    const child = {
      ...createShapeWidget("text", 120, 70, 60, 20),
      id: "child",
      groupId: parent.id,
      zIndex: 2,
    };
    const ids = ["master-child", "master-parent", "symbol-id"];
    const symbol = createSymbolDefinition("Card", [parent, child], () => ids.shift()!);

    expect(symbol).toMatchObject({ id: "symbol-id", name: "Card", width: 200, height: 100 });
    expect(symbol.widgets).toMatchObject([
      { id: "master-child", x: 0, y: 0, zIndex: 1 },
      { id: "master-parent", x: 20, y: 20, groupId: "master-child", zIndex: 2 },
    ]);
  });

  it("expands symbol instances with fresh IDs, transformed geometry, and internal grouping", () => {
    const parent = {
      ...createShapeWidget("rectangle", 0, 0, 100, 50),
      id: "master-parent",
      zIndex: 1,
    };
    const child = {
      ...createShapeWidget("text", 10, 10, 20, 10),
      id: "master-child",
      groupId: parent.id,
      zIndex: 2,
    };
    const symbol = {
      id: "symbol-id",
      name: "Card",
      width: 100,
      height: 50,
      widgets: [parent, child],
    };
    const instance = createSymbolInstance(symbol, 50, 60, 10);
    instance.groupId = crypto.randomUUID();
    instance.width = 200;
    instance.height = 100;
    const ids = ["instance-parent", "instance-child"];
    const expanded = expandSymbolInstance(instance, symbol, () => ids.shift()!);

    expect(expanded).toMatchObject([
      {
        id: "instance-parent",
        x: 50,
        y: 60,
        width: 200,
        height: 100,
        zIndex: 10,
        groupId: instance.groupId,
      },
      { id: "instance-child", x: 70, y: 80, width: 40, height: 20, groupId: "instance-parent", zIndex: 11 },
    ]);
    expect(expanded.every((widget) => widget.type !== "symbol-instance")).toBe(true);
  });

  it("creates a centered instance and detaches it to independent widgets", () => {
    const source = createShapeWidget("button", 0, 0, 100, 40);
    const symbol = createSymbolDefinition("Button", [source], () => crypto.randomUUID());
    const instance = createSymbolInstanceAtCenter(symbol, [], 400, 300);
    expect(instance).toMatchObject({ x: 150, y: 130, type: "symbol-instance", symbolId: symbol.id });
    const detached = detachSymbolInstances([instance], [symbol]);
    expect(detached).toHaveLength(1);
    expect(detached[0]).toMatchObject({ type: "button", x: 150, y: 130 });
    expect(detached[0].id).not.toBe(instance.id);
    expect(detached[0].symbolId).toBeUndefined();
  });

  it("replaces selected layers at their original stack position", () => {
    const lower = { ...createShapeWidget("rectangle", 0, 0), id: crypto.randomUUID(), zIndex: 1 };
    const selectedOne = { ...createShapeWidget("rectangle", 0, 0), id: crypto.randomUUID(), zIndex: 2 };
    const middle = { ...createShapeWidget("rectangle", 0, 0), id: crypto.randomUUID(), zIndex: 3 };
    const selectedTwo = { ...createShapeWidget("rectangle", 0, 0), id: crypto.randomUUID(), zIndex: 4 };
    const instance = createShapeWidget("symbol-instance", 0, 0);
    const replaced = replaceWidgetsWithSymbolInstance(
      [lower, selectedOne, middle, selectedTwo],
      new Set([selectedOne.id, selectedTwo.id]),
      instance,
    );

    expect(replaced.map((widget) => widget.id)).toEqual([
      lower.id,
      instance.id,
      middle.id,
    ]);
    expect(replaced.map((widget) => widget.zIndex)).toEqual([0, 1, 2]);
  });

  it("swaps symbol references without changing instance transforms or carrying old overrides", () => {
    const instance = {
      ...createShapeWidget("symbol-instance", 20, 30, 120, 60),
      type: "symbol-instance",
      symbolId: crypto.randomUUID(),
      rotation: 17,
      props: { label: "Old", symbolOverrides: { old: { props: { text: "stale" } } } },
    };
    const symbol = {
      id: crypto.randomUUID(),
      name: "New",
      width: 40,
      height: 20,
      widgets: [createShapeWidget("rectangle", 0, 0, 40, 20)],
    };

    expect(swapSymbolReference(instance, symbol)).toMatchObject({
      x: 20,
      y: 30,
      width: 120,
      height: 60,
      rotation: 17,
      symbolId: symbol.id,
      name: "New",
      props: { label: "New" },
    });
    expect(swapSymbolReference(instance, symbol).props.symbolOverrides).toBeUndefined();
  });

  it("applies per-instance property overrides when detaching", () => {
    const masterWidget = {
      ...createShapeWidget("text", 0, 0, 40, 20, { text: "Master" }),
      id: crypto.randomUUID(),
    };
    const symbol = {
      id: crypto.randomUUID(),
      name: "Label",
      width: 40,
      height: 20,
      widgets: [masterWidget],
    };
    const instance = {
      ...createSymbolInstance(symbol, 10, 20, 1),
      props: {
        label: symbol.name,
        symbolOverrides: {
          [masterWidget.id]: { props: { text: "Instance" } },
        },
      },
    };

    expect(expandSymbolInstance(instance, symbol)[0].props.text).toBe("Instance");
  });

  it("rejects nested symbols and empty masters", () => {
    expect(() => createSymbolDefinition("Empty", [])).toThrow(/Select at least one layer/);
    expect(() => createSymbolDefinition("Nested", [{
      ...createShapeWidget("symbol-instance", 0, 0),
      type: "symbol-instance",
    }])).toThrow(/Detach nested symbols/);
  });
});
