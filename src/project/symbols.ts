import { createShapeWidget } from "../canvas/shapes";
import type { SymbolDefinition, Widget } from "./schema";

export function createSymbolDefinition(
  name: string,
  source: readonly Widget[],
  createId: () => string = () => crypto.randomUUID(),
): SymbolDefinition {
  if (source.length === 0) {
    throw new Error("Select at least one layer to create a symbol.");
  }
  if (source.some((widget) => widget.type === "symbol-instance")) {
    throw new Error("Detach nested symbols before creating a new symbol.");
  }

  const minX = Math.min(...source.map((widget) => widget.x));
  const minY = Math.min(...source.map((widget) => widget.y));
  const maxX = Math.max(...source.map((widget) => widget.x + widget.width));
  const maxY = Math.max(...source.map((widget) => widget.y + widget.height));
  const ids = new Map(source.map((widget) => [widget.id, createId()]));
  const widgets = [...source]
    .sort((first, second) => first.zIndex - second.zIndex)
    .map((widget, index) => ({
      ...structuredClone(widget),
      id: ids.get(widget.id)!,
      groupId: widget.groupId ? ids.get(widget.groupId) : undefined,
      x: widget.x - minX,
      y: widget.y - minY,
      zIndex: index + 1,
    }));

  return {
    id: createId(),
    name: name.trim().slice(0, 120) || "Untitled symbol",
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
    widgets,
  };
}

export function createSymbolInstance(
  symbol: SymbolDefinition,
  x: number,
  y: number,
  zIndex: number,
): Widget {
  return {
    ...createShapeWidget(
      "symbol-instance",
      x,
      y,
      symbol.width,
      symbol.height,
      { label: symbol.name },
    ),
    name: symbol.name,
    symbolId: symbol.id,
    zIndex,
  };
}

export function replaceWidgetsWithSymbolInstance(
  widgets: readonly Widget[],
  selectedIds: ReadonlySet<string>,
  instance: Widget,
): Widget[] {
  let insertedInstance = false;
  const replacements = [...widgets]
    .sort((first, second) => first.zIndex - second.zIndex)
    .flatMap((widget) => {
      if (!selectedIds.has(widget.id)) return [widget];
      if (insertedInstance) return [];
      insertedInstance = true;
      return [instance];
    });
  return replacements.map((widget, index) => ({ ...widget, zIndex: index }));
}

export function swapSymbolReference(
  instance: Widget,
  symbol: SymbolDefinition,
): Widget {
  if (instance.type !== "symbol-instance") {
    throw new Error("Only symbol instances can be swapped.");
  }
  const { symbolOverrides: _symbolOverrides, ...props } = instance.props;
  return {
    ...instance,
    symbolId: symbol.id,
    name: symbol.name,
    props: { ...props, label: symbol.name },
  };
}

function getRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function expandSymbolInstance(
  instance: Widget,
  symbol: SymbolDefinition,
  createId: () => string = () => crypto.randomUUID(),
): Widget[] {
  const ids = new Map(symbol.widgets.map((widget) => [widget.id, createId()]));
  const overrides = getRecord(instance.props.symbolOverrides);
  return symbol.widgets.map((widget, index) => ({
    ...structuredClone(widget),
    id: ids.get(widget.id)!,
    groupId: widget.groupId ? ids.get(widget.groupId) ?? instance.groupId : instance.groupId,
    props: {
      ...widget.props,
      ...getRecord(getRecord(overrides[widget.id]).props),
    },
    style: {
      ...widget.style,
      ...getRecord(getRecord(overrides[widget.id]).style),
    },
    x: instance.x + (widget.x / symbol.width) * instance.width,
    y: instance.y + (widget.y / symbol.height) * instance.height,
    width: (widget.width / symbol.width) * instance.width,
    height: (widget.height / symbol.height) * instance.height,
    rotation: widget.rotation + instance.rotation,
    opacity: widget.opacity * instance.opacity,
    zIndex: instance.zIndex + index,
    visible: instance.visible && widget.visible,
    locked: instance.locked || widget.locked,
  }));
}

export function detachSymbolInstances(
  widgets: readonly Widget[],
  symbols: readonly SymbolDefinition[],
  createId: () => string = () => crypto.randomUUID(),
): Widget[] {
  return widgets.flatMap((widget) => {
    if (widget.type !== "symbol-instance" || !widget.symbolId) return [widget];
    const symbol = symbols.find((candidate) => candidate.id === widget.symbolId);
    return symbol ? expandSymbolInstance(widget, symbol, createId) : [widget];
  });
}

export function createSymbolInstanceAtCenter(
  symbol: SymbolDefinition,
  widgets: readonly Widget[],
  screenWidth: number,
  screenHeight: number,
): Widget {
  return createSymbolInstance(
    symbol,
    Math.max(0, (screenWidth - symbol.width) / 2),
    Math.max(0, (screenHeight - symbol.height) / 2),
    Math.max(0, ...widgets.map((widget) => widget.zIndex)) + 1,
  );
}
