import { DEFAULT_DEVICE_PRESET, DEVICE_PRESETS, toScreenDevice } from "../devices/catalog";
import type { DevicePreset } from "../devices/types";
import { createDefaultBreakpoints } from "../project/responsive";
import { createEmptyProject, parseProject } from "../project/schema";
import type { Project, Screen, Widget } from "../project/schema";

export const STARTER_TEMPLATE_IDS = [
  "blank",
  "mobile-app",
  "dashboard",
  "landing-page",
  "form-flow",
  "data-table",
  "responsive-web",
] as const;

export type StarterTemplateId = (typeof STARTER_TEMPLATE_IDS)[number];

function widget(
  type: string,
  label: string,
  x: number,
  y: number,
  width: number,
  height: number,
  props: Record<string, unknown> = {},
  style: Widget["style"] = ["text", "heading", "paragraph", "label", "link"].includes(type)
    ? { fill: "#e9e9ec", fillOpacity: 1, stroke: null, strokeWidth: 0 }
    : {},
): Widget {
  return {
    id: crypto.randomUUID(),
    type,
    name: label,
    x,
    y,
    width,
    height,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    zIndex: 0,
    style,
    props: { label, ...props },
  };
}

function text(label: string, x: number, y: number, width: number, height: number, fontSize = 22) {
  return widget(
    "heading",
    label,
    x,
    y,
    width,
    height,
    { text: label, fontFamily: "Arial", fontSize, fontWeight: "bold", align: "left", lineHeight: 1.2 },
    { fill: "#e9e9ec", fillOpacity: 1, stroke: null, strokeWidth: 0 },
  );
}

function button(label: string, x: number, y: number, width = 150) {
  return widget(
    "button",
    label,
    x,
    y,
    width,
    44,
    { label },
    { fill: "#7758d7", fillOpacity: 1, stroke: null, strokeWidth: 0, cornerRadius: 8 },
  );
}

function presetById(id: string): DevicePreset {
  const preset = DEVICE_PRESETS.find((item) => item.id === id);
  if (!preset) throw new Error(`The required starter device "${id}" is unavailable.`);
  return preset;
}

function createStarterScreen(
  project: Project,
  name: string,
  device: DevicePreset,
  widgets: Widget[],
  responsive = false,
): Project {
  const screen: Screen = {
    ...project.screens[0],
    id: crypto.randomUUID(),
    name,
    device: toScreenDevice(device),
    inputMode: device.category === "phone" || device.category === "tablet" ? "touch" : "mouse",
    breakpoints: createDefaultBreakpoints(device.viewport.width, device.viewport.height),
    widgets,
  };
  return parseProject({
    ...project,
    name,
    screens: [screen],
    startScreenId: screen.id,
    ...(responsive
      ? {
          screens: [{
            ...screen,
            widgets: widgets.map((item, index) => index === 0
              ? {
                  ...item,
                  overrides: {
                    mobile: { width: Math.min(item.width, 340), x: 24 },
                    tablet: { width: Math.min(item.width, 640), x: 48 },
                  },
                }
              : item),
          }],
        }
      : {}),
  });
}

export function createStarterProject(templateId: StarterTemplateId): Project {
  const project = createEmptyProject();
  switch (templateId) {
    case "blank":
      return project;
    case "mobile-app":
      return createStarterScreen(project, "Mobile app", presetById("iphone-15"), [
        text("Good morning", 28, 92, 330, 42, 28),
        text("Your day, at a glance.", 28, 146, 330, 28, 16),
        widget("card", "Today", 24, 208, 345, 160, { label: "Today", subtitle: "3 things on your list" }),
        button("Get started", 24, 394, 345),
        widget("bottom-nav", "Home", 24, 760, 345, 60, { label: "Home" }),
      ]);
    case "dashboard":
      return createStarterScreen(project, "Dashboard", presetById("desktop-1440-900"), [
        text("Overview", 48, 38, 500, 48, 32),
        widget("metric-card", "Revenue", 48, 112, 270, 130, { label: "Revenue", value: "$24,800", trend: "+12.8%" }),
        widget("metric-card", "Orders", 342, 112, 270, 130, { label: "Orders", value: "1,284", trend: "+8.2%" }),
        widget("chart", "Weekly activity", 48, 278, 564, 300, { label: "Weekly activity" }),
        widget("table", "Recent activity", 650, 112, 700, 466, { label: "Recent activity" }),
      ]);
    case "landing-page":
      return createStarterScreen(project, "Landing page", presetById("desktop-1920-1080"), [
        text("Build something\nremarkable.", 180, 170, 720, 140, 52),
        widget("paragraph", "A product that moves with you.", 180, 340, 620, 56, {
          text: "A thoughtful place to bring your best ideas to life.",
          fontFamily: "Arial",
          fontSize: 20,
          fontWeight: "normal",
          align: "left",
          lineHeight: 1.4,
        }),
        button("Explore the product", 180, 432, 210),
        widget("card", "Product preview", 1030, 170, 650, 540, { label: "Product preview" }),
      ]);
    case "form-flow": {
      const stepOne = widget("dynamic-panel", "Step 1: Details", 80, 90, 520, 440, {
        label: "Step 1: Details",
        activeStateId: "",
        states: [],
      });
      const firstState = {
        id: crypto.randomUUID(),
        name: "Your details",
        widgets: [
          text("Create your account", 24, 24, 420, 42, 28),
          widget("input", "Full name", 24, 100, 440, 44, { label: "Full name", placeholder: "Alex Morgan" }),
          widget("input", "Email address", 24, 164, 440, 44, { label: "Email address", placeholder: "you@example.com" }),
          button("Continue", 24, 236, 180),
        ],
      };
      const secondState = {
        id: crypto.randomUUID(),
        name: "Confirmation",
        widgets: [
          text("You're all set", 24, 24, 420, 42, 28),
          widget("paragraph", "Review your details to finish.", 24, 86, 440, 42, {
            text: "Review your details to finish.",
            fontFamily: "Arial",
            fontSize: 16,
            fontWeight: "normal",
            align: "left",
            lineHeight: 1.2,
          }),
          button("Finish", 24, 160, 180),
        ],
      };
      const panel = {
        ...stepOne,
        props: {
          ...stepOne.props,
          states: [firstState, secondState],
          activeStateId: firstState.id,
        },
      };
      return createStarterScreen(project, "Form flow", DEFAULT_DEVICE_PRESET, [
        text("A simple sign-up flow", 80, 34, 520, 42, 28),
        panel,
      ]);
    }
    case "data-table": {
      const row = widget("text", "Item name", 12, 12, 200, 28, {
        text: "{{item.name}}",
        fontFamily: "Arial",
        fontSize: 16,
        fontWeight: "normal",
        align: "left",
        lineHeight: 1.2,
      });
      const repeater = widget("repeater", "Team members", 80, 120, 720, 340, {
        label: "Team members",
        rowTemplate: { widgets: [row] },
        dataset: [
          { name: "Alex Morgan", role: "Design" },
          { name: "Sam Rivera", role: "Engineering" },
          { name: "Taylor Kim", role: "Product" },
        ],
        layout: "vertical",
        gap: 12,
        itemBinding: {},
      });
      return createStarterScreen(project, "Data table", DEFAULT_DEVICE_PRESET, [
        text("Team members", 80, 48, 500, 42, 28),
        repeater,
      ]);
    }
    case "responsive-web":
      return createStarterScreen(project, "Responsive web", DEFAULT_DEVICE_PRESET, [
        text("One design. Every screen.", 48, 72, 900, 60, 38),
        widget("paragraph", "Switch breakpoints to explore your responsive layout.", 48, 152, 720, 40, {
          text: "Switch breakpoints to explore your responsive layout.",
          fontFamily: "Arial",
          fontSize: 18,
          fontWeight: "normal",
          align: "left",
          lineHeight: 1.3,
        }),
        button("Get started", 48, 230, 180),
        widget("card", "Flexible content", 48, 320, 420, 240, { label: "Flexible content" }),
      ], true);
  }
}
