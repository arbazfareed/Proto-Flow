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
  const runEvent = vi.fn();
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
  it("fires mouse events and blocks pointer interactions in touch mode", () => {
    const { button, runEvent } = renderWidget("touch");
    fireEvent.doubleClick(button);
    fireEvent.contextMenu(button);
    fireEvent.mouseOver(button);
    fireEvent.mouseOut(button, { relatedTarget: document.body });
    fireEvent.mouseDown(button);
    fireEvent.mouseUp(button);
    fireEvent.click(button, { detail: 1 });
    expect(runEvent).not.toHaveBeenCalled();

    fireEvent.click(button, { detail: 0 });
    expect(runEvent).toHaveBeenCalledWith(expect.anything(), "onClick", undefined);
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
      "onHover",
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
    ]);

    fireEvent.click(button, { detail: 1 });
    expect(runEvent.mock.calls.map(([, event]) => event)).toEqual([
      "onTouchStart",
      "onTouchEnd",
      "onTap",
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
