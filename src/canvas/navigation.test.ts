import { describe, expect, it } from "vitest";
import {
  centerCanvasView,
  clampCanvasZoom,
  fitCanvasBounds,
  getVisibleGridSpacing,
  getWidgetBounds,
  normalizeCanvasViewport,
  worldToScreen,
  zoomAroundPointer,
} from "./navigation";

describe("canvas navigation math | geometry-math", () => {
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

  it("TC-FAIL-201A preserves a fractional zoom anchor through repeated clamped gestures", () => {
    const pointer = { x: 317.375, y: 226.625 };
    let view = { zoom: 1, pan: { x: -0.125, y: 13.0625 } };
    for (let index = 0; index < 500; index += 1) {
      const target = index % 2 === 0 ? view.zoom * 1.0003 : view.zoom / 1.0003;
      view = zoomAroundPointer(view, pointer, target);
    }
    for (const bound of [0.1, 4]) {
      const bounded = zoomAroundPointer(view, pointer, bound);
      expect(bounded.zoom).toBe(bound);
      expect(worldToScreen(
        { x: (pointer.x - view.pan.x) / view.zoom, y: (pointer.y - view.pan.y) / view.zoom },
        bounded,
      ).x).toBeCloseTo(pointer.x, 3);
      expect(worldToScreen(
        { x: (pointer.x - view.pan.x) / view.zoom, y: (pointer.y - view.pan.y) / view.zoom },
        bounded,
      ).y).toBeCloseTo(pointer.y, 3);
    }
  });

  it("TC-FAIL-201C clamps zero-sized observed viewports before rendering", () => {
    expect(normalizeCanvasViewport({ width: 0, height: 0 })).toEqual({
      width: 1,
      height: 1,
    });
  });

  it("TC-FAIL-202B bounds low-zoom grid work to visible screen spacing", () => {
    const spacing = getVisibleGridSpacing(10, 0.1);
    expect(spacing * 0.1).toBeGreaterThanOrEqual(8);
    expect(Math.ceil(1200 / (spacing * 0.1))).toBeLessThanOrEqual(150);
    expect(() => getVisibleGridSpacing(0, 0.1)).toThrow("finite positive");
  });

  it("TC-FAIL-204B maps inline-editor positions into screen coordinates at zoom bounds", () => {
    expect(worldToScreen({ x: 50, y: 40 }, { zoom: 0.1, pan: { x: 20, y: -10 } }))
      .toEqual({ x: 25, y: -6 });
    expect(worldToScreen({ x: 50, y: 40 }, { zoom: 4, pan: { x: 20, y: -10 } }))
      .toEqual({ x: 220, y: 150 });
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
