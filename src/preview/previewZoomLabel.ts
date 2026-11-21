// B56: the Preview slider scales each device on top of an automatic fit-to-window size, so
// "Zoom 100%" was misleading (a 1,440 px desktop really showed at about 89%). It is a fit scale.
export function previewFitLabel(scalePercent: number): string {
  return `Fit ${scalePercent}%`;
}

export const PREVIEW_FIT_HINT =
  "100% fits each device to the window. Drag right to enlarge or left to shrink.";
