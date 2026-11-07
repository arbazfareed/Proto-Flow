import { describe, expect, it } from "vitest";
import { getEventsForInputMode, isEventAvailableInMode } from "./interactionEvents";

describe("interaction event input-mode filtering", () => {
  it("shows only touch and keyboard-compatible triggers in touch mode", () => {
    const events = getEventsForInputMode("touch", "onClick").map(([event]) => event);
    expect(events).toContain("onTap");
    expect(events).toContain("onTouchStart");
    expect(events).toContain("onFocus");
    expect(events).toContain("onBlur");
    expect(events).toContain("onKeyDown");
    expect(events).toContain("onClick");
    expect(events).not.toContain("onMouseDown");
    expect(isEventAvailableInMode("touch", "onClick")).toBe(false);
    expect(isEventAvailableInMode("touch", "onKeyDown")).toBe(true);
  });

  it("shows only mouse and keyboard-compatible triggers in mouse mode", () => {
    const events = getEventsForInputMode("mouse", "onTap").map(([event]) => event);
    expect(events).toContain("onClick");
    expect(events).toContain("onRightClick");
    expect(events).toContain("onMouseDown");
    expect(events).toContain("onFocus");
    expect(events).toContain("onBlur");
    expect(events).toContain("onKeyDown");
    expect(events).toContain("onTap");
    expect(events).not.toContain("onSwipeLeft");
    expect(isEventAvailableInMode("mouse", "onTap")).toBe(false);
    expect(isEventAvailableInMode("mouse", "onClick")).toBe(true);
  });

  it("shows touch, mouse, and keyboard triggers in both mode", () => {
    const events = getEventsForInputMode("both", "onClick").map(([event]) => event);
    expect(events).toContain("onClick");
    expect(events).toContain("onMouseUp");
    expect(events).toContain("onTap");
    expect(events).toContain("onPinchOut");
    expect(events).toContain("onKeyDown");
    expect(isEventAvailableInMode("both", "onSwipeDown")).toBe(true);
    expect(isEventAvailableInMode("both", "onRightClick")).toBe(true);
  });
});
