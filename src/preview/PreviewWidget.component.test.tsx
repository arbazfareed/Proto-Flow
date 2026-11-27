import { cleanup, fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createEmptyProject, type Widget } from "../project/schema";
import { PreviewWidget } from "./PreviewWindow";
import { PreviewRuntime } from "./runtime";

function makeWidget(): Widget {
  return {
    id: crypto.randomUUID(),
    type: "button",
    x: 10,
    y: 10,
    width: 120,
    height: 40,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    zIndex: 0,
    style: {},
    props: { label: "Interact" },
  };
}

function renderWidget(mode: "touch" | "mouse" | "both" = "both") {
  const project = createEmptyProject("Input mode preview");
  project.screens[0].inputMode = mode;
  const runtime = new PreviewRuntime(project);
  const widget = makeWidget();
  const runEvent = vi.fn((_widget: unknown, _event: unknown, _item?: unknown) => 0);
  const onGestureFeedback = vi.fn();
  const rendered = render(
    <PreviewWidget
      widget={widget}
      runtime={runtime}
      screenId={project.screens[0].id}
      snapshot={runtime.snapshot()}
      runEvent={runEvent}
      onError={vi.fn()}
      controlValues={{}}
      onControlValueChange={vi.fn()}
      onGestureFeedback={onGestureFeedback}
      liteMode={false}
    />,
  );
  return { button: rendered.getByRole("button", { name: "Interact" }), runEvent, onGestureFeedback };
}

function touchEvent(
  element: HTMLElement,
  type: "touchStart" | "touchMove" | "touchEnd",
  touches: Array<{ clientX: number; clientY: number }>,
  changedTouches = touches,
) {
  const event = new Event(`touch${type.slice(5).toLowerCase()}`, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    touches: { value: touches },
    changedTouches: { value: changedTouches },
  });
  fireEvent(element, event);
}

describe("PreviewWidget input-mode interactions", () => {
  it("treats mouse clicks as taps in touch mode and blocks other mouse triggers (B82)", () => {
    const { button, runEvent } = renderWidget("touch");
    fireEvent.contextMenu(button);
    fireEvent.mouseOver(button);
    fireEvent.mouseOut(button, { relatedTarget: document.body });
    fireEvent.mouseDown(button);
    fireEvent.mouseUp(button);
    expect(runEvent).not.toHaveBeenCalled();

    // No rule ran for the tap, so the click falls back to Click rules, as a tap does on the web.
    fireEvent.click(button, { detail: 1 });
    expect(runEvent.mock.calls.map(([, event]) => event)).toEqual(["onTap", "onClick"]);

    runEvent.mockClear();
    fireEvent.doubleClick(button);
    expect(runEvent.mock.calls.map(([, event]) => event)).toEqual(["onDoubleTap", "onDoubleClick"]);

    runEvent.mockClear();
    fireEvent.click(button, { detail: 0 });
    expect(runEvent).toHaveBeenCalledWith(expect.anything(), "onClick", undefined);
  });

  it("stops at the first trigger that runs a rule", () => {
    const { button, runEvent } = renderWidget("touch");
    runEvent.mockImplementation((_widget, event) => (event === "onTap" ? 1 : 0));
    fireEvent.click(button, { detail: 1 });
    expect(runEvent.mock.calls.map(([, event]) => event)).toEqual(["onTap"]);
  });

  it("fires mouse triggers and ignores touch gestures in mouse mode", () => {
    const { button, runEvent } = renderWidget("mouse");
    fireEvent.click(button, { detail: 1 });
    fireEvent.doubleClick(button);
    fireEvent.contextMenu(button);
    fireEvent.mouseOver(button);
    fireEvent.mouseOut(button, { relatedTarget: document.body });
    fireEvent.mouseDown(button);
    fireEvent.mouseUp(button);
    touchEvent(button, "touchStart", [{ clientX: 20, clientY: 30 }]);
    touchEvent(button, "touchEnd", [], [{ clientX: 20, clientY: 30 }]);

    expect(runEvent.mock.calls.map(([, event]) => event)).toEqual([
      "onClick",
      "onDoubleClick",
      "onRightClick",
      "onHover",
      "onMouseLeave",
      "onMouseDown",
      "onMouseUp",
    ]);
  });

  it("keeps keyboard triggers available in every input mode", () => {
    for (const mode of ["touch", "mouse", "both"] as const) {
      cleanup();
      const { button, runEvent } = renderWidget(mode);
      fireEvent.focus(button);
      fireEvent.keyDown(button, { key: "Enter" });
      fireEvent.click(button, { detail: 0 });
      fireEvent.blur(button);
      expect(runEvent.mock.calls.map(([, event]) => event)).toEqual([
        "onFocus",
        "onKeyDown",
        "onClick",
        "onBlur",
      ]);
    }
    cleanup();
  });

  it("does not turn a touch pointer's compatibility click into a mouse click in both mode", () => {
    const { button, runEvent } = renderWidget("both");
    const touchClick = new MouseEvent("click", { bubbles: true, detail: 1 });
    Object.defineProperty(touchClick, "pointerType", { value: "touch" });
    fireEvent(button, touchClick);
    fireEvent.click(button, { detail: 1 });
    expect(runEvent.mock.calls.map(([, event]) => event)).toEqual(["onClick"]);
  });

  it("suppresses the compatibility click after touch when the browser omits pointerType", () => {
    const { button, runEvent } = renderWidget("both");
    touchEvent(button, "touchStart", [{ clientX: 20, clientY: 30 }]);
    touchEvent(button, "touchEnd", [], [{ clientX: 20, clientY: 30 }]);
    fireEvent.click(button, { detail: 1 });
    expect(runEvent.mock.calls.map(([, event]) => event)).toEqual([
      "onTouchStart",
      "onTouchEnd",
      "onTap",
      "onClick",
    ]);

    fireEvent.click(button, { detail: 1 });
    expect(runEvent.mock.calls.map(([, event]) => event)).toEqual([
      "onTouchStart",
      "onTouchEnd",
      "onTap",
      "onClick",
      "onClick",
    ]);
  });

  it("fires touch start, tap, double-tap, and directional swipe with feedback", () => {
    const { button, runEvent, onGestureFeedback } = renderWidget("both");
    touchEvent(button, "touchStart", [{ clientX: 20, clientY: 30 }]);
    touchEvent(button, "touchEnd", [], [{ clientX: 20, clientY: 30 }]);
    touchEvent(button, "touchStart", [{ clientX: 20, clientY: 30 }]);
    touchEvent(button, "touchEnd", [], [{ clientX: 20, clientY: 30 }]);
    touchEvent(button, "touchStart", [{ clientX: 80, clientY: 30 }]);
    touchEvent(button, "touchMove", [{ clientX: 20, clientY: 30 }]);
    touchEvent(button, "touchEnd", [], [{ clientX: 20, clientY: 30 }]);
    for (const [start, end] of [
      [{ clientX: 20, clientY: 30 }, { clientX: 80, clientY: 30 }],
      [{ clientX: 30, clientY: 80 }, { clientX: 30, clientY: 20 }],
      [{ clientX: 30, clientY: 20 }, { clientX: 30, clientY: 80 }],
    ]) {
      touchEvent(button, "touchStart", [start]);
      touchEvent(button, "touchEnd", [], [end]);
    }

    const events = runEvent.mock.calls.map(([, event]) => event);
    expect(events).toContain("onTouchStart");
    expect(events).toContain("onTouchEnd");
    expect(events).toContain("onTap");
    expect(events).toContain("onDoubleTap");
    expect(events).toContain("onSwipeLeft");
    expect(events).toContain("onSwipeRight");
    expect(events).toContain("onSwipeUp");
    expect(events).toContain("onSwipeDown");
    expect(onGestureFeedback).toHaveBeenCalledWith("onTouchStart", 20, 30);
    expect(onGestureFeedback).toHaveBeenCalledWith("onSwipeLeft", 20, 30);
  });

  it("recognizes long press, pinch, and two-finger pan", () => {
    vi.useFakeTimers();
    try {
      const { button, runEvent } = renderWidget("touch");
      touchEvent(button, "touchStart", [{ clientX: 30, clientY: 30 }]);
      vi.advanceTimersByTime(550);
      expect(runEvent.mock.calls.map(([, event]) => event)).toContain("onLongPress");

      touchEvent(button, "touchStart", [
        { clientX: 20, clientY: 20 },
        { clientX: 80, clientY: 20 },
      ]);
      touchEvent(button, "touchMove", [
        { clientX: 0, clientY: 20 },
        { clientX: 100, clientY: 20 },
      ]);
      expect(runEvent.mock.calls.map(([, event]) => event)).toContain("onPinchOut");

      touchEvent(button, "touchStart", [
        { clientX: 0, clientY: 20 },
        { clientX: 100, clientY: 20 },
      ]);
      touchEvent(button, "touchMove", [
        { clientX: 30, clientY: 20 },
        { clientX: 70, clientY: 20 },
      ]);
      expect(runEvent.mock.calls.map(([, event]) => event)).toContain("onPinchIn");

      touchEvent(button, "touchStart", [
        { clientX: 20, clientY: 20 },
        { clientX: 80, clientY: 20 },
      ]);
      touchEvent(button, "touchMove", [
        { clientX: 40, clientY: 40 },
        { clientX: 100, clientY: 40 },
      ]);
      expect(runEvent.mock.calls.map(([, event]) => event)).toContain("onPan");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("PreviewWidget accordion", () => {
  it("expands and collapses configured sections in Preview", () => {
    const project = createEmptyProject("Accordion preview");
    const runtime = new PreviewRuntime(project);
    const widget: Widget = {
      ...makeWidget(),
      type: "accordion",
      props: {
        label: "Help",
        items: [
          { title: "What is Proto Flow?", answer: "A prototyping tool." },
          { title: "Can I customize it?", content: "Yes, using widget properties." },
        ],
      },
    };
    const runEvent = vi.fn(() => 0);
    const rendered = render(
      <PreviewWidget
        widget={widget}
        runtime={runtime}
        screenId={project.screens[0].id}
        snapshot={runtime.snapshot()}
        runEvent={runEvent}
        onError={vi.fn()}
        controlValues={{}}
        onControlValueChange={vi.fn()}
        onGestureFeedback={vi.fn()}
        liteMode={false}
      />,
    );

    const firstSection = rendered.getByRole("button", { name: "What is Proto Flow?" });
    expect(firstSection).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(firstSection);
    expect(firstSection).toHaveAttribute("aria-expanded", "true");
    expect(rendered.getByRole("region")).toHaveTextContent("A prototyping tool.");
    expect(runEvent).toHaveBeenCalledWith(widget, "onClick", undefined);

    fireEvent.click(firstSection);
    expect(firstSection).toHaveAttribute("aria-expanded", "false");
    expect(rendered.queryByRole("region")).not.toBeInTheDocument();
    const controlledPanel = rendered.container.querySelector<HTMLElement>(
      `#${firstSection.getAttribute("aria-controls")}`,
    );
    expect(controlledPanel).toBeInTheDocument();
    expect(controlledPanel).toHaveAttribute("hidden");
  });
});

describe("PreviewWidget navigation and timeline elements", () => {
  function renderElement(type: string, props: Record<string, unknown> = {}) {
    const project = createEmptyProject("Element preview");
    const runtime = new PreviewRuntime(project);
    const widget: Widget = { ...makeWidget(), type, props };
    const runEvent = vi.fn(() => 0);
    const rendered = render(
      <PreviewWidget
        widget={widget}
        runtime={runtime}
        screenId={project.screens[0].id}
        snapshot={runtime.snapshot()}
        runEvent={runEvent}
        onError={vi.fn()}
        controlValues={{}}
        onControlValueChange={vi.fn()}
        onGestureFeedback={vi.fn()}
        liteMode={false}
      />,
    );
    return { ...rendered, widget, runEvent };
  }

  it("changes pagination page and disables navigation at the ends", () => {
    const rendered = renderElement("pagination", { pageCount: 3 });
    expect(rendered.getByRole("button", { name: "Previous page" })).toBeDisabled();
    fireEvent.click(rendered.getByRole("button", { name: "Page 2" }));
    expect(rendered.getByRole("button", { name: "Page 2" })).toHaveAttribute("aria-current", "page");
    expect(rendered.getByRole("button", { name: "Previous page" })).toBeEnabled();
    fireEvent.click(rendered.getByRole("button", { name: "Next page" }));
    expect(rendered.getByRole("button", { name: "Page 3" })).toHaveAttribute("aria-current", "page");
    expect(rendered.getByRole("button", { name: "Next page" })).toBeDisabled();
    expect(rendered.runEvent).toHaveBeenCalledWith(rendered.widget, "onChange", undefined);
  });

  it("renders breadcrumb items and marks the current location", () => {
    const rendered = renderElement("breadcrumb", { items: ["Home", "Projects", "Current"] });
    expect(rendered.getByRole("navigation", { name: "Breadcrumb" })).toBeInTheDocument();
    expect(rendered.getByText("Current")).toHaveAttribute("aria-current", "page");
    expect(rendered.getByRole("button", { name: "Projects" })).toBeInTheDocument();
  });

  it("renders timeline entries and their descriptions", () => {
    const rendered = renderElement("timeline", {
      items: [
        { title: "Created", description: "Project started" },
        { title: "Reviewed", date: "Today" },
      ],
    });
    expect(rendered.getByRole("list", { name: "Timeline" })).toBeInTheDocument();
    expect(rendered.getByText("Created")).toBeInTheDocument();
    expect(rendered.getByText("Project started")).toBeInTheDocument();
    expect(rendered.getByText("Today")).toBeInTheDocument();
  });

  it("renders the floating action button as a real button", () => {
    const rendered = renderElement("fab", { label: "Create item", iconText: "+" });
    fireEvent.click(rendered.getByRole("button", { name: "Create item" }));
    expect(rendered.runEvent).toHaveBeenCalledWith(rendered.widget, "onClick", undefined);
  });

  it("switches tabs and displays the selected content", () => {
    const rendered = renderElement("tabs", {
      items: [
        { label: "Overview", content: "Overview details" },
        { label: "Activity", content: "Recent activity" },
      ],
    });
    fireEvent.click(rendered.getByRole("tab", { name: "Activity" }));
    expect(rendered.getByRole("tab", { name: "Activity" })).toHaveAttribute("aria-selected", "true");
    expect(rendered.getByRole("tabpanel")).toHaveTextContent("Recent activity");
    expect(rendered.runEvent).toHaveBeenCalledWith(rendered.widget, "onChange", undefined);
  });

  it("opens a menu and runs the click rule for a selected item", () => {
    const rendered = renderElement("dropdown-menu", { items: ["Edit", "Delete"] });
    fireEvent.click(rendered.getByRole("button", { name: "Options ▾" }));
    fireEvent.click(rendered.getByRole("menuitem", { name: "Edit" }));
    expect(rendered.getByRole("button", { name: "Options ▾" })).toHaveAttribute("aria-expanded", "false");
    expect(rendered.runEvent).toHaveBeenCalledWith(rendered.widget, "onClick", undefined);
  });
});

describe("PreviewWidget app shell and integration elements", () => {
  function renderElement(type: string, props: Record<string, unknown> = {}) {
    const project = createEmptyProject("App shell preview");
    const runtime = new PreviewRuntime(project);
    const widget: Widget = { ...makeWidget(), type, props };
    const runEvent = vi.fn(() => 0);
    const rendered = render(
      <PreviewWidget
        widget={widget}
        runtime={runtime}
        screenId={project.screens[0].id}
        snapshot={runtime.snapshot()}
        runEvent={runEvent}
        onError={vi.fn()}
        controlValues={{}}
        onControlValueChange={vi.fn()}
        onGestureFeedback={vi.fn()}
        liteMode={false}
      />,
    );
    return { ...rendered, widget, runEvent };
  }

  it("renders navigation items for navbar and sidebar", () => {
    const navbar = renderElement("navbar", { items: ["Home", "Docs"] });
    expect(navbar.getByRole("navigation", { name: "navbar" })).toBeInTheDocument();
    expect(navbar.getByRole("button", { name: "Docs" })).toBeInTheDocument();
    cleanup();
    const sidebar = renderElement("sidebar", { items: ["Overview", "Settings"] });
    expect(sidebar.getByRole("navigation", { name: "sidebar" })).toBeInTheDocument();
    expect(sidebar.getByRole("button", { name: "Settings" })).toBeInTheDocument();
  });

  it("renders configured form fields and handles submit without navigating", () => {
    const rendered = renderElement("form", {
      fields: [{ label: "Email", placeholder: "you@example.com" }],
    });
    expect(rendered.getByRole("textbox", { name: "Email" })).toHaveAttribute("placeholder", "you@example.com");
    fireEvent.click(rendered.getByRole("button", { name: "Submit" }));
    expect(rendered.runEvent).toHaveBeenCalledWith(rendered.widget, "onChange", undefined);
  });

  it("shows an honest non-connected state for cloud and websocket previews", () => {
    const cloud = renderElement("cloud-sync", {});
    expect(cloud.getByText("Not connected")).toBeInTheDocument();
    expect(cloud.getByText(/Preview only/)).toBeInTheDocument();
    cleanup();
    const socket = renderElement("websocket", { url: "wss://example.test/socket" });
    expect(socket.getByText("wss://example.test/socket")).toBeInTheDocument();
    expect(socket.getByText(/no live service connection/i)).toBeInTheDocument();
  });

  it("shows the authentication preview state without claiming a live session", () => {
    const rendered = renderElement("auth-state", {});
    expect(rendered.getByText("Signed out")).toBeInTheDocument();
    expect(rendered.getByText(/no live service connection/i)).toBeInTheDocument();
  });

  it("allows changing the responsive preview device", () => {
    const rendered = renderElement("responsive-switch", {});
    fireEvent.change(rendered.getByRole("combobox", { name: "Preview device" }), { target: { value: "Mobile" } });
    expect(rendered.getByText("Selected: Mobile")).toBeInTheDocument();
  });

  it("renders a modal layer with its configured title and content", () => {
    const rendered = renderElement("modal", { title: "Confirm", content: "Are you sure?" });
    expect(rendered.getByRole("region", { name: "Confirm" })).toHaveTextContent("Are you sure?");
    expect(rendered.getByRole("button", { name: "Close Confirm" })).toBeInTheDocument();
  });
});

describe("PreviewWidget media", () => {
  function renderMediaWidget(type: "image-gallery" | "audio", props: Record<string, unknown>) {
    const project = createEmptyProject("Media preview");
    const runtime = new PreviewRuntime(project);
    const widget: Widget = {
      ...makeWidget(),
      type,
      props,
    };
    return render(
      <PreviewWidget
        widget={widget}
        runtime={runtime}
        screenId={project.screens[0].id}
        snapshot={runtime.snapshot()}
        runEvent={vi.fn()}
        onError={vi.fn()}
        controlValues={{}}
        onControlValueChange={vi.fn()}
        onGestureFeedback={vi.fn()}
        liteMode={false}
      />,
    );
  }

  it("renders configured gallery images with their URLs and accessible alt text", () => {
    const rendered = renderMediaWidget("image-gallery", {
      label: "Product photos",
      images: [
        "https://example.com/front.png",
        { url: "https://example.com/side.png", alt: "Side view" },
      ],
    });

    expect(rendered.getByRole("region", { name: "Product photos" })).toBeInTheDocument();
    expect(rendered.getByAltText("Image 1")).toHaveAttribute("src", "https://example.com/front.png");
    expect(rendered.getByAltText("Side view")).toHaveAttribute("src", "https://example.com/side.png");
  });

  it("shows a clear empty state when no gallery images are configured", () => {
    const rendered = renderMediaWidget("image-gallery", { images: [] });
    expect(rendered.getByText("No gallery images configured")).toBeInTheDocument();
  });

  it("renders a native audio control for a configured source", () => {
    const rendered = renderMediaWidget("audio", {
      label: "Demo track",
      src: "https://example.com/demo.mp3",
    });
    const audio = rendered.container.querySelector("audio");

    expect(audio).not.toBeNull();
    expect(audio).toHaveAttribute("src", "https://example.com/demo.mp3");
    expect(audio).toHaveAttribute("controls");
    expect(audio).toHaveAttribute("preload", "metadata");
    expect(rendered.getByText("Demo track")).toBeInTheDocument();
  });

  it("shows a clear empty state when no audio source is configured", () => {
    const rendered = renderMediaWidget("audio", { label: "Voice note" });
    expect(rendered.getByText("Audio source not configured")).toBeInTheDocument();
    expect(rendered.container.querySelector("audio")).toBeNull();
  });
});

describe("PreviewWidget colours", () => {
  it("applies fill and stroke opacity like the canvas, so a 10% container stays pale", () => {
    const project = createEmptyProject("Colour preview");
    const runtime = new PreviewRuntime(project);
    const widget: Widget = {
      ...makeWidget(),
      type: "container",
      style: { fill: "#f59e0b", fillOpacity: 0.1, stroke: "#f59e0b", strokeOpacity: 0.5, strokeWidth: 1 },
      props: { label: "Box" },
    };
    const { container } = render(
      <PreviewWidget
        widget={widget}
        runtime={runtime}
        screenId={project.screens[0].id}
        snapshot={runtime.snapshot()}
        runEvent={vi.fn()}
        onError={vi.fn()}
        controlValues={{}}
        onControlValueChange={vi.fn()}
        onGestureFeedback={vi.fn()}
        liteMode={false}
      />,
    );
    const element = container.querySelector<HTMLElement>('section[aria-label="Box"]');
    expect(element?.style.backgroundColor).toBe("rgba(245, 158, 11, 0.1)");
    expect(element?.style.border).toContain("rgba(245, 158, 11, 0.5)");
    cleanup();
  });

  it("applies fill opacity to text colour", () => {
    const project = createEmptyProject("Text colour preview");
    const runtime = new PreviewRuntime(project);
    const widget: Widget = {
      ...makeWidget(),
      type: "text",
      style: { fill: "#24212b", fillOpacity: 0.5 },
      props: { text: "Hello" },
    };
    const { container } = render(
      <PreviewWidget
        widget={widget}
        runtime={runtime}
        screenId={project.screens[0].id}
        snapshot={runtime.snapshot()}
        runEvent={vi.fn()}
        onError={vi.fn()}
        controlValues={{}}
        onControlValueChange={vi.fn()}
        onGestureFeedback={vi.fn()}
        liteMode={false}
      />,
    );
    const element = container.querySelector<HTMLElement>('[data-widget-type="text"]');
    expect(element?.style.color).toBe("rgba(36, 33, 43, 0.5)");
    expect(element?.style.backgroundColor).toBe("transparent");
    cleanup();
  });
});
