# Linux, Wayland, and device-frame troubleshooting

On Linux, rendering and window behavior can vary between Wayland compositors, X11 sessions, graphics drivers, and WebView versions. If a problem occurs, update the system WebView and graphics drivers, then retry in a fresh app launch. When practical, compare with an X11 session to identify whether the issue is compositor-specific.

If a device frame looks clipped or misaligned, confirm the screen's device dimensions and orientation, then toggle the frame and safe-area guides to isolate the issue. Zoom and fit the canvas before changing widget geometry. Check the active breakpoint and viewport size.

If the problem persists, record the OS, desktop environment, display scale, device preset, and a minimal reproduction. Include sanitized logs only; do not attach private project content to a public report.
