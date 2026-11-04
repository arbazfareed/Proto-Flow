import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const source = new URL("../demos/relay-messaging-suite.pflow", import.meta.url);
const project = JSON.parse(await readFile(source, "utf8"));
const conversation = project.screens.find((screen) => screen.name === "Conversation");

if (!conversation) {
  throw new Error("Relay messaging suite is missing its Conversation screen.");
}

if (conversation.widgets.some((widget) => widget.name === "Message composer" && widget.type === "input")) {
  console.log("The Relay conversation composer is already interactive.");
  process.exit(0);
}

const composer = conversation.widgets.find((widget) => widget.name === "Message composer placeholder");
const typingStatus = conversation.widgets.find((widget) => widget.name === "Typing status");
const sendWidgets = [
  conversation.widgets.find((widget) => widget.name === "Send message button"),
  conversation.widgets.find((widget) => widget.name === "Send message arrow"),
];

if (!composer || !typingStatus || sendWidgets.some((widget) => !widget)) {
  throw new Error("Relay conversation is missing a composer, typing status, or send control.");
}

composer.name = "Message composer";
composer.type = "input";
composer.x = 493;
composer.y = 807;
composer.width = 840;
composer.height = 40;
composer.style = { fill: null, stroke: null, strokeWidth: 0 };
composer.props = {
  label: "Message to Eva",
  placeholder: "Type a message",
  variableName: "draftMessage",
  text: "",
  fontFamily: "Arial",
  fontSize: 12,
  fontWeight: "normal",
  align: "left",
  verticalAlign: "middle",
  lineHeight: 1.25,
};
composer.overrides = {
  mobile: { x: 57, y: 697, width: 255, height: 40, visible: true },
  tablet: { x: 389, y: 807, width: 300, height: 40, visible: true },
  desktop: { x: 493, y: 807, width: 840, height: 40, visible: true },
};

const nextZIndex = Math.max(...conversation.widgets.map((widget) => widget.zIndex ?? 0)) + 1;
const sentBubble = {
  id: randomUUID(),
  type: "rectangle",
  name: "Latest outgoing bubble",
  x: 1040,
  y: 700,
  width: 360,
  height: 58,
  rotation: 0,
  opacity: 1,
  visible: false,
  locked: false,
  zIndex: nextZIndex,
  style: { fill: "#d9eee2", stroke: null, strokeWidth: 0, cornerRadius: [18, 18, 4, 18] },
  props: {},
  overrides: {
    mobile: { x: 37, y: 625, width: 333, height: 55, visible: false },
    tablet: { x: 400, y: 700, width: 348, height: 58, visible: false },
    desktop: { x: 1040, y: 700, width: 360, height: 58, visible: false },
  },
};
const sentText = {
  id: randomUUID(),
  type: "text",
  name: "Latest outgoing bubble message",
  x: 1056,
  y: 709,
  width: 328,
  height: 40,
  rotation: 0,
  opacity: 1,
  visible: false,
  locked: false,
  zIndex: nextZIndex + 1,
  style: { fill: "#2d463b", stroke: null, strokeWidth: 0 },
  props: {
    text: "{{sentMessage}}",
    fontFamily: "Arial",
    fontSize: 12,
    fontWeight: "normal",
    align: "left",
    verticalAlign: "middle",
    lineHeight: 1.25,
  },
  overrides: {
    mobile: { x: 53, y: 634, width: 301, height: 37, visible: false },
    tablet: { x: 416, y: 709, width: 316, height: 40, visible: false },
    desktop: { x: 1056, y: 709, width: 328, height: 40, visible: false },
  },
};
conversation.widgets.push(sentBubble, sentText);

for (const variable of [
  { name: "draftMessage", initial: "" },
  { name: "sentMessage", initial: "" },
]) {
  if (!project.variables.some((entry) => entry.name === variable.name)) {
    project.variables.push({
      id: randomUUID(),
      name: variable.name,
      scope: "project",
      type: "string",
      initial: variable.initial,
    });
  }
}

for (const widget of sendWidgets) {
  const rule = conversation.interactionRules.find((item) => item.widgetId === widget.id && item.event === "onClick");
  if (!rule) {
    throw new Error(`Relay send control "${widget.name}" has no click rule.`);
  }
  rule.conditions = [{ variable: "draftMessage", operator: "notEquals", value: "" }];
  rule.actions = [
    { type: "setVariable", target: "sendState", value: "Message sent · just now" },
    { type: "setVariable", target: "sentMessage", value: "[[draftMessage]]" },
    { type: "show", target: sentBubble.id },
    { type: "show", target: sentText.id },
    { type: "hide", target: typingStatus.id },
    { type: "setVariable", target: "draftMessage", value: "" },
  ];
}

await writeFile(source, `${JSON.stringify(project, null, 2)}\n`, "utf8");
console.log("Added responsive message composition and send behavior to the Relay suite.");
