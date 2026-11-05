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
  "login",
  "storefront",
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

function text(
  label: string,
  x: number,
  y: number,
  width: number,
  height: number,
  fontSize = 22,
  color = "#20222b",
) {
  return widget(
    "heading",
    label,
    x,
    y,
    width,
    height,
    { text: label, fontFamily: "Arial", fontSize, fontWeight: "bold", align: "left", lineHeight: 1.2 },
    { fill: color, fillOpacity: 1, stroke: null, strokeWidth: 0 },
  );
}

function bodyText(
  label: string,
  x: number,
  y: number,
  width: number,
  height: number,
  color = "#5c6472",
  fontSize = 14,
) {
  return widget(
    "text",
    label,
    x,
    y,
    width,
    height,
    { text: label, fontFamily: "Arial", fontSize, fontWeight: "normal", align: "left", lineHeight: 1.4 },
    { fill: color, fillOpacity: 1, stroke: null, strokeWidth: 0 },
  );
}

function surface(label: string, x: number, y: number, width: number, height: number, fill = "#20222b") {
  return widget(
    "rectangle",
    label,
    x,
    y,
    width,
    height,
    { label },
    { fill, fillOpacity: 1, stroke: "#343743", strokeWidth: 1, cornerRadius: 12 },
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
        text("Overview", 48, 34, 500, 44, 30),
        bodyText("Here’s what’s happening with your workspace today.", 48, 80, 650, 24),
        widget("metric-card", "Revenue", 48, 132, 300, 138, { label: "Total revenue", value: "$24,800", trend: "+12.8%" }),
        widget("metric-card", "Orders", 370, 132, 300, 138, { label: "Orders this month", value: "1,284", trend: "+8.2%" }),
        widget("chart", "Weekly activity", 48, 298, 622, 350, { label: "Weekly activity" }),
        widget("table", "Recent activity", 698, 132, 650, 516, { label: "Recent activity" }),
      ]);
    case "landing-page":
      return createStarterScreen(project, "Landing page", presetById("desktop-1920-1080"), [
        text("Build something\nremarkable.", 180, 170, 720, 140, 52),
        bodyText("A thoughtful place to bring your best ideas to life.", 180, 340, 620, 56, "#5c6472", 20),
        button("Explore the product", 180, 432, 210),
        widget("card", "Product preview", 1030, 170, 650, 540, { label: "Product preview" }),
      ]);
    case "form-flow": {
      const panelX = 670;
      const panelY = 106;
      const contentX = panelX + 28;
      const contentY = panelY + 24;
      const stepOne = widget("dynamic-panel", "Step 1: Details", panelX, panelY, 470, 560, {
        label: "Step 1: Details",
        color: "#a9afbd",
        activeStateId: "",
        states: [],
      }, { fill: "#20222b", fillOpacity: 1, stroke: "#343743", strokeWidth: 1, cornerRadius: 12 });
      const firstState = {
        id: crypto.randomUUID(),
        name: "Your details",
        widgets: [
          text("Create your account", contentX, contentY, 390, 40, 26, "#f2f1f8"),
          bodyText("Start with the basics. You can add the rest later.", contentX, contentY + 44, 410, 38, "#a9afbd"),
          widget("input", "Full name", contentX, contentY + 108, 410, 46, { label: "Full name", placeholder: "Alex Morgan" }),
          widget("input", "Email address", contentX, contentY + 182, 410, 46, { label: "Email address", placeholder: "you@example.com" }),
          button("Continue", contentX, contentY + 262, 410),
          bodyText("By continuing, you agree to our Terms and Privacy Policy.", contentX, contentY + 326, 410, 34, "#81899a"),
        ],
      };
      const secondState = {
        id: crypto.randomUUID(),
        name: "Confirmation",
        widgets: [
          text("You're all set", contentX, contentY, 410, 42, 28, "#f2f1f8"),
          bodyText("Your account is ready. Review your details to finish.", contentX, contentY + 56, 410, 42, "#a9afbd", 16),
          button("Finish", contentX, contentY + 184, 410),
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
        surface("Welcome panel", 300, 106, 320, 560, "#252335"),
        text("A simple sign-up flow", 300, 34, 840, 42, 28),
        text("Make room for\nwhat’s next.", 332, 202, 260, 100, 30, "#f2f1f8"),
        bodyText("A calmer way to turn your ideas into something real.", 332, 320, 252, 68, "#a9afbd"),
        widget("badge", "Step 1 of 2", 332, 440, 112, 30, {
          label: "STEP 1 OF 2",
          color: "#f2f1f8",
        }, { fill: "#44365e", fillOpacity: 1, stroke: "#5a487c", strokeWidth: 1, cornerRadius: 10 }),
        panel,
      ]);
    }
    case "data-table": {
      const rowBackground = surface("Member row background", 8, 8, 1264, 56);
      const rowDivider = widget("rectangle", "Member row divider", 8, 71, 1264, 1, {
        label: "Member row divider",
      }, { fill: "#343743", fillOpacity: 1, stroke: null, strokeWidth: 0 });
      const row = widget("text", "Member name", 22, 16, 380, 28, {
        text: "{{item.name}}",
        fontFamily: "Arial",
        fontSize: 16,
        fontWeight: "bold",
        align: "left",
        lineHeight: 1.2,
      });
      const role = widget("text", "Member role", 420, 16, 380, 28, {
        text: "{{item.role}}",
        fontFamily: "Arial",
        fontSize: 14,
        fontWeight: "normal",
        align: "left",
        lineHeight: 1.2,
      });
      const status = widget("badge", "Member status", 1082, 15, 150, 30, {
        label: "{{item.status}}",
        color: "#f2f1f8",
      }, { fill: "#33445f", fillOpacity: 1, stroke: "#445a79", strokeWidth: 1, cornerRadius: 10 });
      const repeater = widget("repeater", "Team members", 80, 268, 1280, 216, {
        label: "Team members",
        rowTemplate: { widgets: [rowBackground, row, role, status, rowDivider] },
        dataset: [
          { name: "Alex Morgan", role: "Product designer", status: "Active" },
          { name: "Sam Rivera", role: "Frontend engineer", status: "Active" },
          { name: "Taylor Kim", role: "Product manager", status: "Invited" },
        ],
        layout: "vertical",
        gap: 0,
        rowHeight: 72,
        itemBinding: {},
      });
      return createStarterScreen(project, "Data table", DEFAULT_DEVICE_PRESET, [
        text("Team", 80, 48, 500, 42, 28),
        bodyText("Manage access and keep your workspace in sync.", 80, 94, 590, 28),
        widget("search", "Search team members", 80, 152, 410, 46, {
          label: "Search members",
          placeholder: "Search by name or role",
        }),
        button("Invite member", 1204, 152, 156),
        surface("Table header", 80, 216, 1280, 52, "#292b36"),
        bodyText("NAME", 102, 232, 380, 20, "#9098a9"),
        bodyText("ROLE", 500, 232, 380, 20, "#9098a9"),
        bodyText("STATUS", 1162, 232, 150, 20, "#9098a9"),
        repeater,
      ]);
    }
    case "responsive-web":
      return createStarterScreen(project, "Responsive web", DEFAULT_DEVICE_PRESET, [
        text("One design. Every screen.", 48, 72, 900, 60, 38),
        bodyText("Switch breakpoints to explore your responsive layout.", 48, 152, 720, 40, "#5c6472", 18),
        button("Get started", 48, 230, 180),
        widget("card", "Flexible content", 48, 320, 420, 240, { label: "Flexible content" }),
      ], true);
    case "login": {
      const loginCard = surface("Sign in card", 705, 112, 420, 570, "#20222b");
      return createStarterScreen(project, "Sign in", DEFAULT_DEVICE_PRESET, [
        surface("Brand panel", 315, 112, 330, 570, "#272337"),
        text("protoflow", 347, 154, 250, 36, 22, "#f2f1f8"),
        text("Your next\nbig idea starts here.", 347, 260, 270, 108, 30, "#f2f1f8"),
        bodyText("Sign in to pick up right where you left off.", 347, 390, 250, 58, "#a9afbd"),
        widget("badge", "Prototype faster", 347, 520, 160, 32, {
          label: "PROTOTYPE FASTER",
          color: "#e5d9ff",
        }, { fill: "#44365e", fillOpacity: 1, stroke: "#5a487c", strokeWidth: 1, cornerRadius: 10 }),
        loginCard,
        text("Welcome back", 745, 160, 340, 40, 28, "#f2f1f8"),
        bodyText("Enter your details to access your workspace.", 745, 208, 340, 46, "#a9afbd"),
        widget("input", "Email address", 745, 292, 340, 48, {
          label: "Email address",
          placeholder: "you@example.com",
          type: "email",
        }),
        widget("input", "Password", 745, 370, 340, 48, {
          label: "Password",
          placeholder: "Enter your password",
          type: "password",
        }),
        widget("checkbox", "Remember me", 745, 444, 150, 24, { label: "Remember me" }),
        widget("link", "Forgot password?", 939, 446, 146, 22, {
          text: "Forgot password?",
          fontFamily: "Arial",
          fontSize: 12,
          fontWeight: "normal",
          align: "right",
        }, { fill: "#bca9ff", fillOpacity: 1, stroke: null, strokeWidth: 0 }),
        button("Sign in", 745, 494, 340),
        bodyText("New to ProtoFlow?  Create an account", 745, 566, 340, 28, "#bca9ff"),
      ]);
    }
    case "storefront":
      return createStarterScreen(project, "Storefront", presetById("desktop-1440-900"), [
        text("FORMA", 64, 34, 180, 38, 22),
        widget("link", "Shop  Collections  About", 326, 38, 380, 28, {
          text: "Shop     Collections     About",
          fontFamily: "Arial",
          fontSize: 14,
          fontWeight: "normal",
        }, { fill: "#c5c8d2", fillOpacity: 1, stroke: null, strokeWidth: 0 }),
        widget("icon-button", "Shopping bag", 1290, 30, 48, 48, { label: "Bag", iconName: "ShoppingBag" }),
        widget("rectangle", "Product illustration", 64, 112, 640, 650, { label: "" }, {
          fill: "#f5f1e8",
          fillOpacity: 1,
          stroke: "#d5c7b1",
          strokeWidth: 1,
          cornerRadius: 12,
        }),
        widget("ellipse", "Lamp shade", 234, 244, 300, 180, { label: "" }, {
          fill: "#e9dfcf",
          fillOpacity: 1,
          stroke: "#d5c7b1",
          strokeWidth: 2,
        }),
        widget("rectangle", "Lamp stem", 374, 405, 20, 190, { label: "" }, {
          fill: "#9b845f",
          fillOpacity: 1,
          stroke: "#9b845f",
          strokeWidth: 0,
          cornerRadius: 8,
        }),
        widget("ellipse", "Lamp base", 307, 568, 154, 44, { label: "" }, {
          fill: "#9b845f",
          fillOpacity: 1,
          stroke: "#9b845f",
          strokeWidth: 0,
        }),
        widget("badge", "New arrival", 756, 134, 116, 30, { label: "NEW ARRIVAL" }),
        text("Sculpted ceramic\nTable lamp", 756, 190, 560, 92, 34),
        bodyText("Designed for warm light and quiet evenings.", 756, 300, 540, 30),
        text("$148", 756, 370, 180, 40, 27),
        bodyText("Matte ivory ceramic · Linen shade", 756, 425, 480, 28),
        widget("stepper", "Quantity", 756, 482, 150, 48, { label: "Quantity", value: 1 }),
        button("Add to bag", 756, 556, 420),
        bodyText("Complimentary delivery · 30-day returns", 756, 624, 420, 26),
      ]);
  }
}
