import { useEffect, useState } from "react";
import { useStore } from "../store";

/**
 * B92: the id of the widget the pointer is resting on. Hovering changes it constantly while the
 * pointer sweeps across a busy canvas; drawing every Layers row for each change made the editor
 * stutter. This only changes once the pointer has stayed put for `delayMs`.
 */
export function useSettledHoveredWidget(delayMs = 150): string | null {
  const [settled, setSettled] = useState<string | null>(() => useStore.getState().hoveredWidgetId);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (id: string | null) => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        setSettled(id);
      }, delayMs);
    };
    // Catch up with a change that happened between the first render and this effect.
    if (useStore.getState().hoveredWidgetId !== settled) schedule(useStore.getState().hoveredWidgetId);
    const unsubscribe = useStore.subscribe((state, previous) => {
      if (state.hoveredWidgetId !== previous.hoveredWidgetId) schedule(state.hoveredWidgetId);
    });
    return () => {
      unsubscribe();
      if (timer !== undefined) clearTimeout(timer);
    };
    // `settled` is read once, only to catch up on mount.
  }, [delayMs]); // eslint-disable-line react-hooks/exhaustive-deps
  return settled;
}
