# Choosing between responsive and per-device export

ProtoFlow offers several local export formats. They do not use cloud services or wallet credits.

## Single responsive HTML

Choose this when one web page should adapt to its current viewport. The ZIP contains `index.html`, the shared preview runtime, responsive breakpoint styles, and local image assets. Configured mobile, tablet, and desktop breakpoints apply widget geometry, visibility, cascade modes, constraints, and overrides. Raster images include 1×/2×/3× `srcset` candidates when the browser can decode and resize them; SVG assets stay vector.

Use this format for a conventional website or prototype that should respond to a browser resize without switching between separate prototype files.

## Per-device HTML variants

Choose this when reviewers need a distinct starting screen for Desktop, Tablet, or Mobile. The ZIP contains `index-desktop.html`, `index-tablet.html`, and `index-mobile.html`, plus the shared runtime and assets. Each page starts on the closest matching device screen when one exists; the screen picker still allows navigation to other screens.

Use variants when the device-specific experience needs a separate review entry point or distribution file.

## Per-device screenshots

Choose this for static review artifacts. The local ZIP contains Desktop, Tablet, and Mobile PNGs rendered at 2× DPR. Screenshots capture the selected prototype's corresponding screen layout; they do not contain interactions.

## Responsive React/Tailwind ZIP

The React export dialog can include responsive breakpoint layouts. Its generated project listens for viewport changes and applies the project breakpoints and widget overrides. This ZIP uses the metered React/Tailwind export action and costs **3 credits**. The single-file fixed-layout JSX export remains free.

## Multi-device preview

Use the separate **Preview** window to exercise one shared runtime across a single device, three standard side-by-side devices, or a custom grid of up to eight devices. Widgets and breakpoints are resolved to each frame's viewport; interactions, navigation, and project variables are shared. Use the camera button for a 2× PNG snapshot of the visible preview layout.

For large custom grids, reduce zoom or select fewer devices to keep interaction latency low. A screen capture is a snapshot, not a portable interactive prototype.
