import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveWidgetsForBreakpoint } from "./responsive";
import { parseProject } from "./schema";
import { PreviewRuntime } from "../preview/runtime";

const project = parseProject(
  readFileSync(new URL("../../demos/relay-responsive-chat.pflow", import.meta.url), "utf8"),
);
const screen = project.screens[0];
const device = screen.device;

if (!device) {
  throw new Error("Relay demo screen is missing its base device.");
}

describe("Relay responsive demo", () => {
  it("defines independent mobile, tablet, and desktop layouts", () => {
    expect(screen.breakpoints?.map(({ id }) => id)).toEqual(["mobile", "tablet", "desktop"]);

    for (const breakpoint of screen.breakpoints ?? []) {
      const resolved = resolveWidgetsForBreakpoint(
        screen.widgets,
        breakpoint,
        device.width,
        device.height,
        screen.compactLayout,
      );
      const byName = new Map(resolved.map((widget) => [widget.name, widget]));
      expect(byName.get("App background")).toMatchObject({
        x: 0,
        width: breakpoint.width,
        height: breakpoint.height,
      });
      for (const widget of resolved.filter((item) => item.visible)) {
        expect(widget.x, `${breakpoint.id}: ${widget.name} left`).toBeGreaterThanOrEqual(0);
        expect(widget.y, `${breakpoint.id}: ${widget.name} top`).toBeGreaterThanOrEqual(0);
        expect(widget.x + widget.width, `${breakpoint.id}: ${widget.name} right`)
          .toBeLessThanOrEqual(breakpoint.width + 0.001);
        expect(widget.y + widget.height, `${breakpoint.id}: ${widget.name} bottom`)
          .toBeLessThanOrEqual(breakpoint.height + 0.001);
      }
    }

    const mobile = screen.widgets.filter((widget) => widget.overrides?.mobile?.visible);
    expect(mobile.length).toBeGreaterThan(0);
    expect(mobile.some((widget) => widget.name === "Conversation list background")).toBe(false);
    expect(mobile.some((widget) => widget.name === "Mobile back button")).toBe(true);
  });

  it("keeps tablet message copy aligned with its bubble", () => {
    const tablet = screen.breakpoints?.find(({ id }) => id === "tablet");
    expect(tablet).toBeDefined();
    const resolved = resolveWidgetsForBreakpoint(
      screen.widgets,
      tablet!,
      device.width,
      device.height,
      screen.compactLayout,
    );
    const byName = new Map(resolved.map((widget) => [widget.name, widget]));

    for (const bubble of screen.widgets.filter(
      (widget) => typeof widget.name === "string" && widget.name.endsWith("bubble"),
    )) {
      const shape = byName.get(bubble.name);
      const text = byName.get(`${bubble.name} message`);
      expect(shape).toBeDefined();
      expect(text).toBeDefined();
      expect(text).toMatchObject({
        x: shape!.x + 16,
        y: shape!.y + 9,
        width: shape!.width - 32,
        height: shape!.height - 18,
      });
    }

    const tallTablet = { ...tablet!, width: 820, height: 1180 };
    const tallTabletWidgets = resolveWidgetsForBreakpoint(
      screen.widgets,
      tallTablet,
      device.width,
      device.height,
      screen.compactLayout,
    );
    const tallByName = new Map(tallTabletWidgets.map((widget) => [widget.name, widget]));
    expect(tallByName.get("Composer surface")?.y! + tallByName.get("Composer surface")?.height!)
      .toBe(1180 - 42);
    expect(tallByName.get("New conversation button")?.y! + tallByName.get("New conversation button")?.height!)
      .toBe(1180 - 19);
    expect(tallByName.get("Your profile avatar")?.y! + tallByName.get("Your profile avatar")?.height!)
      .toBe(1180 - 8);
  });

  it("sends the typed message into the conversation and clears the composer", () => {
    const composer = screen.widgets.find((widget) => widget.name === "Message composer");
    const sendButton = screen.widgets.find((widget) => widget.name === "Send message button");
    const sendArrow = screen.widgets.find((widget) => widget.name === "Send message arrow");
    const sentBubble = screen.widgets.find((widget) => widget.name === "Latest outgoing bubble");
    const sentText = screen.widgets.find((widget) => widget.name === "Latest outgoing bubble message");
    const rules = screen.interactionRules.filter((item) => item.event === "onClick");

    expect(composer?.type).toBe("input");
    expect(composer?.props).toMatchObject({
      label: "Message to Eva",
      variableName: "draftMessage",
    });
    expect(rules.map((rule) => rule.widgetId)).toEqual(
      expect.arrayContaining([sendButton?.id, sendArrow?.id]),
    );
    for (const rule of rules) {
      expect(rule.conditions).toContainEqual({
        variable: "draftMessage",
        operator: "notEquals",
        value: "",
      });
      expect(rule.actions).toContainEqual({ type: "setVariable", target: "sentMessage", value: "[[draftMessage]]" });
    }
    expect(sentBubble?.visible).toBe(false);
    expect(sentText?.props.text).toBe("{{sentMessage}}");

    const runtime = new PreviewRuntime(project);
    runtime.runEvent(sendButton!, "onClick");
    expect(runtime.getVariable("sendState")).toBe("Messages stay between you.");
    expect(runtime.snapshot().visibility[sentBubble!.id]).not.toBe(true);

    runtime.updateBoundVariable(composer!, "See you at 12:30!");
    expect(runtime.runEvent(sendArrow!, "onClick")).toEqual([]);
    expect(runtime.getVariable("sentMessage")).toBe("See you at 12:30!");
    expect(runtime.getVariable("draftMessage")).toBe("");
    expect(runtime.getVariable("sendState")).toBe("Message sent · just now");
    expect(runtime.snapshot().visibility[sentBubble!.id]).toBe(true);
    expect(runtime.snapshot().visibility[sentText!.id]).toBe(true);
    expect(runtime.snapshot().visibility[screen.widgets.find((widget) => widget.name === "Typing status")!.id]).toBe(false);
  });
});
