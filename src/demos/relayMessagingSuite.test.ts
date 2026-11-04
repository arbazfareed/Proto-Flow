import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { CANVAS_ICON_LIBRARY } from "../canvas/iconLibrary";
import relaySource from "../../demos/relay-messaging-suite.pflow?raw";
import { parseProject } from "../project/schema";
import { generateLocalHtmlArchive, responsiveLayoutStyles } from "../preview/htmlExport";
import { PreviewRuntime } from "../preview/runtime";

const project = parseProject(relaySource);

describe("responsive Relay messaging suite", () => {
  it("includes the four navigable messaging sections", () => {
    const screenIds = new Set(project.screens.map((screen) => screen.id));
    expect(project.screens.map((screen) => screen.name)).toEqual([
      "Chats",
      "Conversation",
      "Calls",
      "Updates",
      "Settings",
    ]);
    const primaryScreenIds = ["Chats", "Calls", "Updates", "Settings"].map(
      (name) => project.screens.find((screen) => screen.name === name)!.id,
    );

    for (const screen of project.screens) {
      const routes = screen.interactionRules.flatMap((rule) =>
        rule.actions.filter((action) => action.type === "navigate").map((action) => action.target),
      );
      expect(routes).toEqual(expect.arrayContaining(primaryScreenIds));
      expect(routes.every((target) => screenIds.has(target))).toBe(true);
      expect(screen.widgets.some((widget) => widget.name === "Mobile navigation background")).toBe(true);
      expect(screen.widgets.some((widget) => widget.name === "Mobile Chats tab label")).toBe(true);
      for (const widget of screen.widgets.filter((item) => item.type === "icon")) {
        expect(CANVAS_ICON_LIBRARY).toHaveProperty(String(widget.props.iconName));
      }
    }

    const chats = project.screens.find((screen) => screen.name === "Chats")!;
    const conversation = project.screens.find((screen) => screen.name === "Conversation")!;
    const conversationId = conversation.id;
    expect(conversation.widgets.some((widget) => widget.name === "Conversation canvas")).toBe(true);
    expect(conversation.widgets.some((widget) => widget.name === "First incoming bubble message")).toBe(true);
    expect(conversation.widgets.some((widget) => widget.name === "Chats welcome card")).toBe(false);
    expect(chats.interactionRules.some((rule) =>
      rule.actions.some((action) => action.type === "navigate" && action.target === conversationId),
    )).toBe(true);
    expect(conversation.interactionRules.some((rule) =>
      rule.widgetId === conversation.widgets.find((widget) => widget.name === "Mobile back button")?.id &&
      rule.actions.some((action) => action.type === "navigate" && action.target === chats.id),
    )).toBe(true);

    for (const screenName of ["Calls", "Updates", "Settings"]) {
      const screen = project.screens.find((item) => item.name === screenName)!;
      for (const widgetName of ["Conversation canvas", "First incoming bubble message", "Message composer placeholder"]) {
        const widget = screen.widgets.find((item) => item.name === widgetName)!;
        expect(widget.visible, `${screenName}/${widgetName} is hidden by default`).toBe(false);
        for (const breakpoint of screen.breakpoints ?? []) {
          expect(widget.overrides?.[breakpoint.id]?.visible, `${screenName}/${widgetName}/${breakpoint.id}`).toBe(false);
        }
      }
    }
  });

  it("fits every visible widget inside mobile, tablet, and desktop breakpoints", () => {
    for (const screen of project.screens) {
      expect(screen.breakpoints?.map((breakpoint) => breakpoint.id)).toEqual([
        "mobile",
        "tablet",
        "desktop",
      ]);
      for (const breakpoint of screen.breakpoints ?? []) {
        for (const widget of screen.widgets) {
          const override = widget.overrides?.[breakpoint.id];
          if (override?.visible ?? widget.visible) {
            const x = override?.x ?? widget.x;
            const y = override?.y ?? widget.y;
            const width = override?.width ?? widget.width;
            const height = override?.height ?? widget.height;
            expect(x, `${screen.name}/${breakpoint.id}/${widget.name} x`).toBeGreaterThanOrEqual(0);
            expect(y, `${screen.name}/${breakpoint.id}/${widget.name} y`).toBeGreaterThanOrEqual(0);
            expect(x + width, `${screen.name}/${breakpoint.id}/${widget.name} right edge`)
              .toBeLessThanOrEqual(breakpoint.width);
            expect(y + height, `${screen.name}/${breakpoint.id}/${widget.name} bottom edge`)
              .toBeLessThanOrEqual(breakpoint.height);
          }
        }
      }
    }

    const conversation = project.screens.find((screen) => screen.name === "Conversation")!;
    const composer = conversation.widgets.find((widget) => widget.name === "Send message button")!;
    const mobileNavigation = conversation.widgets.find((widget) => widget.name === "Mobile navigation background")!;
    expect(composer.overrides?.mobile?.visible).toBe(true);
    expect(mobileNavigation.overrides?.mobile?.visible).toBe(true);
    expect((composer.overrides?.mobile?.y ?? composer.y) + (composer.overrides?.mobile?.height ?? composer.height))
      .toBeLessThanOrEqual(mobileNavigation.overrides?.mobile?.y ?? mobileNavigation.y);
  });

  it("exports responsive rules for the mobile navigation", () => {
    const nav = project.screens[0].widgets.find((widget) => widget.name === "Mobile navigation background");
    expect(nav).toBeDefined();
    expect(responsiveLayoutStyles(project)).toContain(`data-widget-id="${nav?.id}"`);
    expect(responsiveLayoutStyles(project)).toContain("@media (max-width:767px)");
    expect(responsiveLayoutStyles(project)).not.toContain("display:none!important");
  });

  it("composes and sends typed messages in the responsive conversation", () => {
    const conversation = project.screens.find((screen) => screen.name === "Conversation")!;
    const composer = conversation.widgets.find((widget) => widget.name === "Message composer")!;
    const sendButton = conversation.widgets.find((widget) => widget.name === "Send message button")!;
    const sendArrow = conversation.widgets.find((widget) => widget.name === "Send message arrow")!;
    const sentBubble = conversation.widgets.find((widget) => widget.name === "Latest outgoing bubble")!;
    const sentText = conversation.widgets.find((widget) => widget.name === "Latest outgoing bubble message")!;

    expect(composer.type).toBe("input");
    expect(composer.props).toMatchObject({
      label: "Message to Eva",
      variableName: "draftMessage",
    });
    expect(composer.overrides?.mobile).toMatchObject({ x: 57, width: 255, visible: true });
    expect(sentBubble.visible).toBe(false);
    expect(sentText.props.text).toBe("{{sentMessage}}");

    const runtime = new PreviewRuntime(project);
    runtime.navigate(conversation.id);
    runtime.runEvent(sendButton, "onClick");
    expect(runtime.getVariable("sendState")).toBe("Messages stay between you.");
    expect(runtime.snapshot().visibility[sentBubble.id]).not.toBe(true);

    runtime.updateBoundVariable(composer, "I will be there in five minutes.");
    expect(runtime.runEvent(sendArrow, "onClick")).toEqual([]);
    expect(runtime.getVariable("sentMessage")).toBe("I will be there in five minutes.");
    expect(runtime.getVariable("draftMessage")).toBe("");
    expect(runtime.getVariable("sendState")).toBe("Message sent · just now");
    expect(runtime.snapshot().visibility[sentBubble.id]).toBe(true);
    expect(runtime.snapshot().visibility[sentText.id]).toBe(true);
    expect(runtime.snapshot().visibility[
      conversation.widgets.find((widget) => widget.name === "Typing status")!.id
    ]).toBe(false);
  });

  it("includes breakpoint-only mobile controls in the responsive HTML export", async () => {
    const chats = project.screens.find((screen) => screen.name === "Chats")!;
    const conversation = project.screens.find((screen) => screen.name === "Conversation")!;
    const navigation = chats.widgets.find((widget) => widget.name === "Mobile navigation background")!;
    const backButton = conversation.widgets.find((widget) => widget.name === "Mobile back button")!;
    const archive = await JSZip.loadAsync(await generateLocalHtmlArchive(project, {
      includeInteractions: true,
      includeAssets: true,
      mode: "responsive",
    }));
    const html = await archive.file("index.html")!.async("string");
    const serializedProject = html.match(
      /<script id="project-data" type="application\/json">([\s\S]*?)<\/script>/,
    )?.[1];
    expect(serializedProject).toBeDefined();
    const exportedProject = parseProject(serializedProject!);
    for (const [screenName, widgetName] of [
      ["Chats", navigation.name],
      ["Conversation", backButton.name],
    ]) {
      const screen = exportedProject.screens.find((item) => item.name === screenName)!;
      const widget = screen.widgets.find((item) => item.name === widgetName)!;
      expect(widget.visible).toBe(true);
      expect(widget.overrides?.mobile?.visible).toBe(true);
      expect(widget.overrides?.desktop?.visible).toBe(false);
    }

    const exportedComposer = exportedProject.screens
      .find((screen) => screen.name === "Conversation")!
      .widgets.find((widget) => widget.name === "Message composer");
    expect(exportedComposer?.type).toBe("input");
    expect(exportedComposer?.props.variableName).toBe("draftMessage");
  });
});
