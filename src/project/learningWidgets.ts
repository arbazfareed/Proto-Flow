import { getWidgetIconDefinition } from "../layout/widgetIcons";

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
    note: "Places child elements in a horizontal row with consistent spacing.",
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
    note: "A self-contained content surface for an image, details, and action.",
  },
  chart: {
    element: "<figure><svg role=\"img\">…</svg><figcaption>…</figcaption></figure>",
    css: "width: 100%; height: 100%;",
    note: "An accessible data visualization with a descriptive caption.",
  },
  alert: {
    element: "<aside role=\"status\">",
    css: "display: flex; align-items: flex-start; gap: 12px;",
    note: "Communicates an important status or message to the user.",
  },
  video: {
    element: "<figure><video controls></video></figure>",
    css: "position: relative; aspect-ratio: 16 / 9;",
    note: "A responsive media frame with a poster and playback controls.",
  },
  skeleton: {
    element: "<div aria-busy=\"true\">",
    css: "background: linear-gradient(...); animation: shimmer 1.4s infinite;",
    note: "Previews the shape of loading content and supports reduced motion.",
  },
  "web-app": {
    element: "<svg role=\"img\">",
    css: "width: 24px; height: 24px;",
    note: "A browser-window icon for web application mockups.",
  },
  "mobile-app": {
    element: "<svg role=\"img\">",
    css: "width: 24px; height: 24px;",
    note: "A mobile-app mark for phone screens, launchers, and device mockups.",
  },
  button: {
    element: "<button type=\"button\">",
    css: "display: inline-flex; align-items: center; gap: 8px;",
    note: "An actionable control with a clear label and keyboard focus.",
  },
  "icon-button": {
    element: "<button aria-label=\"Add item\">",
    css: "display: inline-grid; place-items: center;",
    note: "A compact action; give icon-only buttons an accessible name.",
  },
  input: {
    element: "<label><span>…</span><input></label>",
    css: "width: 100%; min-height: 40px;",
    note: "A single-line field for entering or editing a value.",
  },
  textarea: {
    element: "<label><span>…</span><textarea></textarea></label>",
    css: "min-height: 96px; resize: vertical;",
    note: "A multiline field for longer text.",
  },
  select: {
    element: "<label><span>…</span><select></select></label>",
    css: "appearance: none; padding-inline: 12px;",
    note: "A labeled control for choosing one option from a list.",
  },
  checkbox: {
    element: "<label><input type=\"checkbox\"> …</label>",
    css: "accent-color: currentColor;",
    note: "A binary choice that can be toggled independently.",
  },
  radio: {
    element: "<label><input type=\"radio\"> …</label>",
    css: "accent-color: currentColor;",
    note: "One mutually exclusive choice in a named option group.",
  },
  toggle: {
    element: "<button role=\"switch\" aria-checked=\"false\">",
    css: "border-radius: 999px; transition: background .2s;",
    note: "A switch for an immediate on/off setting.",
  },
  slider: {
    element: "<label><input type=\"range\"> …</label>",
    css: "accent-color: currentColor;",
    note: "A range input for choosing a value along a continuous scale.",
  },
  "date-picker": {
    element: "<label><input type=\"date\"> …</label>",
    css: "min-height: 40px; padding-inline: 10px;",
    note: "A date field using the browser's native date control.",
  },
  "file-upload": {
    element: "<label><input type=\"file\"> …</label>",
    css: "display: grid; place-items: center; border: 1px dashed;",
    note: "A drop zone paired with a real file input.",
  },
  search: {
    element: "<form role=\"search\"><input type=\"search\"></form>",
    css: "display: flex; align-items: center; gap: 8px;",
    note: "A search field with a clear search purpose and submit action.",
  },
  form: {
    element: "<form>…</form>",
    css: "display: grid; gap: 16px;",
    note: "A semantic group of labeled inputs and a submit action.",
  },
  image: {
    element: "<img alt=\"…\">",
    css: "width: 100%; height: 100%; object-fit: cover;",
    note: "A responsive image; provide useful alternative text when meaningful.",
  },
  avatar: {
    element: "<img alt=\"Alex Morgan\">",
    css: "width: 40px; aspect-ratio: 1; border-radius: 50%;",
    note: "A person or account identity marker, with initials as a fallback.",
  },
  grid: {
    element: "<div>",
    css: "display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;",
    note: "Arranges related content in aligned rows and columns.",
  },
  navbar: {
    element: "<nav aria-label=\"Main\">",
    css: "display: flex; align-items: center; justify-content: space-between;",
    note: "A primary navigation region for moving around the experience.",
  },
  sidebar: {
    element: "<nav aria-label=\"Sidebar\">",
    css: "display: flex; flex-direction: column; gap: 6px;",
    note: "A vertical navigation menu for a section or workspace.",
  },
  tabs: {
    element: "<div role=\"tablist\">",
    css: "display: flex; gap: 4px; border-bottom: 1px solid;",
    note: "Switches between related panels without leaving the current context.",
  },
  breadcrumb: {
    element: "<nav aria-label=\"Breadcrumb\"><ol>…</ol></nav>",
    css: "display: flex; align-items: center; gap: 8px;",
    note: "Shows the current location and its parent pages.",
  },
  pagination: {
    element: "<nav aria-label=\"Pagination\">",
    css: "display: inline-flex; gap: 4px;",
    note: "Moves through a multi-page collection of results.",
  },
  footer: {
    element: "<footer>",
    css: "display: flex; align-items: center; justify-content: space-between;",
    note: "Groups secondary navigation, legal links, and supporting details.",
  },
  table: {
    element: "<table><thead>…</thead><tbody>…</tbody></table>",
    css: "width: 100%; border-collapse: collapse;",
    note: "Presents comparable records in labeled rows and columns.",
  },
  list: {
    element: "<ul><li>…</li></ul>",
    css: "display: grid; gap: 8px; padding-inline-start: 1.25rem;",
    note: "Groups related items in a semantic ordered or unordered list.",
  },
  toast: {
    element: "<div role=\"status\" aria-live=\"polite\">",
    css: "position: fixed; inset: auto 16px 16px auto;",
    note: "Announces brief feedback without interrupting the current task.",
  },
  spinner: {
    element: "<div role=\"status\" aria-label=\"Loading\">",
    css: "width: 24px; aspect-ratio: 1; border-radius: 50%;",
    note: "Signals ongoing work; pair it with readable loading text.",
  },
  "progress-bar": {
    element: "<progress value=\"70\" max=\"100\">",
    css: "width: 100%; accent-color: currentColor;",
    note: "Shows progress toward a known completion point.",
  },
  badge: {
    element: "<span>",
    css: "display: inline-flex; align-items: center; border-radius: 999px;",
    note: "Adds a compact status, count, or category label.",
  },
  "metric-card": {
    element: "<article><dl><dt>…</dt><dd>…</dd></dl></article>",
    css: "display: grid; gap: 6px;",
    note: "Highlights one key number and its context or recent trend.",
  },
  "profile-card": {
    element: "<article>",
    css: "display: flex; align-items: center; gap: 12px;",
    note: "Combines an avatar with a person's name and supporting detail.",
  },
  "empty-state": {
    element: "<section aria-labelledby=\"empty-title\">",
    css: "display: grid; justify-items: center; gap: 12px;",
    note: "Explains an empty view and offers a useful next action.",
  },
  accordion: {
    element: "<details><summary>…</summary>…</details>",
    css: "border-bottom: 1px solid;",
    note: "Reveals supporting content on demand while keeping a page compact.",
  },
  "code-block": {
    element: "<pre><code>…</code></pre>",
    css: "overflow: auto; font-family: ui-monospace, monospace;",
    note: "Displays preformatted code while preserving whitespace.",
  },
};

const CATEGORY_GUIDES = {
  advanced: {
    element: "<section>",
    css: "position: relative; overflow: hidden;",
    note: "Organizes advanced interactive content into a reusable section.",
  },
  container: {
    element: "<section>",
    css: "position: relative; box-sizing: border-box;",
    note: "Groups related content and provides a clear layout boundary.",
  },
  data: {
    element: "<section>",
    css: "display: grid; gap: 12px;",
    note: "Presents structured information for quick comparison and scanning.",
  },
  display: {
    element: "<div>",
    css: "display: inline-flex; align-items: center;",
    note: "Adds a focused visual cue or supporting piece of interface content.",
  },
  form: {
    element: "<label>",
    css: "display: grid; gap: 6px;",
    note: "Pairs an interactive input with a readable label and state.",
  },
  layout: {
    element: "<div>",
    css: "position: relative; box-sizing: border-box;",
    note: "Controls how neighboring interface elements are arranged.",
  },
  media: {
    element: "<figure>",
    css: "max-width: 100%;",
    note: "Embeds visual or audiovisual content in a responsive frame.",
  },
  navigation: {
    element: "<nav>",
    css: "display: flex; align-items: center; gap: 8px;",
    note: "Helps people find and move between related parts of the experience.",
  },
  shape: {
    element: "<svg>",
    css: "display: block; overflow: visible;",
    note: "A vector shape that can be styled, positioned, and composed.",
  },
  symbol: {
    element: "<div>",
    css: "display: block; box-sizing: border-box;",
    note: "A reusable component instance that stays connected to its source.",
  },
  text: {
    element: "<p>",
    css: "max-width: 100%; line-height: 1.5;",
    note: "Communicates readable text content with deliberate hierarchy.",
  },
  widget: {
    element: "<button>",
    css: "box-sizing: border-box; cursor: pointer;",
    note: "A reusable interface control with editable appearance and behavior.",
  },
} as const;

function humanize(type: string): string {
  return type
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function getWidgetLearningGuide(type: string, label = humanize(type)): WidgetLearningGuide {
  const guide = GUIDES[type];
  if (guide) return guide;
  const categoryGuide = CATEGORY_GUIDES[getWidgetIconDefinition(type).category] ?? CATEGORY_GUIDES.widget;
  return {
    ...categoryGuide,
    note: `${label}: ${categoryGuide.note}`,
  };
}
