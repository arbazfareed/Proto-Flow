import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import {
  getIconComponent,
  loadFullIconSet,
  searchIconNames,
  useFullIconSet,
} from "../canvas/iconLibrary";

type IconPickerProps = {
  label: string;
  value: string;
  disabled?: boolean;
  onChange: (name: string) => void;
};

/**
 * Pick any of the ~1,600 Lucide icons by searching (B76): the common ones show first, the
 * rest load the first time the picker opens.
 */
export function IconPicker({ label, value, disabled, onChange }: IconPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const fullSetLoaded = useFullIconSet();
  const searchRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const Current = value ? getIconComponent(value) : undefined;
  const results = open ? searchIconNames(query, 72) : [];

  useEffect(() => {
    if (!open) return;
    void loadFullIconSet().catch(() => undefined);
    searchRef.current?.focus();
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  const choose = (name: string) => {
    onChange(name);
    setOpen(false);
    setQuery("");
  };

  return (
    <div className="icon-picker" ref={rootRef}>
      <button
        type="button"
        className="icon-picker-trigger"
        aria-label={`${label}: ${value || "Mixed"}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        {Current ? <Current size={15} aria-hidden="true" /> : <span className="icon-picker-blank" />}
        <span>{value || "Mixed"}</span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {open && (
        <div
          className="icon-picker-popover"
          role="dialog"
          aria-label={`Choose ${label.toLowerCase()}`}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              setOpen(false);
            }
          }}
        >
          <label className="icon-picker-search">
            <Search size={13} aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              aria-label="Search icons"
              aria-controls={listId}
              placeholder="Search icons (send, mic, dots…)"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && results[0]) choose(results[0]);
              }}
            />
          </label>
          <div className="icon-picker-grid" id={listId} role="listbox" aria-label="Icons">
            {results.map((name) => {
              const Icon = getIconComponent(name);
              return (
                <button
                  key={name}
                  type="button"
                  role="option"
                  aria-selected={name === value}
                  aria-label={name}
                  title={name}
                  className={name === value ? "is-selected" : undefined}
                  onClick={() => choose(name)}
                >
                  {Icon ? <Icon size={18} aria-hidden="true" /> : null}
                </button>
              );
            })}
          </div>
          <p className="icon-picker-note" aria-live="polite">
            {results.length === 0
              ? fullSetLoaded ? "No icons match." : "Loading all icons…"
              : fullSetLoaded ? `Showing ${results.length} of all Lucide icons` : "Loading all icons…"}
          </p>
        </div>
      )}
    </div>
  );
}
