export interface CanvasPoint {
  x: number;
  y: number;
}

export interface CanvasWidgetBounds extends CanvasPoint {
  id: string;
  width: number;
  height: number;
}

export interface CanvasGuide {
  axis: "x" | "y";
  coordinate: number;
  distance: number;
}

export interface SnapResult {
  position: CanvasPoint;
  guides: CanvasGuide[];
}

const SMART_GUIDE_THRESHOLD = 5;

function nearestAlignment(
  features: number[],
  otherFeatures: number[],
): { delta: number; coordinate: number } | null {
  let best: { delta: number; coordinate: number } | null = null;
  for (const feature of features) {
    for (const otherFeature of otherFeatures) {
      const delta = otherFeature - feature;
      if (
        Math.abs(delta) <= SMART_GUIDE_THRESHOLD &&
        (best === null || Math.abs(delta) < Math.abs(best.delta))
      ) {
        best = { delta, coordinate: otherFeature };
      }
    }
  }
  return best;
}

export function snapWidgetPosition(
  dragged: CanvasWidgetBounds,
  siblings: readonly CanvasWidgetBounds[],
  gridSize: number,
  snapEnabled: boolean,
  altKey = false,
): SnapResult {
  if (!snapEnabled || altKey) {
    return { position: { x: dragged.x, y: dragged.y }, guides: [] };
  }

  const otherWidgets = siblings.filter((sibling) => sibling.id !== dragged.id);
  const horizontal = nearestAlignment(
    [dragged.x, dragged.x + dragged.width / 2, dragged.x + dragged.width],
    otherWidgets.flatMap((widget) => [
      widget.x,
      widget.x + widget.width / 2,
      widget.x + widget.width,
    ]),
  );
  const vertical = nearestAlignment(
    [dragged.y, dragged.y + dragged.height / 2, dragged.y + dragged.height],
    otherWidgets.flatMap((widget) => [
      widget.y,
      widget.y + widget.height / 2,
      widget.y + widget.height,
    ]),
  );

  const x = horizontal
    ? dragged.x + horizontal.delta
    : Math.round(dragged.x / gridSize) * gridSize;
  const y = vertical
    ? dragged.y + vertical.delta
    : Math.round(dragged.y / gridSize) * gridSize;

  return {
    position: { x, y },
    guides: [
      ...(horizontal
        ? [{
            axis: "x" as const,
            coordinate: horizontal.coordinate,
            distance: Math.abs(horizontal.delta),
          }]
        : []),
      ...(vertical
        ? [{
            axis: "y" as const,
            coordinate: vertical.coordinate,
            distance: Math.abs(vertical.delta),
          }]
        : []),
    ],
  };
}
