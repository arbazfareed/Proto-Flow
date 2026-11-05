# Breakpoints and responsive overrides

Breakpoints define viewport-width ranges and design sizes for a screen. Open **Breakpoints** in the screen toolbar to choose an active breakpoint or manage the screen's breakpoint list. Presets can be added alongside custom width ranges.

Select a widget while a breakpoint is active, then edit its responsive properties in the inspector. Those values become overrides for that breakpoint; the base geometry remains the default at other widths. The canvas resolves the active breakpoint to show the corresponding layout.

Use the missing-override and out-of-viewport indicators to find widgets that may need attention. Keep at least one breakpoint on a screen. If a breakpoint is removed, overrides tied only to that breakpoint are removed as well.
