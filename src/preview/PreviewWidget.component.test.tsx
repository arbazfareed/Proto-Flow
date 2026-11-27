import { cleanup, fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createEmptyProject, type Project, type Widget } from "../project/schema";
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

function renderWidget(mode: "touch" | "mouse" | "both" = "both", symbols: import("../project/schema").SymbolDefinition[] = []) {
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
      symbols={symbols}
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

describe("PreviewWidget semantic and structural elements", () => {
  it("renders heading, paragraph, label, and link as semantic elements", () => {
    const project = createEmptyProject("Semantic preview");
    const runtime = new PreviewRuntime(project);
    const widgets: Widget[] = [
      { ...makeWidget(), id: crypto.randomUUID(), type: "heading", props: { text: "Welcome", level: 3 } },
      { ...makeWidget(), id: crypto.randomUUID(), type: "paragraph", props: { text: "Introductory text" } },
      { ...makeWidget(), id: crypto.randomUUID(), type: "label", props: { text: "Email address" } },
      { ...makeWidget(), id: crypto.randomUUID(), type: "link", props: { text: "Read documentation", href: "https://example.com/docs" } },
    ];
    const rendered = render(
      <>
        {widgets.map((widget) => (
          <PreviewWidget
            key={widget.id}
            widget={widget}
            runtime={runtime}
            screenId={project.screens[0].id}
            snapshot={runtime.snapshot()}
            runEvent={vi.fn(() => 0)}
            onError={vi.fn()}
            controlValues={{}}
            onControlValueChange={vi.fn()}
            onGestureFeedback={vi.fn()}
            liteMode={false}
          />
        ))}
      </>,
    );
    expect(rendered.getByRole("heading", { level: 3, name: "Welcome" })).toBeInTheDocument();
    expect(rendered.getByText("Introductory text").tagName).toBe("P");
    expect(rendered.getByText("Email address").tagName).toBe("LABEL");
    expect(rendered.getByRole("link", { name: "Read documentation" })).toHaveAttribute("href", "https://example.com/docs");
  });

  it("renders structural widgets as boxes rather than placeholder type names", () => {
    const project = createEmptyProject("Structural preview");
    const runtime = new PreviewRuntime(project);
    const container: Widget = { ...makeWidget(), type: "container", props: {} };
    const panel: Widget = { ...makeWidget(), type: "panel", props: { label: "Settings" } };
    const rendered = render(
      <>
        <PreviewWidget widget={container} runtime={runtime} screenId={project.screens[0].id} snapshot={runtime.snapshot()} runEvent={vi.fn(() => 0)} onError={vi.fn()} controlValues={{}} onControlValueChange={vi.fn()} onGestureFeedback={vi.fn()} liteMode={false} />
        <PreviewWidget widget={panel} runtime={runtime} screenId={project.screens[0].id} snapshot={runtime.snapshot()} runEvent={vi.fn(() => 0)} onError={vi.fn()} controlValues={{}} onControlValueChange={vi.fn()} onGestureFeedback={vi.fn()} liteMode={false} />
      </>,
    );
    expect(rendered.getByRole("region", { name: "Settings" })).toHaveClass("preview-layout", "is-panel");
    expect(rendered.queryByText("container")).not.toBeInTheDocument();
    expect(rendered.queryByText("panel")).not.toBeInTheDocument();
  });
});

describe("PreviewWidget reusable symbols", () => {
  it("renders a symbol instance using its master component contents", () => {
    const project = createEmptyProject("Symbol preview");
    const symbolId = crypto.randomUUID();
    const childId = crypto.randomUUID();
    const symbol = {
      id: symbolId,
      name: "Primary action",
      width: 160,
      height: 48,
      widgets: [{
        ...makeWidget(),
        id: childId,
        type: "button",
        x: 0,
        y: 0,
        width: 160,
        height: 48,
        props: { label: "Master action" },
      }],
    };
    const instance: Widget = {
      ...makeWidget(),
      type: "symbol-instance",
      width: 160,
      height: 48,
      name: "Primary action",
      symbolId,
      props: { label: "Primary action", symbolOverrides: { [childId]: { props: { label: "Instance override" } } } },
    };
    const runtime = new PreviewRuntime(project);
    const rendered = render(
      <PreviewWidget
        widget={instance}
        runtime={runtime}
        screenId={project.screens[0].id}
        snapshot={runtime.snapshot()}
        runEvent={vi.fn(() => 0)}
        onError={vi.fn()}
        controlValues={{}}
        onControlValueChange={vi.fn()}
        onGestureFeedback={vi.fn()}
        liteMode={false}
        symbols={[symbol]}
      />,
    );
    expect(rendered.getByRole("group", { name: "Primary action" })).toHaveAttribute("data-symbol-id", symbolId);
    expect(rendered.getByRole("button", { name: "Instance override" })).toBeInTheDocument();
  });

  it("uses the real child Preview renderer so symbol child interactions work", () => {
    const project = createEmptyProject("Interactive symbol preview");
    const symbolId = crypto.randomUUID();
    const child = { ...makeWidget(), id: crypto.randomUUID(), props: { label: "Master action" } };
    const symbol = { id: symbolId, name: "Interactive master", width: 120, height: 40, widgets: [child] };
    const instance: Widget = { ...makeWidget(), type: "symbol-instance", width: 120, height: 40, symbolId };
    const runtime = new PreviewRuntime(project);
    const runEvent = vi.fn(() => 1);
    const rendered = render(
      <PreviewWidget
        widget={instance}
        runtime={runtime}
        screenId={project.screens[0].id}
        snapshot={runtime.snapshot()}
        runEvent={runEvent}
        onError={vi.fn()}
        controlValues={{}}
        onControlValueChange={vi.fn()}
        onGestureFeedback={vi.fn()}
        liteMode={false}
        symbols={[symbol]}
      />,
    );
    fireEvent.click(rendered.getByRole("button", { name: "Master action" }));
    expect(runEvent).toHaveBeenCalledWith(child, "onClick", undefined);
  });

  it("shows an explicit placeholder when a symbol definition is missing", () => {
    const project = createEmptyProject("Missing symbol preview");
    const instance: Widget = {
      ...makeWidget(),
      type: "symbol-instance",
      symbolId: crypto.randomUUID(),
      name: "Deleted component",
    };
    const runtime = new PreviewRuntime(project);
    const rendered = render(
      <PreviewWidget
        widget={instance}
        runtime={runtime}
        screenId={project.screens[0].id}
        snapshot={runtime.snapshot()}
        runEvent={vi.fn(() => 0)}
        onError={vi.fn()}
        controlValues={{}}
        onControlValueChange={vi.fn()}
        onGestureFeedback={vi.fn()}
        liteMode={false}
        symbols={[]}
      />,
    );
    expect(rendered.getByRole("group", { name: "Missing component: Deleted component" })).toHaveTextContent("Missing component");
  });
});

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
    expect(rendered.getByRole("region", { name: "Help" })).toHaveTextContent("A prototyping tool.");
    expect(runEvent).toHaveBeenCalledWith(widget, "onClick", undefined);

    fireEvent.click(firstSection);
    expect(firstSection).toHaveAttribute("aria-expanded", "false");
    // The labeled accordion section stays visible; only its controlled item panel collapses.
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

  it("renders typed, required form fields and fires the supported submit click rule", () => {
    const rendered = renderElement("form", {
      fields: [{ label: "Email", name: "email", type: "email", required: true, placeholder: "you@example.com" }],
    });
    const email = rendered.getByRole("textbox", { name: "Email" });
    expect(email).toHaveAttribute("placeholder", "you@example.com");
    expect(email).toHaveAttribute("type", "email");
    expect(email).toBeRequired();
    fireEvent.change(email, { target: { value: "person@example.com" } });
    fireEvent.click(rendered.getByRole("button", { name: "Submit" }));
    expect(rendered.runEvent).toHaveBeenCalledWith(rendered.widget, "onClick", undefined);
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

describe("PreviewWidget carousel and data elements", () => {
  function renderElement(type: string, props: Record<string, unknown> = {}) {
    const project = createEmptyProject("Data element preview");
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

  it("moves through carousel slides and wraps at the end", () => {
    const rendered = renderElement("carousel", {
      items: [
        { src: "https://example.com/one.png", alt: "First slide" },
        { url: "https://example.com/two.png", title: "Second slide" },
      ],
    });
    expect(rendered.getByAltText("First slide")).toHaveAttribute("src", "https://example.com/one.png");
    fireEvent.click(rendered.getByRole("button", { name: "Next slide" }));
    expect(rendered.getByAltText("Second slide")).toHaveAttribute("src", "https://example.com/two.png");
    expect(rendered.getByText("2 / 2")).toBeInTheDocument();
    fireEvent.click(rendered.getByRole("button", { name: "Next slide" }));
    expect(rendered.getByAltText("First slide")).toBeInTheDocument();
    expect(rendered.runEvent).toHaveBeenCalledWith(rendered.widget, "onChange", undefined);
  });

  it("shows an empty state for an unconfigured carousel", () => {
    const rendered = renderElement("carousel", { items: [] });
    expect(rendered.getByText("No carousel slides configured")).toBeInTheDocument();
  });

  it("shows API request details but never sends a request in Preview", () => {
    const rendered = renderElement("api-request", { method: "POST", url: "https://example.test/api" });
    expect(rendered.getByText("POST")).toBeInTheDocument();
    expect(rendered.getByText("https://example.test/api")).toBeInTheDocument();
    fireEvent.click(rendered.getByRole("button", { name: "Run request" }));
    expect(rendered.getByText("Preview only · request was not sent")).toBeInTheDocument();
    expect(rendered.runEvent).toHaveBeenCalledWith(rendered.widget, "onClick", undefined);
  });

  it("renders configured database columns and rows without connecting to a database", () => {
    const rendered = renderElement("database", {
      columns: ["Name", "Status"],
      rows: [{ Name: "Alpha", Status: "Ready" }, { Name: "Beta", Status: "Draft" }],
    });
    expect(rendered.getByRole("table")).toBeInTheDocument();
    expect(rendered.getByText("Alpha")).toBeInTheDocument();
    expect(rendered.getByText("Draft")).toBeInTheDocument();
    expect(rendered.getByText("Preview only · no live database connection")).toBeInTheDocument();
  });

  it("shows a clear empty state when no database table data is configured", () => {
    const rendered = renderElement("database", {});
    expect(rendered.getByText("No table data configured")).toBeInTheDocument();
  });
});

describe("PreviewWidget settings and gesture elements", () => {
  function renderElement(type: string, props: Record<string, unknown> = {}) {
    const project = createEmptyProject("Settings and gesture preview");
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

  it("renders configured settings entries", () => {
    const rendered = renderElement("settings", {
      items: [{ label: "Notifications", description: "Manage alerts" }],
    });
    expect(rendered.getByText("Notifications")).toBeInTheDocument();
    expect(rendered.getByText("Manage alerts")).toBeInTheDocument();
  });

  it("switches the theme preview between light and dark", () => {
    const rendered = renderElement("theme", {});
    const theme = rendered.getByRole("region", { name: "Theme" });
    expect(theme).toHaveStyle({ backgroundColor: "#ffffff" });
    fireEvent.change(rendered.getByRole("combobox", { name: "Theme appearance" }), { target: { value: "dark" } });
    expect(theme).toHaveStyle({ backgroundColor: "#1f2937" });
  });

  it("triggers the pull-to-refresh gesture rule from its Preview control", () => {
    const rendered = renderElement("pull-to-refresh", {});
    fireEvent.click(rendered.getByRole("button", { name: "Refresh preview" }));
    expect(rendered.getByText("Refresh interaction triggered")).toBeInTheDocument();
    expect(rendered.runEvent).toHaveBeenCalledWith(rendered.widget, "onSwipeDown", undefined);
  });

  it("simulates directional swipe rules from accessible Preview controls", () => {
    const rendered = renderElement("swipe-gesture", {});
    fireEvent.click(rendered.getByRole("button", { name: "Swipe Left" }));
    expect(rendered.getByText("Last gesture: swipe left")).toBeInTheDocument();
    expect(rendered.runEvent).toHaveBeenCalledWith(rendered.widget, "onSwipeLeft", undefined);
  });
});

describe("PreviewWidget form controls and data components", () => {
  function renderElement(type: string, props: Record<string, unknown> = {}) {
    const project = createEmptyProject("Control preview");
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

  it("updates select values and fires change rules", () => {
    const rendered = renderElement("select", { label: "Country", options: ["Pakistan", "Japan"] });
    fireEvent.change(rendered.getByRole("combobox", { name: "Country" }), { target: { value: "Japan" } });
    expect(rendered.runEvent).toHaveBeenCalledWith(rendered.widget, "onChange", undefined);
  });

  it("renders a bounded slider and updates it", () => {
    const rendered = renderElement("slider", { label: "Volume", min: 0, max: 10, value: 4 });
    const slider = rendered.getByRole("slider", { name: "Volume" });
    expect(slider).toHaveAttribute("max", "10");
    fireEvent.change(slider, { target: { value: "8" } });
    expect(rendered.runEvent).toHaveBeenCalledWith(rendered.widget, "onChange", undefined);
  });

  it("increments and decrements the stepper within its limits", () => {
    const rendered = renderElement("stepper", { label: "Quantity", value: 2, min: 1, max: 3 });
    fireEvent.click(rendered.getByRole("button", { name: "Increase value" }));
    expect(rendered.getByText("3")).toBeInTheDocument();
    expect(rendered.getByRole("button", { name: "Increase value" })).toBeDisabled();
    fireEvent.click(rendered.getByRole("button", { name: "Decrease value" }));
    expect(rendered.getByText("2")).toBeInTheDocument();
  });

  it("honors a zero minimum and zero initial stepper value", () => {
    const rendered = renderElement("stepper", { label: "Quantity", value: 0, min: 0, max: 2 });
    expect(rendered.getByText("0")).toBeInTheDocument();
    expect(rendered.getByRole("button", { name: "Decrease value" })).toBeDisabled();
    fireEvent.click(rendered.getByRole("button", { name: "Increase value" }));
    expect(rendered.getByText("1")).toBeInTheDocument();
  });

  it("renders a native date input", () => {
    const rendered = renderElement("date-picker", { label: "Start date" });
    expect(rendered.getByLabelText("Start date")).toHaveAttribute("type", "date");
  });

  it("renders progress and rating controls", () => {
    const progress = renderElement("progress-bar", { value: 60 });
    expect(progress.getByRole("progressbar", { name: "Progress" })).toHaveAttribute("value", "60");
    progress.unmount();
    const rating = renderElement("rating", {});
    fireEvent.click(rating.getByRole("button", { name: "Rate 4 of 5" }));
    expect(rating.getByRole("button", { name: "Rate 4 of 5" })).toHaveAttribute("aria-pressed", "true");
  });

  it("respects configured rating maximum and initial value", () => {
    const rating = renderElement("rating", { max: 8, value: 7 });
    expect(rating.getByRole("button", { name: "Rate 7 of 8" })).toHaveAttribute("aria-pressed", "true");
    expect(rating.getByText("7/8")).toBeInTheDocument();
  });

  it("opens and closes popover content", () => {
    const rendered = renderElement("popover", { triggerLabel: "More info", content: "Additional details" });
    fireEvent.click(rendered.getByRole("button", { name: "More info" }));
    expect(rendered.getByText("Additional details")).toBeInTheDocument();
    fireEvent.click(rendered.getByRole("button", { name: "More info" }));
    expect(rendered.queryByText("Additional details")).not.toBeInTheDocument();
  });

  it("dismisses a notification", () => {
    const rendered = renderElement("notification", { label: "New message" });
    fireEvent.click(rendered.getByRole("button", { name: "Dismiss notification" }));
    expect(rendered.queryByText("New message")).not.toBeInTheDocument();
  });

  it("renders avatar initials and grouped avatars", () => {
    const avatar = renderElement("avatar", { label: "Ada Lovelace" });
    expect(avatar.getByRole("img", { name: "Ada Lovelace" })).toHaveTextContent("AL");
    avatar.unmount();
    const group = renderElement("avatar-group", { items: ["Ada Lovelace", "Grace Hopper"] });
    expect(group.getByRole("img", { name: "Ada Lovelace" })).toBeInTheDocument();
    expect(group.getByRole("img", { name: "Grace Hopper" })).toBeInTheDocument();
  });

  it("changes the selected segmented-control option", () => {
    const rendered = renderElement("segmented-control", { items: ["Overview", "Activity"] });
    fireEvent.click(rendered.getByRole("button", { name: "Activity" }));
    expect(rendered.getByRole("button", { name: "Activity" })).toHaveAttribute("aria-pressed", "true");
    expect(rendered.runEvent).toHaveBeenCalledWith(rendered.widget, "onChange", undefined);
  });

  it("marks the configured current step in a step indicator", () => {
    const rendered = renderElement("step-indicator", { items: ["Details", "Shipping", "Review"], step: 2 });
    expect(rendered.getByText("Shipping").closest("li")).toHaveAttribute("aria-current", "step");
  });

  it("renders geometric primitives as actual shapes rather than labels", () => {
    const polygon = renderElement("polygon", {});
    expect(polygon.getByRole("img", { name: "polygon" })).toHaveStyle({ clipPath: expect.stringContaining("polygon(") });
    polygon.unmount();
    const star = renderElement("star", {});
    expect(star.getByRole("img", { name: "star" })).toHaveStyle({ clipPath: expect.stringContaining("polygon(") });
    star.unmount();
    const divider = renderElement("divider", { orientation: "vertical" });
    expect(divider.getByRole("separator")).toHaveAttribute("aria-orientation", "vertical");
  });

  it("renders configured vector path data in SVG Preview", () => {
    const rendered = renderElement("vector", { pathData: "M0 0 L20 20" });
    expect(rendered.container.querySelector("svg path")).toHaveAttribute("d", "M0 0 L20 20");
  });

  it("shows the selected file name in the upload control", () => {
    const rendered = renderElement("file-upload", { label: "Attachment" });
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    fireEvent.change(rendered.getByLabelText("Attachment"), { target: { files: [file] } });
    expect(rendered.getByText("notes.txt")).toBeInTheDocument();
    expect(rendered.runEvent).toHaveBeenCalledWith(rendered.widget, "onChange", undefined);
  });

  it("actually removes a dismissed alert from Preview", () => {
    const rendered = renderElement("alert", { label: "Saved", dismissible: true });
    fireEvent.click(rendered.getByRole("button", { name: "Dismiss alert" }));
    expect(rendered.queryByText("Saved")).not.toBeInTheDocument();
  });

  it("renders configured table rows", () => {
    const rendered = renderElement("table", { columns: ["Name"], rows: [{ Name: "Ada" }] });
    expect(rendered.getByRole("table")).toBeInTheDocument();
    expect(rendered.getByText("Ada")).toBeInTheDocument();
  });

  it("renders Grid items as a responsive CSS grid rather than a data table", () => {
    const rendered = renderElement("grid", { label: "Team", columns: 2, items: ["Ada", "Grace", "Katherine"] });
    const grid = rendered.getByRole("list", { name: "Team" });
    expect(grid).toHaveStyle({ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))" });
    expect(rendered.getAllByRole("listitem")).toHaveLength(3);
    expect(rendered.queryByRole("table")).not.toBeInTheDocument();
    expect(rendered.getByText("Katherine")).toBeInTheDocument();
  });

  it("renders a navigable month calendar and places configured events on their dates", () => {
    const rendered = renderElement("calendar", {
      month: "2026-11",
      events: [{ date: "2026-11-27", title: "Release review" }],
    });
    expect(rendered.getByText("November 2026")).toBeInTheDocument();
    expect(rendered.getByRole("gridcell", { name: "2026-11-27: Release review" })).toBeInTheDocument();
    fireEvent.click(rendered.getByRole("button", { name: "Next month" }));
    expect(rendered.getByText("December 2026")).toBeInTheDocument();
    fireEvent.click(rendered.getByRole("button", { name: "Previous month" }));
    expect(rendered.getByText("November 2026")).toBeInTheDocument();
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


describe("PreviewWidget component masters", () => {
  it("renders Component Master as a labeled master container instead of a fake type-name placeholder", () => {
    const project = createEmptyProject("Component master preview");
    const runtime = new PreviewRuntime(project);
    const widget: Widget = {
      ...makeWidget(),
      type: "component-master",
      props: { label: "Primary Button" },
    };
    const rendered = render(
      <PreviewWidget
        widget={widget}
        runtime={runtime}
        screenId={project.screens[0].id}
        snapshot={runtime.snapshot()}
        runEvent={vi.fn(() => 0)}
        onError={vi.fn()}
        controlValues={{}}
        onControlValueChange={vi.fn()}
        onGestureFeedback={vi.fn()}
        liteMode={false}
      />,
    );
    const master = rendered.getByRole("group", { name: "Primary Button" });
    expect(master).toHaveAttribute("data-widget-type", "component-master");
    expect(rendered.getByText("MASTER COMPONENT")).toBeInTheDocument();
    expect(rendered.getByText("Primary Button")).toBeInTheDocument();
    expect(rendered.queryByText("component master")).not.toBeInTheDocument();
  });
});


describe("PreviewWidget form, card, navigation, and settings behavior", () => {
  function renderConfiguredWidget(widget: Widget, runEvent = vi.fn(() => 0), variables: Project["variables"] = []) {
    const project = createEmptyProject("Configured widget preview");
    project.variables = variables;
    const runtime = new PreviewRuntime(project);
    const onNavigate = vi.fn();
    const rendered = render(
      <PreviewWidget
        widget={widget}
        runtime={runtime}
        screenId={project.screens[0].id}
        snapshot={runtime.snapshot()}
        runEvent={runEvent}
        onError={vi.fn()}
        onNavigate={onNavigate}
        controlValues={{}}
        onControlValueChange={vi.fn()}
        onGestureFeedback={vi.fn()}
        liteMode={false}
      />,
    );
    return { ...rendered, runEvent, runtime, onNavigate };
  }
    const project = createEmptyProject("Configured widget preview");
    const runtime = new PreviewRuntime(project);
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
    return { ...rendered, runEvent };
  }

  it("collects configured form values on submit and reports the submitted field count", () => {
    const widget: Widget = { ...makeWidget(), type: "form", props: {
      label: "Contact form",
      fields: [
        { name: "email", label: "Email", type: "email", required: true },
        { name: "message", label: "Message", type: "text" },
      ],
    } };
    const rendered = renderConfiguredWidget(widget);
    fireEvent.change(rendered.getByRole("textbox", { name: "Email" }), { target: { value: "person@example.com" } });
    fireEvent.change(rendered.getByRole("textbox", { name: "Message" }), { target: { value: "Hello" } });
    fireEvent.submit(rendered.getByRole("form", { name: "Contact form" }));
    expect(rendered.getByRole("status")).toHaveTextContent("Submitted 2 field(s)");
    expect(rendered.runEvent).toHaveBeenCalledWith(widget, "onClick", undefined);
  });

  it("writes submitted form values into configured runtime variables", () => {
    const widget: Widget = { ...makeWidget(), type: "form", props: {
      label: "Profile form",
      fields: [{ name: "displayName", label: "Display name", type: "text", variableName: "displayName" }],
    } };
    const rendered = renderConfiguredWidget(widget, vi.fn(() => 0), [{
      id: "00000000-0000-4000-8000-000000000001",
      name: "displayName",
      scope: "project",
      type: "string",
      initial: "Guest",
    }]);
    fireEvent.change(rendered.getByRole("textbox", { name: "Display name" }), { target: { value: "Ada" } });
    fireEvent.submit(rendered.getByRole("form", { name: "Profile form" }));
    expect(rendered.runtime.getVariable("displayName")).toBe("Ada");
    expect(rendered.getByRole("status")).toHaveTextContent("displayName:");
    expect(rendered.getByRole("status")).toHaveTextContent("Ada");
  });

  it("makes the card action button keyboard accessible and interactive", () => {
    const widget: Widget = { ...makeWidget(), type: "card", props: { title: "Plan", actionLabel: "Choose plan" } };
    const rendered = renderConfiguredWidget(widget);
    const action = rendered.getByRole("button", { name: "Choose plan" });
    expect(action).not.toHaveAttribute("tabindex", "-1");
    fireEvent.click(action);
    expect(rendered.runEvent).toHaveBeenCalledWith(widget, "onClick", undefined);
  });

  it("renders editable setting controls and updates their local values", () => {
    const widget: Widget = { ...makeWidget(), type: "settings", props: { items: [
      { name: "notifications", label: "Notifications", description: "Receive updates", type: "toggle", value: false },
      { name: "displayName", label: "Display name", type: "text", value: "Guest" },
    ] } };
    const rendered = renderConfiguredWidget(widget);
    const toggle = rendered.getByRole("checkbox", { name: /Notifications/ });
    fireEvent.click(toggle);
    expect(toggle).toBeChecked();
    const displayName = rendered.getByRole("textbox", { name: /Display name/ });
    fireEvent.change(displayName, { target: { value: "Alex" } });
    expect(displayName).toHaveValue("Alex");
  });

  it("keeps Settings controls bound to runtime variables and fires change interactions", () => {
    const widget: Widget = { ...makeWidget(), type: "settings", props: { items: [
      { name: "notifications", label: "Notifications", type: "toggle", variableName: "notifications" },
    ] } };
    const rendered = renderConfiguredWidget(widget, vi.fn(() => 0), [{
      id: "00000000-0000-4000-8000-000000000002",
      name: "notifications",
      scope: "project",
      type: "boolean",
      initial: false,
    }]);
    fireEvent.click(rendered.getByRole("checkbox", { name: "Notifications" }));
    expect(rendered.runtime.getVariable("notifications")).toBe(true);
    expect(rendered.runEvent).toHaveBeenCalledWith(widget, "onChange", undefined);
  });

  it("uses configured navigation destinations and marks the selected local item", () => {
    const widget: Widget = { ...makeWidget(), type: "navbar", props: { items: [
      { label: "Home", href: "https://example.com/home" },
      { label: "Profile" },
    ] } };
    const rendered = renderConfiguredWidget(widget);
    expect(rendered.getByRole("link", { name: "Home" })).toHaveAttribute("href", "https://example.com/home");
    fireEvent.click(rendered.getByRole("button", { name: "Profile" }));
    expect(rendered.getByRole("button", { name: "Profile" })).toHaveAttribute("aria-current", "page");
  });

  it("renders edited bottom navigation labels from its label field", () => {
    const widget: Widget = { ...makeWidget(), type: "bottom-nav", props: { label: "Chats | Calls | Settings", selected: 0 } };
    const rendered = renderConfiguredWidget(widget);
    expect(rendered.getByRole("button", { name: "Chats" })).toBeInTheDocument();
    expect(rendered.getByRole("button", { name: "Calls" })).toBeInTheDocument();
    expect(rendered.getByRole("button", { name: "Settings" })).toBeInTheDocument();
  });

  it("rejects unsafe navigation destinations", () => {
    const widget: Widget = { ...makeWidget(), type: "navbar", props: { items: [
      { label: "Unsafe", href: "javascript:alert(1)" },
    ] } };
    const rendered = renderConfiguredWidget(widget);
    expect(rendered.queryByRole("link", { name: "Unsafe" })).not.toBeInTheDocument();
    expect(rendered.getByRole("button", { name: "Unsafe" })).toBeInTheDocument();
  });
  it("navigates to the screen configured on an individual navigation item", () => {
    const widget: Widget = { ...makeWidget(), type: "navbar", props: { items: [
      { label: "Dashboard", screenId: "screen-dashboard" },
    ] } };
    const rendered = renderConfiguredWidget(widget);
    fireEvent.click(rendered.getByRole("button", { name: "Dashboard" }));
    expect(rendered.onNavigate).toHaveBeenCalledWith("screen-dashboard");
    expect(rendered.runEvent).toHaveBeenCalledWith(widget, "onClick", undefined);
  });

  it("rejects unsafe navigation destinations", () => {
    const widget: Widget = { ...makeWidget(), type: "navbar", props: { items: [
      { label: "Unsafe", href: "javascript:alert(1)" },
    ] } };
    const rendered = renderConfiguredWidget(widget);
    expect(rendered.queryByRole("link", { name: "Unsafe" })).not.toBeInTheDocument();
    expect(rendered.getByRole("button", { name: "Unsafe" })).toBeInTheDocument();
  });
});

describe("PreviewWidget charts and media sources", () => {
  function renderConfigured(widget: Widget, runtime = new PreviewRuntime(createEmptyProject("Chart/media preview"))) {
    const screenId = runtime.snapshot().screenId;
    return render(
      <PreviewWidget
        widget={widget}
        runtime={runtime}
        screenId={screenId}
        snapshot={runtime.snapshot()}
        runEvent={vi.fn(() => 0)}
        onError={vi.fn()}
        controlValues={{}}
        onControlValueChange={vi.fn()}
        onGestureFeedback={vi.fn()}
        liteMode={false}
      />,
    );
  }

  it("resolves chart values from runtime variables and displays configured labels", () => {
    const project = createEmptyProject("Bound chart");
    project.variables.push({ id: crypto.randomUUID(), name: "revenue", type: "number", initial: 42, scope: "project" });
    const runtime = new PreviewRuntime(project);
    const widget: Widget = { ...makeWidget(), type: "chart", props: {
      title: "Revenue",
      values: ["[[revenue]]", -12],
      labels: ["Current", "Previous"],
      chartType: "bar",
    } };
    const rendered = renderConfigured(widget, runtime);
    expect(rendered.getByText("Current: 42")).toBeInTheDocument();
    expect(rendered.getByText("Previous: -12")).toBeInTheDocument();
    expect(rendered.getByRole("img")).toBeInTheDocument();
  });

  it("does not invent sample chart data when no values are configured", () => {
    const widget: Widget = { ...makeWidget(), type: "chart", props: { title: "Empty chart" } };
    const rendered = renderConfigured(widget);
    expect(rendered.getByText("No valid chart data configured")).toBeInTheDocument();
    expect(rendered.queryByRole("img")).not.toBeInTheDocument();
  });

  it("rejects unsafe image source protocols", () => {
    const widget: Widget = { ...makeWidget(), type: "image", props: { src: "javascript:alert(1)", alt: "Unsafe image" } };
    const rendered = renderConfigured(widget);
    expect(rendered.queryByRole("img", { name: "Unsafe image" })).not.toBeInTheDocument();
  });

  it("rejects unsafe audio and video source protocols", () => {
    const audio: Widget = { ...makeWidget(), type: "audio", props: { src: "javascript:alert(1)" } };
    const video: Widget = { ...makeWidget(), id: crypto.randomUUID(), type: "video", props: { src: "javascript:alert(1)" } };
    const project = createEmptyProject("Unsafe media");
    const runtime = new PreviewRuntime(project);
    const rendered = render(
      <>
        <PreviewWidget widget={audio} runtime={runtime} screenId={project.screens[0].id} snapshot={runtime.snapshot()} runEvent={vi.fn(() => 0)} onError={vi.fn()} controlValues={{}} onControlValueChange={vi.fn()} onGestureFeedback={vi.fn()} liteMode={false} />
        <PreviewWidget widget={video} runtime={runtime} screenId={project.screens[0].id} snapshot={runtime.snapshot()} runEvent={vi.fn(() => 0)} onError={vi.fn()} controlValues={{}} onControlValueChange={vi.fn()} onGestureFeedback={vi.fn()} liteMode={false} />
      </>,
    );
    expect(rendered.container.querySelector("audio")).not.toBeInTheDocument();
    expect(rendered.container.querySelector("video")).not.toBeInTheDocument();
    expect(rendered.getByText("Audio source not configured")).toBeInTheDocument();
  });
});
