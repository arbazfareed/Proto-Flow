import { useEffect, useRef, useSyncExternalStore } from "react";
import { Command } from "cmdk";
import { Keyboard, Search } from "lucide-react";
import { commandRegistry } from "../commands/registry";
import { useStore } from "../store";

export function CommandPalette() {
  const paletteOpen = useStore((state) => state.paletteOpen);
  const setPaletteOpen = useStore((state) => state.setPaletteOpen);
  const commands = useSyncExternalStore(
    commandRegistry.subscribe,
    commandRegistry.getSnapshot,
    commandRegistry.getSnapshot,
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!paletteOpen) return;

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inputRef.current?.focus();

    return () => {
      if (previousFocusRef.current?.isConnected) previousFocusRef.current.focus();
      previousFocusRef.current = null;
    };
  }, [paletteOpen]);

  if (!paletteOpen) return null;

  return (
    <div
      className="overlay palette-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setPaletteOpen(false);
      }}
    >
      <section
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;

          const focusable = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              'input:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ),
          ).filter((element) => element.getClientRects().length > 0);
          const first = focusable[0];
          const last = focusable[focusable.length - 1];

          if (!first || !last) {
            event.preventDefault();
          } else if (
            !event.currentTarget.contains(document.activeElement) ||
            (event.shiftKey && document.activeElement === first) ||
            (!event.shiftKey && document.activeElement === last)
          ) {
            event.preventDefault();
            (event.shiftKey ? last : first).focus();
          }
        }}
      >
        <Command label="Command palette" loop>
          <div className="palette-search">
            <Search size={17} />
            <Command.Input
              ref={inputRef}
              placeholder="What would you like to do?"
              aria-label="Filter commands"
            />
            <kbd>ESC</kbd>
          </div>
          <Command.List className="palette-list">
            <Command.Empty className="palette-empty">No results</Command.Empty>
            <Command.Group heading="ACTIONS" className="palette-group">
              {commands.map((command) => (
                <Command.Item
                  className="palette-item"
                  key={command.id}
                  value={command.label}
                  keywords={command.keywords}
                  onSelect={() => {
                    setPaletteOpen(false);
                    void command.run();
                  }}
                >
                  <span className="palette-item-icon">{command.icon}</span>
                  <span>{command.label}</span>
                  {command.shortcut && <kbd>{command.shortcut}</kbd>}
                </Command.Item>
              ))}
            </Command.Group>
          </Command.List>
          <div className="palette-footer">
            <span><Keyboard size={13} /> Navigate with your keyboard</span>
            <span>PROTO FLOW <b>·</b> PHASE 1</span>
          </div>
        </Command>
      </section>
    </div>
  );
}
