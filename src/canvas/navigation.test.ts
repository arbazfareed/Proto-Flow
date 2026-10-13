import { describe, expect, it } from "vitest";
import {
  centerCanvasView,
  clampCanvasZoom,
  fitCanvasBounds,
  getWidgetBounds,
  zoomAroundPointer,
} from "./navigation";

describe("canvas navigation math", () => {
  it("clamps zoom to the supported range", () => {
    expect(clampCanvasZoom(0)).toBe(0.1);
    expect(clampCanvasZoom(10)).toBe(4);
    expect(clampCanvasZoom(1.5)).toBe(1.5);
  });

  it("keeps the world coordinate under the pointer fixed while zooming", () => {
    const current = { zoom: 1.5, pan: { x: -80, y: 45 } };
    const pointer = { x: 310, y: 225 };
    const next = zoomAroundPointer(current, pointer, 2.25);

    expect(next.zoom).toBe(2.25);
    expect((pointer.x - next.pan.x) / next.zoom).toBeCloseTo(
      (pointer.x - current.pan.x) / current.zoom,
    );
    expect((pointer.y - next.pan.y) / next.zoom).toBeCloseTo(
      (pointer.y - current.pan.y) / current.zoom,
    );
  });

  it("computes bounds for all supplied widgets", () => {
    expect(
      getWidgetBounds([
        { x: 20, y: 30, width: 80, height: 40 },
        { x: -10, y: 50, width: 15, height: 30 },
      ]),
    ).toEqual({ x: -10, y: 30, width: 110, height: 50 });
    expect(getWidgetBounds([])).toBeNull();
  });

  it("centers empty canvases on the origin and content on its bounds", () => {
    expect(centerCanvasView(null, { width: 800, height: 600 })).toEqual({
      zoom: 1,
      pan: { x: 400, y: 300 },
    });
    expect(
      centerCanvasView(
        { x: 100, y: 50, width: 200, height: 100 },
        { width: 800, height: 600 },
      ),
    ).toEqual({ zoom: 1, pan: { x: 200, y: 200 } });
  });

  it("fits bounds inside the viewport with padding", () => {
    const view = fitCanvasBounds(
      { x: 0, y: 0, width: 1000, height: 500 },
      { width: 800, height: 600 },
    );

    expect(view.zoom).toBeCloseTo(0.704);
    expect(view.pan.x).toBeCloseTo(48);
    expect(view.pan.y).toBeCloseTo(124);
  });
});
