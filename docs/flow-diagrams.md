# Screen flow diagrams

Flow mode visualizes project screens and screen-navigation actions without replacing the Design canvas or live Preview.

## Use the diagram

- Select **Flow** beside **Design** in the workspace toolbar.
- Select a node title or thumbnail to open that screen in Design.
- Drag the grip in a node header to move it. Screen positions are saved in the project as `screen.flowPosition`.
- Choose **Auto layout** to arrange screens with Dagre, ranking navigation targets from the start screen. Unreachable screens are placed after the reachable graph.
- Use the zoom controls or mouse wheel to zoom, and drag the empty canvas to pan.
- Click an edge to highlight it. **Edit interaction** selects its source widget in Design; **Delete link** removes only that navigate action.
- Export a diagram as SVG or PNG using the toolbar buttons.

## Create navigation

Select the widget that should initiate navigation in Design. In Flow mode, drag the arrow handle on its source screen onto a destination screen. ProtoFlow adds a `navigate` action to the widget's existing `onClick` rule, or creates a new click rule if necessary. A screen with multiple click rules uses the first matching widget click rule. Navigation conditions are shown as edge labels.

Navigation actions targeting screens removed from the project are not shown as graph edges. Existing navigation actions and conditions remain stored in the screen interaction rules and continue to drive Preview.

## Project compatibility

Schema version `1.7.0` adds optional per-screen `flowPosition` values. Projects through version `1.6.0` migrate automatically; projects without saved positions receive a deterministic initial layout when opened in Flow mode. Auto-layout, moving screens, and editing links update the project and are undoable through the regular history.
