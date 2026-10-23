export interface WidgetLearningGuide {
  element: string;
  css: string;
  note: string;
}

const GUIDES: Record<string, WidgetLearningGuide> = {
  container: {
    element: "<div>",
    css: "display: block; position: relative;",
    note: "A neutral wrapper for organizing related widgets.",
  },
  "flex-row": {
    element: "<div>",
    css: "display: flex; flex-direction: row; gap: 12px;",
    note: "Arranges child elements in a horizontal flex layout.",
  },
  "flex-column": {
    element: "<div>",
    css: "display: flex; flex-direction: column; gap: 12px;",
    note: "Stacks child elements vertically with consistent spacing.",
  },
  spacer: {
    element: "<div aria-hidden=\"true\">",
    css: "flex: 0 0 24px;",
    note: "Adds deliberate spacing without visual content.",
  },
  card: {
    element: "<article>",
    css: "display: flex; flex-direction: column; gap: 12px;",
    note: "A self-contained surface for a title, image, description, and action.",
  },
  chart: {
    element: "<figure><svg>",
    css: "width: 100%; height: 100%;",
    note: "A compact, accessible inline SVG data visualization.",
  },
  alert: {
    element: "<aside role=\"status\">",
    css: "display: flex; align-items: flex-start; gap: 12px;",
    note: "Communicates an important status or message to the user.",
  },
  video: {
    element: "<figure>",
    css: "position: relative; aspect-ratio: 16 / 9;",
    note: "A responsive media frame with a poster and play affordance.",
  },
  skeleton: {
    element: "<div aria-busy=\"true\">",
    css: "background: linear-gradient(...); animation: shimmer 1.4s infinite;",
    note: "Indicates content is loading; respects reduced-motion preferences.",
  },
  "mobile-app": {
    element: "<svg role=\"img\">",
    css: "width: 24px; height: 24px;",
    note: "A neutral mobile-app icon for app and device mockups.",
  },
  "web-app": {
    element: "<svg role=\"img\">",
    css: "width: 24px; height: 24px;",
    note: "A browser-window icon for web application mockups.",
  },
};

export function getWidgetLearningGuide(type: string): WidgetLearningGuide {
  return GUIDES[type] ?? {
    element: "<div>",
    css: "position: absolute; box-sizing: border-box;",
    note: "A reusable UI element styled with the selected widget properties.",
  };
}
