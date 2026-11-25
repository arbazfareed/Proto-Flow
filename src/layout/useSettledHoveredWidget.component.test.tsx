import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "../store";
import { useSettledHoveredWidget } from "./useSettledHoveredWidget";

describe("useSettledHoveredWidget (B92)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useStore.getState().setCanvasHoveredWidget(null);
    useStore.getState().setLayerHoveredWidget(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with the widget that is already hovered", () => {
    useStore.getState().setCanvasHoveredWidget("a");
    const { result } = renderHook(() => useSettledHoveredWidget(150));
    expect(result.current).toBe("a");
  });

  it("does not follow a pointer that is still sweeping across widgets", () => {
    const renders = vi.fn();
    const { result } = renderHook(() => {
      renders();
      return useSettledHoveredWidget(150);
    });
    const rendersAtStart = renders.mock.calls.length;

    for (const id of ["a", "b", "c", "d", "e"]) {
      act(() => useStore.getState().setCanvasHoveredWidget(id));
      act(() => {
        vi.advanceTimersByTime(40);
      });
    }
    expect(result.current).toBeNull();
    expect(renders.mock.calls.length).toBe(rendersAtStart);
  });

  it("settles on the last widget once the pointer rests", () => {
    const { result } = renderHook(() => useSettledHoveredWidget(150));
    act(() => useStore.getState().setCanvasHoveredWidget("a"));
    act(() => useStore.getState().setCanvasHoveredWidget("b"));
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(result.current).toBe("b");
  });

  it("clears once the pointer has left and rested", () => {
    const { result } = renderHook(() => useSettledHoveredWidget(150));
    act(() => useStore.getState().setCanvasHoveredWidget("a"));
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(result.current).toBe("a");
    act(() => useStore.getState().setCanvasHoveredWidget(null));
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(result.current).toBeNull();
  });

  it("stops listening when it unmounts", () => {
    const { result, unmount } = renderHook(() => useSettledHoveredWidget(150));
    unmount();
    act(() => useStore.getState().setCanvasHoveredWidget("a"));
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current).toBeNull();
  });
});
