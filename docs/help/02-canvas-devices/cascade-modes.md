# Cascade modes: absolute, stack, fluid, and hide

Cascade modes control how a widget responds as a screen becomes narrower. **Absolute** preserves explicit positioning and size. **Stack** participates in a sequential layout with neighboring content. **Fluid** adapts dimensions to the available space. **Hide** suppresses the widget at the relevant compact size.

Choose the mode that matches the content's role, then inspect the screen at the target breakpoint. Absolute placement is useful for overlays and precise compositions; stack and fluid modes are useful for content that should reflow. Hide is appropriate only when the information is not needed in that layout.

Responsive results depend on the screen's viewport, breakpoint definitions, and widget constraints. Verify the actual canvas and Preview at representative widths instead of assuming one mode works for every screen.
