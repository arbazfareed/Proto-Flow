import type {
  Breakpoint,
  ResponsiveConstraints,
  Screen,
  Widget,
  WidgetOverride,
} from "./schema";

export const BREAKPOINT_PRESETS = [
  { id: "mobile", name: "Mobile", minWidth: 0, maxWidth: 767, width: 390, height: 844 },
  { id: "tablet", name: "Tablet", minWidth: 768, maxWidth: 1023, width: 768, height: 1024 },
  { id: "desktop", name: "Desktop", minWidth: 1024, width: 1440, height: 900 },
] as const satisfies readonly Breakpoint[];

export function createDefaultBreakpoints(
  baseWidth = 1440,
  baseHeight = 900,
): Breakpoint[] {
  return BREAKPOINT_PRESETS.map((breakpoint) =>
    breakpoint.id === "desktop"
      ? { ...breakpoint, width: Math.max(1024, baseWidth), height: baseHeight }
      : { ...breakpoint },
  );
}

export function getScreenBreakpoints(screen: Screen): readonly Breakpoint[] {
  return screen.breakpoints?.length
    ? screen.breakpoints
    : createDefaultBreakpoints(
        screen.device?.width ?? 1440,
        screen.device?.height ?? 900,
      );
}

export function resolveActiveBreakpoint(
  screen: Screen,
  breakpointId: string | null,
): Breakpoint {
  const breakpoints = getScreenBreakpoints(screen);
  return (
    breakpoints.find((breakpoint) => breakpoint.id === breakpointId) ??
    breakpoints.find((breakpoint) => breakpoint.id === "desktop") ??
    breakpoints[breakpoints.length - 1]
  );
}

function applyOverride(widget: Widget, override: WidgetOverride | undefined): Widget {
  if (!override) return widget;
  return {
    ...widget,
    ...override,
    style: override.style ? { ...widget.style, ...override.style } : widget.style,
    props: override.props ? { ...widget.props, ...override.props } : widget.props,
  };
}

function applyConstraints(
  widget: Widget,
  constraints: ResponsiveConstraints,
  breakpoint: Breakpoint,
  baseWidth: number,
  baseHeight: number,
): Widget {
  const next = { ...widget };
  const horizontalScale = breakpoint.width / baseWidth;
  const verticalScale = breakpoint.height / baseHeight;

  switch (constraints.horizontal) {
    case "right":
      next.x = breakpoint.width - (baseWidth - widget.x - widget.width);
      break;
    case "center":
      next.x =
        (breakpoint.width - widget.width) / 2 +
        widget.x -
        (baseWidth - widget.width) / 2;
      break;
    case "scale":
      next.x *= horizontalScale;
      next.width *= horizontalScale;
      break;
    case "stretch":
      next.width = Math.max(
        1,
        breakpoint.width - (baseWidth - widget.x - widget.width) - widget.x,
      );
      break;
  }

  switch (constraints.vertical) {
    case "bottom":
      next.y = breakpoint.height - (baseHeight - widget.y - widget.height);
      break;
    case "center":
      next.y =
        (breakpoint.height - widget.height) / 2 +
        widget.y -
        (baseHeight - widget.height) / 2;
      break;
    case "scale":
      next.y *= verticalScale;
      next.height *= verticalScale;
      break;
    case "stretch":
      next.height = Math.max(
        1,
        breakpoint.height - (baseHeight - widget.y - widget.height) - widget.y,
      );
      break;
  }
  return next;
}

export function resolveWidgetsForBreakpoint(
  widgets: readonly Widget[],
  breakpoint: Breakpoint,
  baseWidth: number,
  baseHeight = 900,
  compactLayout = false,
): Widget[] {
  const ordered = [...widgets].sort((first, second) => first.zIndex - second.zIndex);
  let nextStackY = 24;
  return ordered.map((widget) => {
    let responsiveWidget = widget;
    const cascadeMode = widget.cascadeMode ?? (
      compactLayout && breakpoint.width < baseWidth ? "hide" : undefined
    );
    if (cascadeMode === "hide") {
      responsiveWidget = { ...responsiveWidget, visible: false };
    } else if (breakpoint.width < baseWidth && cascadeMode === "fluid") {
      responsiveWidget = {
        ...responsiveWidget,
        width: Math.max(1, Math.min(
          breakpoint.width,
          widget.width * breakpoint.width / baseWidth,
        )),
      };
    } else if (breakpoint.width < baseWidth && cascadeMode === "stack") {
      responsiveWidget = {
        ...responsiveWidget,
        x: 0,
        y: nextStackY,
        width: Math.min(widget.width, breakpoint.width),
      };
      nextStackY += responsiveWidget.height + 16;
    }
    if (
      widget.constraints &&
      (cascadeMode === undefined || cascadeMode === "absolute")
    ) {
      responsiveWidget = applyConstraints(
        responsiveWidget,
        widget.constraints,
        breakpoint,
        baseWidth,
        baseHeight,
      );
    }
    const resolved = applyOverride(
      responsiveWidget,
      widget.overrides?.[breakpoint.id],
    );
    if (compactLayout && breakpoint.width < 768) {
      const horizontalScale = breakpoint.width / 390;
      const verticalScale = breakpoint.height < 844 ? breakpoint.height / 844 : 1;
      const compactProps = typeof resolved.props.fontSize === "number"
        ? { ...resolved.props, fontSize: Math.max(10, resolved.props.fontSize * verticalScale) }
        : resolved.props;
      return {
        ...resolved,
        x: resolved.x * horizontalScale,
        width: Math.max(1, resolved.width * horizontalScale),
        y: resolved.y * verticalScale,
        height: Math.max(1, resolved.height * verticalScale),
        props: compactProps,
      };
    }
    return resolved;
  });
}

export function getWidgetsMissingBreakpointOverrides(
  widgets: readonly Widget[],
  breakpointId: string,
): Widget[] {
  return widgets.filter(
    (widget) =>
      widget.important &&
      widget.visible &&
      widget.cascadeMode !== "hide" &&
      !widget.overrides?.[breakpointId],
  );
}

export function getWidgetsOutsideBreakpointViewport(
  widgets: readonly Widget[],
  breakpoint: Breakpoint,
): Widget[] {
  return widgets.filter(
    (widget) =>
      widget.visible &&
      (widget.x < 0 ||
        widget.y < 0 ||
        widget.x + widget.width > breakpoint.width ||
        widget.y + widget.height > breakpoint.height),
  );
}

export function getWidgetOverride(
  widget: Widget,
  breakpointId: string,
): WidgetOverride | undefined {
  return widget.overrides?.[breakpointId];
}

export function updateWidgetOverride(
  widget: Widget,
  breakpointId: string,
  update: Partial<WidgetOverride>,
): Widget {
  const existing = widget.overrides?.[breakpointId] ?? {};
  return {
    ...widget,
    overrides: {
      ...widget.overrides,
      [breakpointId]: {
        ...existing,
        ...update,
        ...(update.style
          ? { style: { ...existing.style, ...update.style } }
          : {}),
        ...(update.props
          ? { props: { ...existing.props, ...update.props } }
          : {}),
      },
    },
  };
}
