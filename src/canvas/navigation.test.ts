import { describe, expect, it } from "vitest";
import {
  applyCanvasWheel,
  keyboardZoomStep,
  isZoomToFitAllShortcut,
  centerCanvasView,
  clampCanvasZoom,
  fitCanvasBounds,
  getCanvasViewportBounds,
  getVisibleGridSpacing,
  getWidgetBounds,
  intersectsCanvasViewport,
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

  it("converts the viewport to stage coordinates and applies a screen-space buffer", () => {
    expect(getCanvasViewportBounds(
      { width: 800, height: 600 },
      { zoom: 2, pan: { x: -100, y: 40 } },
    )).toEqual({
      x: -50,
      y: -120,
      width: 600,
      height: 500,
    });
    expect(() => getCanvasViewportBounds(
      { width: 800, height: 600 },
      { zoom: 0, pan: { x: 0, y: 0 } },
    )).toThrow("zoom must be positive");
  });

  it("culls offscreen widgets while retaining rotated bounds that enter the viewport", () => {
    const viewport = { x: 0, y: 0, width: 100, height: 100 };
    expect(intersectsCanvasViewport(
      { x: 120, y: 20, width: 30, height: 30 },
      viewport,
    )).toBe(false);
    expect(intersectsCanvasViewport(
      { x: 104, y: 40, width: 20, height: 20, rotation: 45 },
      viewport,
    )).toBe(true);
    expect(intersectsCanvasViewport(
      { x: 100, y: 10, width: 1, height: 10 },
      viewport,
    )).toBe(true);
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

describe("canvas wheel and trackpad scrolling | B29", () => {
  const view = { zoom: 1.5, pan: { x: -80, y: 45 } };
  const pointer = { x: 310, y: 225 };
  const wheel = { deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, metaKey: false, shiftKey: false };

  it("pans in the scroll direction on a plain scroll and keeps the zoom", () => {
    expect(applyCanvasWheel(view, { ...wheel, deltaY: 100 }, pointer))
      .toEqual({ zoom: 1.5, pan: { x: -80, y: -55 } });
    expect(applyCanvasWheel(view, { ...wheel, deltaX: -30, deltaY: 20 }, pointer))
      .toEqual({ zoom: 1.5, pan: { x: -50, y: 25 } });
  });

  it("pans sideways on Shift+scroll, without swapping an already sideways scroll", () => {
    expect(applyCanvasWheel(view, { ...wheel, deltaY: 100, shiftKey: true }, pointer))
      .toEqual({ zoom: 1.5, pan: { x: -180, y: 45 } });
    expect(applyCanvasWheel(view, { ...wheel, deltaX: 40, shiftKey: true }, pointer))
      .toEqual({ zoom: 1.5, pan: { x: -120, y: 45 } });
  });

  it("zooms around the pointer on Ctrl or Cmd+scroll", () => {
    const zoomed = applyCanvasWheel(view, { ...wheel, deltaY: -100, ctrlKey: true }, pointer);
    expect(zoomed).toEqual(zoomAroundPointer(view, pointer, 1.5 * Math.pow(1.01, 12)));
    expect(applyCanvasWheel(view, { ...wheel, deltaY: -100, metaKey: true }, pointer)).toEqual(zoomed);
    expect(zoomed.zoom).toBeGreaterThan(view.zoom);
  });

  it("caps one wheel notch so three notches cannot jump from 58% to 400% (B30)", () => {
    let current = { zoom: 0.58, pan: { x: 0, y: 0 } };
    for (let notch = 0; notch < 3; notch += 1) {
      current = applyCanvasWheel(current, { ...wheel, deltaY: -100, ctrlKey: true }, pointer);
    }
    expect(current.zoom).toBeGreaterThan(0.58);
    expect(current.zoom).toBeLessThan(0.58 * 1.15 ** 3);
    const out = applyCanvasWheel({ zoom: 1, pan: { x: 0, y: 0 } }, { ...wheel, deltaY: 100, ctrlKey: true }, pointer);
    expect(out.zoom).toBeCloseTo(1 / Math.pow(1.01, 12));
  });

  it("keeps small trackpad pinch deltas smooth and uncapped (B30)", () => {
    const pinch = applyCanvasWheel({ zoom: 1, pan: { x: 0, y: 0 } }, { ...wheel, deltaY: -4, ctrlKey: true }, pointer);
    expect(pinch.zoom).toBeCloseTo(Math.pow(1.01, 4));
  });

  it("converts line and page wheel deltas to pixels", () => {
    expect(applyCanvasWheel(view, { ...wheel, deltaY: 3, deltaMode: 1 }, pointer).pan.y).toBe(45 - 48);
    expect(applyCanvasWheel(view, { ...wheel, deltaY: 1, deltaMode: 2 }, pointer).pan.y).toBe(45 - 800);
  });

  it("maps Ctrl+= / Ctrl++ to zoom in and Ctrl+- to zoom out (B31)", () => {
    expect(keyboardZoomStep({ key: "=" })).toBe(0.1);
    expect(keyboardZoomStep({ key: "+" })).toBe(0.1);
    expect(keyboardZoomStep({ key: "-" })).toBe(-0.1);
    expect(keyboardZoomStep({ key: "_" })).toBe(-0.1);
    expect(keyboardZoomStep({ key: "0" })).toBe(0);
    expect(keyboardZoomStep({ key: "=", altKey: true })).toBe(0);
  });
});

describe("isZoomToFitAllShortcut (B31)", () => {
  it("matches Shift+1 by the physical key, on any layout", () => {
    expect(isZoomToFitAllShortcut({ key: "!", code: "Digit1", shiftKey: true })).toBe(true);
    // AZERTY: Shift+& types "1" but is still the same physical key.
    expect(isZoomToFitAllShortcut({ key: "1", code: "Digit1", shiftKey: true })).toBe(true);
    expect(isZoomToFitAllShortcut({ key: "!", shiftKey: true })).toBe(true);
  });

  it("ignores plain 1, other keys, and any use of Ctrl, Cmd or Alt", () => {
    expect(isZoomToFitAllShortcut({ key: "1", code: "Digit1" })).toBe(false);
    expect(isZoomToFitAllShortcut({ key: "@", code: "Digit2", shiftKey: true })).toBe(false);
    expect(isZoomToFitAllShortcut({ key: "!", code: "Digit1", shiftKey: true, ctrlKey: true })).toBe(false);
    expect(isZoomToFitAllShortcut({ key: "!", code: "Digit1", shiftKey: true, metaKey: true })).toBe(false);
    expect(isZoomToFitAllShortcut({ key: "!", code: "Digit1", shiftKey: true, altKey: true })).toBe(false);
  });
});
