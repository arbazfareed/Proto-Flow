import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";

const now = new Date().toISOString();
const screenId = randomUUID();
const widgets = [];
const desktopThread = { x: 424, width: 1016 };
const tabletThread = { x: 320, width: 448 };
const breakpoints = [
  { id: "mobile", name: "Mobile", minWidth: 0, maxWidth: 767, width: 390, height: 844 },
  { id: "tablet", name: "Tablet", minWidth: 768, maxWidth: 1023, width: 768, height: 1024 },
  { id: "desktop", name: "Desktop", minWidth: 1024, width: 1440, height: 900 },
];

function place(
  group,
  box,
  device,
  {
    alignRight = false,
    alignCenter = false,
    alignBottom = false,
    edge = 18,
    bottomEdge = 18,
    mobile = null,
    tablet = null,
  } = {},
) {
  if (device === "tablet" && tablet) {
    return { ...tablet, visible: true };
  }
  if (device === "mobile" && group !== "thread" && group !== "full") {
    return { x: 0, y: 0, width: 1, height: 1, visible: false };
  }
  if (device === "mobile" && mobile) {
    return { ...mobile, visible: true };
  }
  const isThread = group === "thread";
  const origin = isThread
    ? device === "desktop" ? desktopThread : device === "tablet" ? tabletThread : { x: 0, width: 390 }
    : group === "sidebar"
      ? { x: device === "desktop" ? 72 : 60, width: device === "desktop" ? 352 : 260 }
      : group === "rail"
        ? { x: 0, width: device === "desktop" ? 72 : 60 }
        : { x: 0, width: device === "desktop" ? 1440 : device === "tablet" ? 768 : 390 };
  const spansOrigin = box.x === 0 && box.width >= origin.width;
  const width = spansOrigin
    ? origin.width
    : alignRight
      ? Math.min(box.width, Math.max(1, origin.width - edge * 2))
    : alignCenter
      ? Math.min(box.width, Math.max(1, origin.width - edge * 2))
      : Math.min(box.width, Math.max(1, origin.width - box.x - 14));
  const x = spansOrigin
    ? origin.x
    : alignRight
      ? origin.x + origin.width - edge - width
    : alignCenter
      ? origin.x + (origin.width - width) / 2
      : origin.x + (group === "sidebar" && device === "tablet" ? box.x * (260 / 352) : box.x);
  const viewportHeight = device === "desktop" ? 900 : device === "tablet" ? 1024 : 844;
  const y = alignBottom && device === "tablet"
    ? undefined
    : alignBottom ? viewportHeight - bottomEdge - box.height : box.y;
  const stretchesToViewport =
    box.x === 0 && box.y === 0 && box.height === 900 &&
    (group === "full" || group === "rail" || group === "sidebar" || isThread);
  return {
    x,
    y,
    width,
    height: stretchesToViewport ? viewportHeight : box.height,
    visible: true,
  };
}

function addWidget({
  type = "text",
  name,
  group,
  box,
  mobile = null,
  tablet = null,
  alignRight = false,
  alignCenter = false,
  alignBottom = false,
  edge = 18,
  bottomEdge = 18,
  text,
  icon,
  color = "#243b34",
  fill = null,
  stroke = null,
  strokeWidth = 0,
  radius = 0,
  fontSize = 14,
  fontWeight = "normal",
  align = "left",
  verticalAlign = "middle",
  opacity = 1,
  visible = true,
  tabletVisible = true,
  mobileVisible = true,
  initial = null,
}) {
  const widgetId = randomUUID();
  const boxAt = (device) =>
    place(group, box, device, {
      alignRight,
      alignCenter,
      alignBottom,
      edge,
      bottomEdge,
      mobile,
      tablet,
    });
  const widget = {
    id: widgetId,
    type,
    name,
    ...boxAt("desktop"),
    ...(alignBottom
      ? { constraints: { horizontal: alignRight ? "right" : "left", vertical: "bottom" } }
      : {}),
    rotation: 0,
    opacity,
    visible,
    locked: false,
    zIndex: widgets.length,
    style: {
      fill,
      stroke,
      strokeWidth: type === "icon" && strokeWidth === 0 ? 2 : strokeWidth,
      ...(radius ? { cornerRadius: radius } : {}),
    },
    props: type === "icon"
      ? { iconName: icon }
      : {
          text: text ?? "",
          fontFamily: "Arial",
          fontSize,
          fontWeight,
          align,
          verticalAlign,
          lineHeight: 1.25,
        },
    overrides: {
      mobile: { ...boxAt("mobile"), visible: mobileVisible && group !== "sidebar" && group !== "rail" },
      tablet: { ...boxAt("tablet"), visible: tabletVisible },
    },
  };
  if (initial) widget.props[initial.key] = initial.value;
  widgets.push(widget);
  return widgetId;
}

const rect = (name, group, box, fill, radius = 0, options = {}) =>
  addWidget({
    type: "rectangle",
    name,
    group,
    box,
    mobile: options.mobile ?? null,
    tablet: options.tablet ?? null,
    alignRight: options.alignRight ?? false,
    alignCenter: options.alignCenter ?? false,
    alignBottom: options.alignBottom ?? false,
    edge: options.edge ?? 18,
    bottomEdge: options.bottomEdge ?? 18,
    fill,
    stroke: options.stroke ?? null,
    strokeWidth: options.strokeWidth ?? 0,
    radius,
    opacity: options.opacity ?? 1,
    visible: options.visible ?? true,
    tabletVisible: options.tabletVisible ?? true,
    mobileVisible: options.mobileVisible ?? true,
  });

const label = (name, text, group, box, options = {}) =>
  addWidget({
    name,
    text,
    group,
    box,
    mobile: options.mobile ?? null,
    tablet: options.tablet ?? null,
    alignRight: options.alignRight ?? false,
    alignCenter: options.alignCenter ?? false,
    alignBottom: options.alignBottom ?? false,
    edge: options.edge ?? 18,
    bottomEdge: options.bottomEdge ?? 18,
    color: options.color ?? "#243b34",
    fill: options.color ?? "#243b34",
    fontSize: options.fontSize ?? 14,
    fontWeight: options.fontWeight ?? "normal",
    align: options.align ?? "left",
    verticalAlign: options.verticalAlign ?? "middle",
    visible: options.visible ?? true,
    tabletVisible: options.tabletVisible ?? true,
    mobileVisible: options.mobileVisible ?? true,
  });

const icon = (name, iconName, group, box, options = {}) =>
  addWidget({
    type: "icon",
    name,
    icon: iconName,
    group,
    box,
    mobile: options.mobile ?? null,
    tablet: options.tablet ?? null,
    alignRight: options.alignRight ?? false,
    alignBottom: options.alignBottom ?? false,
    edge: options.edge ?? 18,
    bottomEdge: options.bottomEdge ?? 18,
    color: options.color ?? "#52655e",
    stroke: options.color ?? "#52655e",
    strokeWidth: 2,
    visible: options.visible ?? true,
    tabletVisible: options.tabletVisible ?? true,
    mobileVisible: options.mobileVisible ?? true,
  });

function sidebarAvatar(name, initials, color, y, selected = false) {
  const fill = selected ? "#d7ebe3" : color;
  const circle = addWidget({
    type: "ellipse",
    name: `${name} avatar`,
    group: "sidebar",
    box: { x: 16, y, width: 44, height: 44 },
    fill,
  });
  label(`${name} initials`, initials, "sidebar", { x: 16, y: y + 1, width: 44, height: 42 }, {
    color: selected ? "#234c3f" : "#ffffff",
    fontSize: 13,
    fontWeight: "bold",
    align: "center",
  });
  return circle;
}

function sidebarConversation({
  name,
  initials,
  color,
  preview,
  time,
  y,
  unread = "",
  selected = false,
}) {
  if (selected) {
    rect(`${name} selected row`, "sidebar", { x: 7, y: y - 5, width: 338, height: 72 }, "#e5f1eb", 14, {
      mobile: { x: 0, y: y - 5, width: 1, height: 1 },
    });
  }
  sidebarAvatar(name, initials, color, y, selected);
  label(`${name} name`, name, "sidebar", { x: 72, y: y - 2, width: 188, height: 22 }, {
    fontSize: 13,
    fontWeight: "bold",
    mobile: null,
  });
  label(`${name} preview`, preview, "sidebar", { x: 72, y: y + 22, width: 233, height: 18 }, {
    color: selected ? "#3d6656" : "#87948e",
    fontSize: 11,
  });
  label(`${name} time`, time, "sidebar", { x: 278, y: y - 2, width: 49, height: 18 }, {
    color: selected ? "#2a7055" : "#9ba6a1",
    fontSize: 9,
    align: "right",
  });
  if (unread) {
    addWidget({
      type: "ellipse",
      name: `${name} unread badge`,
      group: "sidebar",
      box: { x: 314, y: y + 24, width: 18, height: 18 },
      fill: "#2c8a67",
    });
    label(`${name} unread count`, unread, "sidebar", { x: 314, y: y + 24, width: 18, height: 18 }, {
      color: "#ffffff",
      fontSize: 9,
      fontWeight: "bold",
      align: "center",
    });
  }
}

function threadBubble(name, text, { y, width, side, color, textColor, mobile }) {
  const x = side === "right" ? desktopThread.width - width - 24 : 22;
  const tabletX = side === "right" ? tabletThread.width - width - 20 : 16;
  const phoneX = mobile.x;
  const widgetId = randomUUID();
  const widget = {
    id: widgetId,
    type: "rectangle",
    name,
    x: desktopThread.x + x,
    y,
    width,
    height: mobile.height,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    zIndex: widgets.length,
    style: {
      fill: color,
      stroke: null,
      strokeWidth: 0,
      cornerRadius: side === "right" ? [18, 18, 4, 18] : [18, 18, 18, 4],
    },
    props: {},
    overrides: {
      tablet: {
        x: tabletThread.x + tabletX,
        y,
        width: Math.min(width, tabletThread.width - Math.abs(tabletX) - 16),
        height: mobile.height,
        visible: true,
      },
      mobile: { ...mobile, visible: true },
    },
  };
  widgets.push(widget);
  label(`${name} message`, text, "thread", {
    x: x + 16,
    y: y + 9,
    width: width - 32,
    height: mobile.height - 18,
  }, {
    tablet: {
      x: tabletThread.x + tabletX + 16,
      y: y + 9,
      width: Math.min(width, tabletThread.width - Math.abs(tabletX) - 16) - 32,
      height: mobile.height - 18,
    },
    color: textColor,
    fontSize: 12,
    mobile: {
      x: phoneX + 14,
      y: mobile.y + 8,
      width: Math.max(40, mobile.width - 28),
      height: mobile.height - 16,
    },
  });
}

rect("App background", "full", { x: 0, y: 0, width: 1440, height: 900 }, "#f4f7f5");
rect("Navigation rail", "rail", { x: 0, y: 0, width: 72, height: 900 }, "#18372e");
rect("Navigation logo tile", "rail", { x: 14, y: 18, width: 44, height: 44 }, "#b3e2ca", 14);
label("Relay monogram", "r.", "rail", { x: 14, y: 18, width: 44, height: 44 }, {
  color: "#18372e",
  fontSize: 21,
  fontWeight: "bold",
  align: "center",
});
rect("Selected navigation indicator", "rail", { x: 13, y: 94, width: 46, height: 46 }, "#315a4b", 15);
icon("Inbox navigation", "MessageCircle", "rail", { x: 25, y: 106, width: 22, height: 22 }, { color: "#c5f0d8" });
icon("People navigation", "Users", "rail", { x: 25, y: 169, width: 22, height: 22 }, { color: "#9bb6a9" });
icon("Saved navigation", "Bookmark", "rail", { x: 25, y: 229, width: 22, height: 22 }, { color: "#9bb6a9" });
icon("Settings navigation", "Settings", "rail", { x: 25, y: 817, width: 22, height: 22 }, {
  color: "#9bb6a9",
  alignBottom: true,
  bottomEdge: 61,
});
addWidget({
  type: "ellipse",
  name: "Your profile avatar",
  group: "rail",
  box: { x: 17, y: 854, width: 38, height: 38 },
  alignBottom: true,
  bottomEdge: 8,
  fill: "#e5b68f",
});
label("Your profile initials", "A", "rail", { x: 17, y: 854, width: 38, height: 38 }, {
  alignBottom: true,
  bottomEdge: 8,
  color: "#493122",
  fontSize: 13,
  fontWeight: "bold",
  align: "center",
});

rect("Conversation list background", "sidebar", { x: 0, y: 0, width: 352, height: 900 }, "#fbfcfa");
rect("Conversation list divider", "sidebar", { x: 351, y: 0, width: 1, height: 900 }, "#e8eeea");
label("Inbox heading", "Messages", "sidebar", { x: 20, y: 25, width: 190, height: 34 }, {
  fontSize: 24,
  fontWeight: "bold",
});
label("Inbox subtitle", "Your people, all in one place.", "sidebar", { x: 21, y: 61, width: 270, height: 20 }, {
  color: "#85928b",
  fontSize: 11,
});
rect("Search field", "sidebar", { x: 16, y: 100, width: 320, height: 42 }, "#f0f4f1", 12);
icon("Search conversations", "Search", "sidebar", { x: 29, y: 113, width: 16, height: 16 });
label("Search placeholder", "Search conversations", "sidebar", { x: 54, y: 110, width: 255, height: 22 }, {
  color: "#94a099",
  fontSize: 11,
});
label("Pinned heading", "PINNED", "sidebar", { x: 19, y: 158, width: 108, height: 16 }, {
  color: "#899890",
  fontSize: 9,
  fontWeight: "bold",
});
sidebarConversation({
  name: "Eva Chen",
  initials: "EC",
  color: "#df9a7f",
  preview: "Perfect, see you there 🌿",
  time: "now",
  y: 188,
  unread: "2",
  selected: true,
});
sidebarConversation({
  name: "Weekend people",
  initials: "WP",
  color: "#7a9c8b",
  preview: "Maya: Sunday sounds lovely",
  time: "9:41",
  y: 269,
  unread: "3",
});
label("All chats heading", "ALL CHATS", "sidebar", { x: 19, y: 341, width: 108, height: 16 }, {
  color: "#899890",
  fontSize: 9,
  fontWeight: "bold",
});
sidebarConversation({
  name: "Noah Williams",
  initials: "NW",
  color: "#7891b3",
  preview: "Sent you a voice note",
  time: "8:52",
  y: 370,
});
sidebarConversation({
  name: "Amara Okafor",
  initials: "AO",
  color: "#bd8db2",
  preview: "Thank you for today 💛",
  time: "Yesterday",
  y: 451,
});
sidebarConversation({
  name: "Leo Martin",
  initials: "LM",
  color: "#d0a962",
  preview: "The photos are so good!",
  time: "Yesterday",
  y: 532,
});
rect("New conversation button", "sidebar", { x: 20, y: 837, width: 312, height: 44 }, "#193d32", 14, {
  alignCenter: true,
  alignBottom: true,
  bottomEdge: 19,
});
icon("New conversation plus", "Plus", "sidebar", { x: 88, y: 851, width: 16, height: 16 }, {
  color: "#c5f0d8",
  alignBottom: true,
  bottomEdge: 33,
});
label("New conversation action", "New message", "sidebar", { x: 111, y: 847, width: 150, height: 25 }, {
  alignBottom: true,
  bottomEdge: 28,
  color: "#f7fff9",
  fontSize: 12,
  fontWeight: "bold",
});

rect("Conversation canvas", "thread", { x: 0, y: 0, width: desktopThread.width, height: 900 }, "#f5f8f6");
rect("Conversation header surface", "thread", { x: 0, y: 0, width: desktopThread.width, height: 82 }, "#ffffff");
rect("Conversation header divider", "thread", { x: 0, y: 81, width: desktopThread.width, height: 1 }, "#e8efeb");
icon("Mobile back button", "ArrowLeft", "thread", { x: 8, y: 26, width: 22, height: 22 }, {
  color: "#38584c",
  mobile: { x: 13, y: 26, width: 22, height: 22 },
  visible: false,
  tabletVisible: false,
});
addWidget({
  type: "ellipse",
  name: "Eva conversation avatar",
  group: "thread",
  box: { x: 20, y: 18, width: 46, height: 46 },
  fill: "#df9a7f",
  mobile: { x: 43, y: 16, width: 44, height: 44 },
});
label("Eva avatar initials", "EC", "thread", { x: 20, y: 18, width: 46, height: 46 }, {
  color: "#ffffff",
  fontSize: 13,
  fontWeight: "bold",
  align: "center",
  mobile: { x: 43, y: 16, width: 44, height: 44 },
});
label("Conversation contact name", "Eva Chen", "thread", { x: 78, y: 17, width: 260, height: 24 }, {
  fontSize: 14,
  fontWeight: "bold",
  mobile: { x: 96, y: 14, width: 154, height: 23 },
});
label("Conversation presence", "●  Online now", "thread", { x: 79, y: 43, width: 180, height: 18 }, {
  color: "#438469",
  fontSize: 10,
  mobile: { x: 97, y: 38, width: 170, height: 16 },
});
icon("Voice call", "Phone", "thread", { x: desktopThread.width - 116, y: 29, width: 21, height: 21 }, {
  color: "#537267",
  alignRight: true,
  edge: 116,
  mobile: { x: 296, y: 27, width: 19, height: 19 },
});
icon("Video call", "Video", "thread", { x: desktopThread.width - 71, y: 29, width: 22, height: 22 }, {
  color: "#537267",
  alignRight: true,
  edge: 71,
  mobile: { x: 329, y: 27, width: 20, height: 20 },
});
icon("Conversation menu", "MoreHorizontal", "thread", { x: desktopThread.width - 32, y: 29, width: 22, height: 22 }, {
  color: "#537267",
  alignRight: true,
  edge: 30,
  mobile: { x: 359, y: 27, width: 20, height: 20 },
});
label("Conversation date", "TODAY  ·  10:42 AM", "thread", { x: 330, y: 98, width: 360, height: 20 }, {
  color: "#9aa7a0",
  fontSize: 9,
  fontWeight: "bold",
  align: "center",
  alignCenter: true,
  mobile: { x: 70, y: 91, width: 250, height: 18 },
});

threadBubble("First outgoing bubble", "I found a tiny place by the water that I think you'll love.", {
  y: 139,
  width: 394,
  side: "right",
  color: "#d9eee2",
  textColor: "#2d463b",
  mobile: { x: 79, y: 124, width: 292, height: 64 },
});
label("First outgoing time", "10:42   ✓✓", "thread", { x: desktopThread.width - 137, y: 208, width: 98, height: 15 }, {
  color: "#7e9b8b",
  fontSize: 9,
  align: "right",
  alignRight: true,
  edge: 39,
  mobile: { x: 270, y: 190, width: 86, height: 14 },
});
threadBubble("First incoming bubble", "That sounds exactly like the kind of place I need today 🌿", {
  y: 238,
  width: 405,
  side: "left",
  color: "#ffffff",
  textColor: "#40534a",
  mobile: { x: 15, y: 211, width: 304, height: 74 },
});
label("First incoming time", "10:44", "thread", { x: 40, y: 316, width: 82, height: 15 }, {
  color: "#9aa7a0",
  fontSize: 9,
  mobile: { x: 31, y: 288, width: 68, height: 13 },
});
threadBubble("Second outgoing bubble", "Window seat is reserved ☀️", {
  y: 345,
  width: 315,
  side: "right",
  color: "#d9eee2",
  textColor: "#2d463b",
  mobile: { x: 94, y: 312, width: 276, height: 58 },
});
threadBubble("Second incoming bubble", "You know me too well! What time were you thinking?", {
  y: 422,
  width: 405,
  side: "left",
  color: "#ffffff",
  textColor: "#40534a",
  mobile: { x: 15, y: 390, width: 319, height: 68 },
});
threadBubble("Third outgoing bubble", "How about 12:30? I'll bring the playlist.", {
  y: 515,
  width: 365,
  side: "right",
  color: "#d9eee2",
  textColor: "#2d463b",
  mobile: { x: 37, y: 476, width: 333, height: 65 },
});
threadBubble("Third incoming bubble", "12:30 is perfect ✨", {
  y: 610,
  width: 238,
  side: "left",
  color: "#ffffff",
  textColor: "#40534a",
  mobile: { x: 15, y: 559, width: 226, height: 50 },
});
label("Typing status", "Eva is typing…", "thread", { x: 39, y: 673, width: 168, height: 20 }, {
  color: "#91a099",
  fontSize: 10,
  mobile: { x: 31, y: 613, width: 158, height: 18 },
});
rect("Composer surface", "thread", { x: 18, y: 796, width: desktopThread.width - 36, height: 62 }, "#ffffff", 19, {
  stroke: "#e5ece8",
  strokeWidth: 1,
  alignBottom: true,
  bottomEdge: 42,
  mobile: { x: 12, y: 749, width: 366, height: 58 },
});
icon("Attach file", "Plus", "thread", { x: 35, y: 817, width: 19, height: 19 }, {
  color: "#668278",
  alignBottom: true,
  bottomEdge: 64,
  mobile: { x: 26, y: 768, width: 19, height: 19 },
});
label("Message composer placeholder", "Write something kind…", "thread", { x: 69, y: 814, width: 450, height: 24 }, {
  color: "#96a39d",
  fontSize: 12,
  alignBottom: true,
  bottomEdge: 62,
  mobile: { x: 57, y: 766, width: 223, height: 24 },
});
rect("Send message button", "thread", { x: desktopThread.width - 63, y: 806, width: 44, height: 42 }, "#244c3c", 14, {
  alignRight: true,
  alignBottom: true,
  edge: 19,
  bottomEdge: 52,
  mobile: { x: 326, y: 757, width: 40, height: 40 },
});
icon("Send message arrow", "ArrowRight", "thread", { x: desktopThread.width - 51, y: 818, width: 20, height: 20 }, {
  color: "#e4f4e9",
  alignRight: true,
  alignBottom: true,
  edge: 31,
  bottomEdge: 62,
  mobile: { x: 336, y: 767, width: 20, height: 20 },
});
label("Send message confirmation", "{{sendState}}", "thread", { x: 20, y: 867, width: 450, height: 20 }, {
  color: "#6d8479",
  fontSize: 9,
  alignBottom: true,
  bottomEdge: 13,
  mobile: { x: 18, y: 816, width: 340, height: 18 },
});
const sendButtonId = widgets.find((widget) => widget.name === "Send message button").id;
const sendArrowId = widgets.find((widget) => widget.name === "Send message arrow").id;

const project = {
  schemaVersion: "1.9.0",
  id: randomUUID(),
  name: "Relay — conversations, in rhythm",
  createdAt: now,
  updatedAt: now,
  variables: [
    {
      id: randomUUID(),
      name: "sendState",
      scope: "project",
      type: "string",
      initial: "Messages stay between you.",
    },
  ],
  symbols: [],
  startScreenId: screenId,
  screens: [
    {
      id: screenId,
      name: "Eva · Conversation",
      device: {
        presetId: "desktop-1440-900",
        width: 1440,
        height: 900,
        dpr: 1,
        insets: { top: 0, right: 0, bottom: 0, left: 0 },
        orientation: "landscape",
      },
      inputMode: "both",
      compactLayout: false,
      breakpoints,
      widgets,
      interactionRules: [sendButtonId, sendArrowId].map((widgetId) => ({
          id: randomUUID(),
          widgetId,
          event: "onClick",
          conditions: [],
          actions: [
            { type: "setVariable", target: "sendState", value: "Message sent · just now" },
          ],
        })),
    },
  ],
};

await writeFile(
  new URL("../demos/relay-responsive-chat.pflow", import.meta.url),
  `${JSON.stringify(project, null, 2)}\n`,
  "utf8",
);
console.log(`Created ${project.name} with ${widgets.length} responsive widgets.`);
