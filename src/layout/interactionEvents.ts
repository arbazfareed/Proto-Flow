import type { InteractionRule } from "../project/schema";
import type { ScreenInputMode } from "../project/inputModes";

export const INTERACTION_EVENTS = [
  ["onClick", "Click"],
  ["onDoubleClick", "Double click"],
  ["onRightClick", "Right click"],
  ["onHover", "Hover"],
  ["onMouseDown", "Mouse down"],
  ["onMouseUp", "Mouse up"],
  ["onChange", "Change"],
  ["onLoad", "Load"],
  ["onTap", "Tap"],
  ["onDoubleTap", "Double tap"],
  ["onLongPress", "Long press"],
  ["onSwipeLeft", "Swipe left"],
  ["onSwipeRight", "Swipe right"],
  ["onSwipeUp", "Swipe up"],
  ["onSwipeDown", "Swipe down"],
  ["onPinchIn", "Pinch in"],
  ["onPinchOut", "Pinch out"],
  ["onPan", "Two-finger pan"],
  ["onTouchStart", "Touch start"],
  ["onTouchEnd", "Touch end"],
  ["onFocus", "Focus"],
  ["onBlur", "Blur"],
  ["onKeyDown", "Key down"],
] as const;

const ALWAYS_AVAILABLE_EVENTS = new Set(["onChange", "onLoad", "onFocus", "onBlur", "onKeyDown"]);
const MOUSE_EVENTS = new Set([
  "onClick", "onDoubleClick", "onRightClick", "onHover", "onMouseDown", "onMouseUp",
]);
const TOUCH_EVENTS = new Set([
  "onTap", "onDoubleTap", "onLongPress", "onSwipeLeft", "onSwipeRight", "onSwipeUp",
  "onSwipeDown", "onPinchIn", "onPinchOut", "onPan", "onTouchStart", "onTouchEnd",
]);

export function getEventsForInputMode(
  mode: ScreenInputMode,
  currentEvent: InteractionRule["event"],
) {
  return INTERACTION_EVENTS.filter(([event]) =>
    ALWAYS_AVAILABLE_EVENTS.has(event) ||
    (mode !== "touch" && MOUSE_EVENTS.has(event)) ||
    (mode !== "mouse" && TOUCH_EVENTS.has(event)) ||
    event === currentEvent,
  );
}

export function isEventAvailableInMode(
  mode: ScreenInputMode,
  event: InteractionRule["event"],
): boolean {
  return ALWAYS_AVAILABLE_EVENTS.has(event) ||
    (mode !== "touch" && MOUSE_EVENTS.has(event)) ||
    (mode !== "mouse" && TOUCH_EVENTS.has(event));
}
