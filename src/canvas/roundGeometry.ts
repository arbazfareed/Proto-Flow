import type { Widget } from "../project/schema";

/** Whole-pixel position and size (at least 1 px); rotation keeps one decimal. */
export function roundGeometry<T extends Partial<Pick<Widget, "x" | "y" | "width" | "height" | "rotation">>>(geometry: T): T {
  return {
    ...geometry,
    ...(geometry.x === undefined ? {} : { x: Math.round(geometry.x) }),
    ...(geometry.y === undefined ? {} : { y: Math.round(geometry.y) }),
    ...(geometry.width === undefined ? {} : { width: Math.max(1, Math.round(geometry.width)) }),
    ...(geometry.height === undefined ? {} : { height: Math.max(1, Math.round(geometry.height)) }),
    ...(geometry.rotation === undefined ? {} : { rotation: Math.round(geometry.rotation * 10) / 10 }),
  };
}
