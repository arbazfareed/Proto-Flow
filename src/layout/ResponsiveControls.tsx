import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import {
  BREAKPOINT_PRESETS,
  getScreenBreakpoints,
  getWidgetsMissingBreakpointOverrides,
  getWidgetsOutsideBreakpointViewport,
  resolveActiveBreakpoint,
  resolveWidgetsForBreakpoint,
  updateWidgetOverride,
} from "../project/responsive";
import {
  ProtoScreenSchema,
  type Breakpoint,
  type Project,
  type ResponsiveConstraints,
  type Screen,
  type Widget,
  type WidgetOverride,
} from "../project/schema";
import { useStore } from "../store";

function saveScreenUpdate(screenId: string, update: (screen: Screen) => Screen): void {
  const current = useStore.getState();
  current.setProject({
    ...current.project,
    updatedAt: new Date().toISOString(),
    screens: current.project.screens.map((screen) =>
      screen.id === screenId ? update(screen) : screen,
    ),
  });
}

function BreakpointManager({
  screen,
  onClose,
}: {
  screen: Screen;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Breakpoint[]>(() => [...getScreenBreakpoints(screen)]);
  const [error, setError] = useState("");

  const addPreset = (presetId: string) => {
    const preset = BREAKPOINT_PRESETS.find((item) => item.id === presetId);
    if (!preset || draft.some((item) => item.id === preset.id)) return;
    setDraft((current) => [...current, { ...preset }].sort((a, b) => a.minWidth - b.minWidth));
    setError("");
  };

  const addCustom = () => {
    setDraft((current) => {
      const openEnded = current.filter((item) => item.maxWidth === undefined);
      const minWidth = Math.max(
        0,
        ...current.map((item) => item.maxWidth ?? Math.max(item.minWidth, item.width)),
      ) + 1;
      return [
        ...current.map((item) =>
          openEnded.some((unbounded) => unbounded.id === item.id)
            ? { ...item, maxWidth: minWidth - 1 }
            : item,
        ),
        {
          id: `custom-${crypto.randomUUID()}`,
          name: "Custom",
          minWidth,
          width: minWidth,
          height: 768,
        },
      ].sort((a, b) => a.minWidth - b.minWidth);
    });
    setError("");
  };

  const save = () => {
    if (draft.length === 0) {
      setError("Keep at least one breakpoint on this screen.");
      return;
    }
    const retainedIds = new Set(draft.map((item) => item.id));
    const candidate: Project = {
      ...useStore.getState().project,
      screens: useStore.getState().project.screens.map((item) =>
        item.id === screen.id
          ? {
              ...item,
              breakpoints: draft,
              widgets: item.widgets.map((widget) => ({
                ...widget,
                overrides: widget.overrides
                  ? Object.fromEntries(
                      Object.entries(widget.overrides).filter(([id]) => retainedIds.has(id)),
                    )
                  : undefined,
              })),
            }
          : item,
      ),
    };
    const result = ProtoScreenSchema.safeParse(
      candidate.screens.find((item) => item.id === screen.id),
    );
    if (!result.success) {
      setError(result.error.issues.map((issue) => issue.message).join(" "));
      return;
    }
    const current = useStore.getState();
    const previouslyActive = resolveActiveBreakpoint(screen, current.activeBreakpointId).id;
    current.setProject({
      ...current.project,
      updatedAt: new Date().toISOString(),
      screens: current.project.screens.map((item) =>
        item.id !== screen.id
          ? item
          : {
              ...item,
              breakpoints: draft,
              widgets: item.widgets.map((widget) => ({
                ...widget,
                overrides: widget.overrides
                  ? Object.fromEntries(
                      Object.entries(widget.overrides).filter(([id]) => retainedIds.has(id)),
                    )
                  : undefined,
              })),
            },
      ),
    });
    if (!retainedIds.has(previouslyActive)) {
      useStore.getState().setActiveBreakpoint(draft[0].id);
    }
    onClose();
  };

  return (
    <div className="breakpoint-modal-backdrop" role="presentation">
      <section
        className="breakpoint-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="breakpoint-manager-title"
      >
        <header className="breakpoint-modal-header">
          <div>
            <span className="inspector-overline">RESPONSIVE LAYOUT</span>
            <h2 id="breakpoint-manager-title">Manage breakpoints</h2>
          </div>
          <button className="icon-button small-icon" aria-label="Close breakpoint manager" onClick={onClose}>
            <X size={15} />
          </button>
        </header>
        <div className="breakpoint-preset-actions">
          {BREAKPOINT_PRESETS.map((preset) => (
            <button
              key={preset.id}
              className="view-option"
              disabled={draft.some((item) => item.id === preset.id)}
              onClick={() => addPreset(preset.id)}
            >
              <Plus size={11} /> {preset.name}
            </button>
          ))}
          <button className="view-option" onClick={addCustom}>
            <Plus size={11} /> Custom
          </button>
        </div>
        <div className="breakpoint-list">
          {draft.map((breakpoint, index) => (
            <fieldset className="breakpoint-edit-row" key={breakpoint.id}>
              <legend>{breakpoint.name || `Breakpoint ${index + 1}`}</legend>
              <label>
                Name
                <input
                  aria-label={`${breakpoint.id} name`}
                  value={breakpoint.name}
                  onChange={(event) => setDraft((current) => current.map((item) =>
                    item.id === breakpoint.id ? { ...item, name: event.target.value } : item,
                  ))}
                />
              </label>
              <label>
                Min width
                <input
                  type="number"
                  min="0"
                  max="16384"
                  aria-label={`${breakpoint.id} minimum width`}
                  value={breakpoint.minWidth}
                  onChange={(event) => setDraft((current) => current.map((item) =>
                    item.id === breakpoint.id ? { ...item, minWidth: Number(event.target.value) } : item,
                  ))}
                />
              </label>
              <label>
                Max width
                <input
                  type="number"
                  min="1"
                  max="16384"
                  placeholder="No limit"
                  aria-label={`${breakpoint.id} maximum width`}
                  value={breakpoint.maxWidth ?? ""}
                  onChange={(event) => setDraft((current) => current.map((item) =>
                    item.id === breakpoint.id
                      ? { ...item, maxWidth: event.target.value === "" ? undefined : Number(event.target.value) }
                      : item,
                  ))}
                />
              </label>
              <label>
                Canvas width
                <input
                  type="number"
                  min="1"
                  max="16384"
                  aria-label={`${breakpoint.id} canvas width`}
                  value={breakpoint.width}
                  onChange={(event) => setDraft((current) => current.map((item) =>
                    item.id === breakpoint.id ? { ...item, width: Number(event.target.value) } : item,
                  ))}
                />
              </label>
              <label>
                Canvas height
                <input
                  type="number"
                  min="1"
                  max="16384"
                  aria-label={`${breakpoint.id} canvas height`}
                  value={breakpoint.height}
                  onChange={(event) => setDraft((current) => current.map((item) =>
                    item.id === breakpoint.id ? { ...item, height: Number(event.target.value) } : item,
                  ))}
                />
              </label>
              <button
                className="icon-button small-icon"
                aria-label={`Remove ${breakpoint.name} breakpoint`}
                disabled={draft.length <= 1}
                onClick={() => setDraft((current) => current.filter((item) => item.id !== breakpoint.id))}
              >
                <Trash2 size={13} />
              </button>
            </fieldset>
          ))}
        </div>
        {error && <p className="field-hint geometry-expression-error" role="alert">{error}</p>}
        <footer className="breakpoint-modal-footer">
          <button className="button button-quiet" onClick={onClose}>Cancel</button>
          <button className="button button-primary" onClick={save}>Save breakpoints</button>
        </footer>
      </section>
    </div>
  );
}

export function BreakpointToolbar({ screen }: { screen?: Screen } = {}) {
  const project = useStore((state) => state.project);
  const activeScreenId = useStore((state) => state.getActiveScreenId());
  const activeBreakpointId = useStore((state) => state.activeBreakpointId);
  const setActiveBreakpoint = useStore((state) => state.setActiveBreakpoint);
  const [managerOpen, setManagerOpen] = useState(false);
  const activeScreen =
    screen ?? project.screens.find((item) => item.id === activeScreenId);
  const breakpoints = useMemo(
    () => activeScreen ? getScreenBreakpoints(activeScreen) : [],
    [activeScreen],
  );
  const active = activeScreen
    ? resolveActiveBreakpoint(activeScreen, activeBreakpointId)
    : undefined;

  return (
    <>
      {activeScreen && active && (
        <div className="breakpoint-toolbar" role="group" aria-label="Responsive breakpoint">
          <span className="breakpoint-toolbar-label">Viewport</span>
          <select
            aria-label="Active breakpoint"
            value={active.id}
            onChange={(event) => setActiveBreakpoint(event.currentTarget.value)}
          >
            {breakpoints.map((breakpoint) => (
              <option key={breakpoint.id} value={breakpoint.id}>
                {breakpoint.name} · {breakpoint.width} × {breakpoint.height}
              </option>
            ))}
          </select>
          <button
            className="breakpoint-add-button"
            aria-label="Add breakpoint"
            title="Add or manage breakpoints"
            onClick={() => setManagerOpen(true)}
          >
            <Plus size={13} />
          </button>
        </div>
      )}
      {activeScreen && managerOpen && (
        <BreakpointManager screen={activeScreen} onClose={() => setManagerOpen(false)} />
      )}
    </>
  );
}

function updateSelectedWidget(
  screenId: string,
  widgetId: string,
  update: (widget: Widget) => Widget,
): void {
  saveScreenUpdate(screenId, (screen) => ({
    ...screen,
    breakpoints: screen.breakpoints ?? [...getScreenBreakpoints(screen)],
    widgets: screen.widgets.map((widget) =>
      widget.id === widgetId ? update(widget) : widget,
    ),
  }));
}

function setBreakpointOverrideField<K extends keyof WidgetOverride>(
  screen: Screen,
  widget: Widget,
  breakpointId: string,
  field: K,
  value: WidgetOverride[K],
): void {
  updateSelectedWidget(screen.id, widget.id, (current) =>
    updateWidgetOverride(current, breakpointId, { [field]: value }),
  );
}

function resetBreakpointOverrideField(
  screen: Screen,
  widget: Widget,
  breakpointId: string,
  field: keyof WidgetOverride,
): void {
  updateSelectedWidget(screen.id, widget.id, (current) => {
    const override = { ...current.overrides?.[breakpointId] };
    delete override[field];
    const overrides = { ...current.overrides };
    if (Object.keys(override).length) overrides[breakpointId] = override;
    else delete overrides[breakpointId];
    return {
      ...current,
      overrides: Object.keys(overrides).length ? overrides : undefined,
    };
  });
}

function resetNestedOverrideField(
  screen: Screen,
  widget: Widget,
  breakpointId: string,
  section: "style" | "props",
  field: string,
): void {
  updateSelectedWidget(screen.id, widget.id, (current) => {
    const override = { ...current.overrides?.[breakpointId] };
    if (section === "style") {
      const style = { ...override.style };
      if (field === "fill") delete style.fill;
      override.style = Object.keys(style).length ? style : undefined;
    } else {
      const props = { ...override.props };
      delete props[field];
      override.props = Object.keys(props).length ? props : undefined;
    }
    const overrides = { ...current.overrides };
    if (Object.keys(override).length) overrides[breakpointId] = override;
    else delete overrides[breakpointId];
    return {
      ...current,
      overrides: Object.keys(overrides).length ? overrides : undefined,
    };
  });
}

export function ResponsivePanel({
  screen,
  widget,
}: {
  screen: Screen;
  widget: Widget;
}) {
  const activeBreakpointId = useStore((state) => state.activeBreakpointId);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [fillError, setFillError] = useState("");
  const breakpoint = resolveActiveBreakpoint(screen, activeBreakpointId);
  const override = widget.overrides?.[breakpoint.id];
  const effectiveWidget = resolveWidgetsForBreakpoint(
    screen.widgets,
    breakpoint,
    screen.device?.width ?? 1440,
    screen.device?.height ?? 900,
    screen.compactLayout,
  ).find((item) => item.id === widget.id) ?? widget;
  const overflows = getWidgetsOutsideBreakpointViewport(
    [effectiveWidget],
    breakpoint,
  ).length > 0;
  const missingOwnOverride = getWidgetsMissingBreakpointOverrides(
    [widget],
    breakpoint.id,
  ).length > 0;
  useEffect(() => {
    setFieldErrors({});
    setFillError("");
  }, [breakpoint.id, widget.id]);
  const addOverride = () => {
    updateSelectedWidget(screen.id, widget.id, (item) =>
      updateWidgetOverride(item, breakpoint.id, {
        x: effectiveWidget.x,
        y: effectiveWidget.y,
        width: effectiveWidget.width,
        height: effectiveWidget.height,
        visible: effectiveWidget.visible,
        style: { ...effectiveWidget.style },
        props: { ...effectiveWidget.props },
      }),
    );
  };

  const setGeometry = (field: "x" | "y" | "width" | "height", raw: string) => {
    const value = Number(raw);
    if (
      raw.trim() === "" ||
      !Number.isFinite(value) ||
      ((field === "x" || field === "y") && Math.abs(value) > 100_000) ||
      ((field === "width" || field === "height") && value < 1)
    ) {
      setFieldErrors((current) => ({
        ...current,
        [field]: field === "width" || field === "height"
          ? "Enter a finite value of at least 1."
          : "Enter a finite coordinate within ±100,000.",
      }));
      return;
    }
    setFieldErrors((current) => {
      const next = { ...current };
      delete next[field];
      return next;
    });
    setBreakpointOverrideField(screen, widget, breakpoint.id, field, value);
  };

  const setStyleFill = (fill: string) => {
    if (fill && !/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(fill)) {
      setFillError("Enter a valid 3, 4, 6, or 8-digit hex color.");
      return;
    }
    setFillError("");
    updateSelectedWidget(screen.id, widget.id, (current) =>
      updateWidgetOverride(current, breakpoint.id, {
        style: { fill: fill || null },
      }),
    );
  };

  const setConstraint = (
    axis: keyof ResponsiveConstraints,
    value: string,
  ) => {
    if (axis === "horizontal") {
      if (!["left", "right", "center", "scale", "stretch"].includes(value)) return;
      const horizontal = value as ResponsiveConstraints["horizontal"];
      updateSelectedWidget(screen.id, widget.id, (current) => ({
        ...current,
        constraints: {
          horizontal,
          vertical: current.constraints?.vertical ?? "top",
        },
      }));
      return;
    }
    if (!["top", "bottom", "center", "scale", "stretch"].includes(value)) return;
    const vertical = value as ResponsiveConstraints["vertical"];
    updateSelectedWidget(screen.id, widget.id, (current) => ({
      ...current,
      constraints: {
        horizontal: current.constraints?.horizontal ?? "left",
        vertical,
      },
    }));
  };

  const textKey = typeof effectiveWidget.props.label === "string" ? "label" : "text";
  const textValue = effectiveWidget.props[textKey];

  return (
    <section className="responsive-panel" aria-label="Responsive widget rules">
      <div className="responsive-panel-heading">
        <div>
          <div className="section-label"><span>{breakpoint.name} override</span></div>
          <p>{breakpoint.width} × {breakpoint.height} viewport</p>
        </div>
        {overflows && <span className="responsive-overflow-warning" role="status">Overflows viewport</span>}
      </div>
      {missingOwnOverride && (
        <p className="field-hint responsive-missing-override" role="status">
          This important widget has no override at this breakpoint.
        </p>
      )}
      <label className="field-label" htmlFor="widget-cascade-mode">Cascade behavior</label>
      <select
        id="widget-cascade-mode"
        className="text-field"
        value={widget.cascadeMode ?? "absolute"}
        onChange={(event) => {
          const value = event.currentTarget.value;
          if (value !== "absolute" && value !== "stack" && value !== "fluid" && value !== "hide") return;
          updateSelectedWidget(screen.id, widget.id, (current) => ({
            ...current,
            cascadeMode: value,
          }));
        }}
      >
        <option value="absolute">Absolute</option>
        <option value="stack">Stack vertical</option>
        <option value="fluid">Fluid width</option>
        <option value="hide">Hide</option>
      </select>
      <p className="field-hint">
        {widget.cascadeMode === "stack"
          ? "At narrower widths, widgets stack vertically in layer order."
          : widget.cascadeMode === "fluid"
            ? "At narrower widths, this widget scales proportionally."
            : widget.cascadeMode === "hide"
              ? "This widget is hidden at every breakpoint."
              : "Base layout stays fixed unless this breakpoint has overrides."}
      </p>
      <label className="responsive-visible-field responsive-important-field">
        <input
          type="checkbox"
          checked={widget.important ?? false}
          onChange={(event) => updateSelectedWidget(screen.id, widget.id, (current) => ({
            ...current,
            important: event.target.checked,
          }))}
        />
        Important: require a breakpoint override
      </label>
      <div className="section-label responsive-constraints-label">
        <span>Position constraints</span>
      </div>
      <label className="field-label" htmlFor="responsive-horizontal-constraint">Horizontal</label>
      <select
        id="responsive-horizontal-constraint"
        className="text-field"
        value={widget.constraints?.horizontal ?? "left"}
        onChange={(event) => setConstraint("horizontal", event.currentTarget.value)}
      >
        <option value="left">Pin left</option>
        <option value="right">Pin right</option>
        <option value="center">Center</option>
        <option value="scale">Scale with width</option>
        <option value="stretch">Pin left and right</option>
      </select>
      <label className="field-label" htmlFor="responsive-vertical-constraint">Vertical</label>
      <select
        id="responsive-vertical-constraint"
        className="text-field"
        value={widget.constraints?.vertical ?? "top"}
        onChange={(event) => setConstraint("vertical", event.currentTarget.value)}
      >
        <option value="top">Pin top</option>
        <option value="bottom">Pin bottom</option>
        <option value="center">Center</option>
        <option value="scale">Scale with height</option>
        <option value="stretch">Pin top and bottom</option>
      </select>
      {!override ? (
        <button className="button button-secondary responsive-add-override" onClick={addOverride}>
          <Plus size={13} /> Add override for this breakpoint
        </button>
      ) : (
        <>
          {(["x", "y", "width", "height"] as const).map((field) => (
            <label className="field-label responsive-field" key={field}>
              <span>{field === "x" ? "X" : field === "y" ? "Y" : field === "width" ? "Width" : "Height"}</span>
              <input
                className="text-field"
                type="number"
                min={field === "width" || field === "height" ? 1 : undefined}
                aria-invalid={Boolean(fieldErrors[field])}
                key={`${widget.id}-${breakpoint.id}-${field}-${effectiveWidget[field]}`}
                defaultValue={effectiveWidget[field]}
                onBlur={(event) => setGeometry(field, event.currentTarget.value)}
              />
              {fieldErrors[field] && (
                <span className="field-hint geometry-expression-error" role="alert">
                  {fieldErrors[field]}
                </span>
              )}
              {override[field] !== undefined && (
                <button
                  className="responsive-reset-field"
                  aria-label={`Reset ${field} override`}
                  onClick={() => resetBreakpointOverrideField(screen, widget, breakpoint.id, field)}
                >
                  Reset
                </button>
              )}
            </label>
          ))}
          <label className="responsive-visible-field">
            <input
              type="checkbox"
              checked={effectiveWidget.visible}
              onChange={(event) =>
                setBreakpointOverrideField(screen, widget, breakpoint.id, "visible", event.target.checked)
              }
            />
            Visible at this breakpoint
            {override.visible !== undefined && (
              <button
                className="responsive-reset-field"
                aria-label="Reset visibility override"
                onClick={(event) => {
                  event.preventDefault();
                  resetBreakpointOverrideField(screen, widget, breakpoint.id, "visible");
                }}
              >
                Reset
              </button>
            )}
          </label>
          <label className="field-label responsive-field">
            Fill color
            <input
              className="text-field"
              aria-invalid={Boolean(fillError)}
              aria-describedby={fillError ? "responsive-fill-error" : undefined}
              defaultValue={typeof effectiveWidget.style.fill === "string" ? effectiveWidget.style.fill : ""}
              key={`${widget.id}-${breakpoint.id}-fill-${effectiveWidget.style.fill ?? ""}`}
              placeholder="Transparent or #hex"
              onBlur={(event) => setStyleFill(event.currentTarget.value.trim())}
            />
            {fillError && <span id="responsive-fill-error" className="field-hint geometry-expression-error" role="alert">{fillError}</span>}
            {override.style?.fill !== undefined && (
              <button
                className="responsive-reset-field"
                aria-label="Reset fill override"
                onClick={() => resetNestedOverrideField(screen, widget, breakpoint.id, "style", "fill")}
              >
                Reset style
              </button>
            )}
          </label>
          {typeof textValue === "string" && (
            <label className="field-label responsive-field">
              Text / label
              <input
                className="text-field"
                defaultValue={textValue}
                key={`${widget.id}-${breakpoint.id}-${textKey}-${textValue}`}
                onBlur={(event) =>
                  updateSelectedWidget(screen.id, widget.id, (current) =>
                    updateWidgetOverride(current, breakpoint.id, {
                      props: { [textKey]: event.currentTarget.value },
                    }),
                  )
                }
              />
              {override.props?.[textKey] !== undefined && (
                <button
                  className="responsive-reset-field"
                  aria-label={`Reset ${textKey} override`}
                  onClick={() => resetNestedOverrideField(screen, widget, breakpoint.id, "props", textKey)}
                >
                  Reset properties
                </button>
              )}
            </label>
          )}
          <button
            className="button button-quiet responsive-reset-all"
            onClick={() => updateSelectedWidget(screen.id, widget.id, (current) => {
              const overrides = { ...current.overrides };
              delete overrides[breakpoint.id];
              return { ...current, overrides: Object.keys(overrides).length ? overrides : undefined };
            })}
          >
            Reset override
          </button>
        </>
      )}
      <p className="responsive-persistence-note">
        Overrides are saved in the project and affect only this breakpoint.
      </p>
    </section>
  );
}
