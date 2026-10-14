# ProtoFlow

ProtoFlow is a local-first desktop prototyping tool built with React, TypeScript, Vite, and Tauri 2.

## Requirements

- Node.js 20.19+ or 22.12+
- Rust stable with the platform prerequisites listed in the [Tauri v2 setup guide](https://tauri.app/start/prerequisites/)

## Development

```sh
npm install
npm run tauri dev
```

The Vite dev server listens on port `1420`. Frontend hot reload is enabled while Tauri ignores `src-tauri/`.

## Checks

```sh
npm run build
npm test
```

## Desktop bundles

`src-tauri/tauri.conf.json` targets Windows MSI and Linux DEB/AppImage packages. The `.pflow` file association is declared as `application/x-protoflow+json`.

## Phase 1 status

Phase 1 is complete: the desktop shell, local project schema, native file I/O, local autosave and crash recovery, keyboard shortcuts, command palette, and updater integration are implemented. Phase 2 tasks PF-T201 through PF-T208 and PF-T211–PF-T213 are implemented: Konva navigation, configurable grid and snapping, primitive shapes and UI widgets, selection transforms, geometry/style/responsive inspectors, the screen/layer sidebar, the device preset library, editor-only device frame rendering, and responsive breakpoints.

### Phase 1 implementation reference

The Phase 2 canvas extends these foundations rather than introducing a parallel project model:

- `src/project/schema.ts` defines the versioned project, screen, and widget types and validates imported project data. Widgets persist geometry, rotation, opacity, visibility, locking, z-order, style, `props`, cascade behavior, and optional breakpoint overrides; screens persist optional breakpoint definitions for compatibility with older files.
- `src/store/documentSlice.ts` owns the active project, file path, dirty state, and document actions. `src/store/canvasSlice.ts` owns zoom, pan, grid and snap settings, and selected IDs. `src/store/historySlice.ts` owns bounded undo/redo snapshots. The slices are composed in `src/store/index.ts`.
- `src/canvas/CanvasStage.tsx` mounts the Konva stage in the center pane, tracks pane size with `ResizeObserver`, renders the configurable navigation grid and project widgets, and implements pointer-anchored zoom and Space/middle-button panning. Widget dragging and shape creation support grid snapping, Alt override, and sibling alignment guides. `src/canvas/shapes.tsx` is the shape registry for primitives and mockup widgets. The canvas toolbar activates click-and-drag tools, grouped as Shapes and Widgets. Element-library icons can also be dragged directly onto the canvas to create a widget at the drop point; dropping inside a container nests it in the live layer hierarchy when its bounds fit. Clicking an icon still activates the existing click-and-drag drawing tool. `R`, `O`, `T`, `L`, `B`, `I`, `M`, and `C` create a rectangle, ellipse, text, line, button, input, image, or checkbox; `Shift+R` and `Shift+T` create radio and toggle widgets. Double-click text-bearing widgets to edit their label; double-click an image placeholder to choose one or more images, or use the Image URL action to import an HTTP(S) image. PNG, JPEG, WebP, AVIF, GIF, BMP, SVG, HEIC/HEIF and TIFF images are accepted; HEIC/HEIF and TIFF are normalized for canvas rendering, with normalized images limited to 50 megapixels. Individual source images are limited to 25 MB; desktop saves move images of 500 KB or more and images that exceed the cumulative 2 MiB inline budget to `assets/`. Saving a project to a different path copies linked assets so the new project remains self-contained. Browser imports remain inline instead of being blocked by the desktop asset budget. `Delete` removes the selection and supports undo. `Ctrl/Cmd+0` fits the active device frame; `Ctrl/Cmd+1` fits the selection. The stage's upper-right zoom control keeps the current percentage visible, overflowing workspace sidebars scroll independently, and the side panels collapse at narrower widths to preserve canvas space.
- `src/layout/ShellComponents.tsx` contains the surrounding shell. Extend the stage while preserving panel toggles, status bar, and selective Zustand subscriptions.
- `src/project/files.ts` and the Rust commands in `src-tauri/src/commands/file_io.rs` provide validated local project open/save. Keep rendered edits in the project model so the existing save and autosave flows continue to persist them.
- `src/commands/registry.tsx` is the extension point for new user commands; global shortcuts are handled in `src/commands/shortcuts.ts`.

Selection transforms, geometry/style/responsive inspector editing, the screen/layer tree, device presets, device frame rendering, and responsive breakpoint switching are implemented. The PF-T208 sidebar supports screen switching, rename, duplication, deletion, start-screen assignment and reordering; layer selection sync, visibility, lock, rename, duplicate, delete and z-order reordering; and widget grouping with collapse-state persistence. PF-T211 adds a versioned 21-preset catalog, per-screen viewport/DPR/safe-area metadata, search and category filters, recents, custom sizes, and proportional or absolute-position device changes. PF-T212 renders the device frame and status chrome outside the persisted project model, clips content to the viewport, visualizes safe areas, snaps to safe-area boundaries, warns on unsafe widgets, and supports orientation changes with optional widget rotation. PF-T213 adds editable desktop/tablet/mobile and custom breakpoints, per-widget geometry/visibility/style/property overrides, responsive canvas sizing, cascade modes, pin/center/scale constraints, and viewport or missing-important-override warnings; breakpoint selection remains transient while breakpoint definitions and overrides are persisted in `.pflow`.

### PF-T218 — Layer tree behavior and implementation notes

The layer tree should make the canvas structure and stacking order understandable without rendering miniature shapes or images in each row. Each active screen is a root; its rows distinguish containers, direct screen children, and descendants. The hierarchy view is the default, while category, type, and z-order views remain available. Rows use the shared Lucide element icon mapping, short labels, expandable parent controls, child counts, and CSS-drawn tree branches. Indentation is 16px per level, capped at 80px, and branch lines close at the last visible descendant.

Parentage is live rather than a one-time creation property. The tree uses the active breakpoint's resolved widget geometry, matching the canvas. A valid explicit widget `groupId` relationship is honored when the child's bounds remain within its parent; otherwise, recognized containers (including Rectangle, Card, Modal, Frame, and Panel) may infer a parent from containment, choosing the innermost eligible container. An 8px edge tolerance accommodates small alignment/rounding differences (for example, a child whose edge extends a few pixels past its container). Canvas creation and geometry commits synchronize widget `groupId` values with this parent map; moving a child beyond that tolerance clears its widget-parent relationship, and items outside containers remain screen-level siblings. Semantic group IDs that do not identify widgets remain virtual groups. Selection highlighting follows the same parent map. New widgets may be nested by selection only when the single selected widget is a screen-level parent and the new bounds fit inside it; selecting an already nested child does not make subsequent widgets its descendants. New containers are not implicitly nested by selection.

Dragging an element-library item onto a widget nests the new element under that drop target when its bounds fit inside the target. This explicit drop behavior also supports shape widgets such as rectangles as parents; the resulting parent-child relationship is reflected recursively in the Layers panel.

Within each parent, hierarchy siblings are listed top-to-bottom by canvas `y`, then left-to-right by `x`; canvas stacking order (`zIndex`, then widget-array order) breaks ties at identical positions. A parent row stays above its descendants, even when a child is independently brought forward. Reordering, moving, or resizing widgets must update the layer tree as the project state changes.

The hierarchy is a view over widget data, not a separate persisted tree. Existing `groupId` values are preserved; inferred containment is derived from geometry. Core implementation is in `src/project/layers.ts`, `src/layout/layerTree.ts`, and `src/layout/ScreenLayerSidebar.tsx`; regression coverage for nesting, movement, ordering, and parent highlighting is in the corresponding `*.test.ts` files.

The expected screen-root hierarchy is:

```text
Screen 1 (Root Container) [PARENT]
|-- Rectangle [PARENT]
|   `-- Text [CHILD]
|-- Rectangle [CHILD]
`-- Text [CHILD]
```

Layer rows use category-specific accent stripes; category headers retain their category tint. Container rows are bold and show a live direct-child badge (or a gray `empty` badge), while panels and repeaters report their state and row counts. The canvas view controls include Pan mode for repositioning the viewport and Fit screen for recentering the active screen. The Image URL import action is available in the Elements library.

### Phase 2 failure-matrix verification

The failure-focused checks for PF-T201–PF-T207 are tracked alongside their implementation tests. Run the targeted regression groups with:

```sh
npm run test -- -t "geometry-math|expression-eval|snap-engine"
npm run test -- -t "transformer-inversion|multi-drag-offsets"
npm run test -- -t "image-payload-budget|svg-sanitization"
cd src-tauri && cargo test accepts_standard_svg_namespaces_and_rejects_active_or_remote_content
```

| Task | Decision and safeguards |
|---|---|
| PF-T201 | Pointer-anchored zoom uses bounded zoom and 1e-4 pan precision; zero-sized resize observations are clamped to a 1px stage. Space-pan is reset on blur, pointer cancel, and lost pointer capture. Unit coverage includes repeated fractional zoom at both zoom limits. |
| PF-T202 | Smart sibling guides take priority independently on each axis; grid rendering uses visible stage bounds and increases spacing at low zoom to bound draw work. Tests cover sibling priority and low-zoom spacing. |
| PF-T203 | Measured and displayed widget text is capped at 10,000 characters. Icon rendering only accepts predefined Lucide path data by icon name, so imported props cannot inject arbitrary path strings. |
| PF-T204 | Image budgets use decoded bytes, not base64 string length. Images accept common device formats, with HEIC/HEIF and TIFF normalized for rendering; individual source files are limited to 25 MB and normalized images to 50 megapixels. Desktop saves externalize images of 500 KB or more and images that exceed the cumulative 2 MiB inline budget, omitting base64 from `.pflow`; Save As copies existing linked assets. Browser imports remain inline instead of being blocked by the desktop asset budget. SVG sanitization rejects script and external references. Inline text editors use world-to-screen transforms and scale font size with zoom. |
| PF-T205 | Transformer bounds reject negative, non-finite, and sub-4px boxes. Multi-drag applies the primary node's position delta to each selected node; delete clears transformer references before unmounting. |
| PF-T206 | Geometry input uses a restricted arithmetic parser, rejects division by zero and invalid expressions without changing stored geometry, and marks invalid drafts. Focused fields render from their local draft until commit or blur. |
| PF-T207 | Blend-mode selection exposes only the supported safe subset; older persisted modes render as `source-over`. Color parsing rejects non-finite alpha. Color-picker changes are grouped into one history snapshot per pointer gesture, with the idle debounce as a keyboard/native-picker fallback. |
| PF-T208 | Active-screen switching is independent from the configured start screen. Layer ordering updates z-index, group/name metadata is optional for schema compatibility, and the collapse tree state is stored per project/screen. |
| PF-T211 | The bundled `devices/catalog.json` is versioned and validated at build/runtime startup. Screen device metadata is optional for old projects; custom dimensions are bounded to 16,384 CSS pixels and safe-area insets must fit within the viewport. Device changes confirm layout shifts and can proportionally scale widgets or preserve absolute geometry. |
| PF-T212 | Device chrome and safe-area overlays are editor-only and never added to `.pflow` widget data. Widget coordinates remain viewport-relative; the viewport clips rendering, safe-area edges participate in smart snapping, and orientation changes warn before overflow with options to preserve or rotate widget geometry. |
| PF-T213 | Breakpoint IDs and ranges are validated for uniqueness, bounds, and overlap. Breakpoint-specific edits are stored as widget overrides without mutating base geometry; removing a breakpoint also removes its orphaned overrides. Absolute, vertical stack, fluid-width, and hide cascade modes resolve on the canvas; horizontal/vertical pin, center, stretch, and scale constraints apply to absolute layouts. Viewport overflow and missing overrides for widgets marked important are surfaced in the editor. |

Automated tests verify pure math, parser and schema behavior, image payload externalization, text limits, and selection bounds. Pointer-capture lifecycle and actual native file dialogs still require manual desktop interaction; they are not claimed as automated end-to-end coverage.

### `.pflow` project schema

Version `1.0.0` projects contain UUID-backed project, screen, widget, variable, and interaction-rule entities. A project has at least one screen and a `startScreenId` that refers to one of them. Widget coordinates are bounded to ±100,000 units, dimensions must be at least one unit, and opacity must be between zero and one. Geometry, visibility, z-order, style, and freeform `props` are validated before a project is loaded or saved.

Use `createEmptyProject(name)` to create a starter project and `parseProject(raw)` to validate either a JSON string or an in-memory value. Invalid data throws `SchemaValidationError`, whose `issues` property contains the Zod issue list.

Project files are opened and saved through Rust Tauri commands. Saves stage data in the destination directory, sync it to disk, then atomically replace the target; the frontend validates project data with the shared Zod schema before saving and after opening.

### State management

The Zustand store is composed from independent document, canvas, history, and UI slices in `src/store/`. Components subscribe to only the fields they use; the history keeps at most 50 snapshots and the store is exposed through Redux DevTools in development.

### Local autosave and recovery

Unsaved projects are snapshotted to browser local storage every 30 seconds. Clean projects and snapshots whose project data has not changed are skipped. On startup, a valid snapshot no older than seven days can be restored or discarded; previous recovery snapshots are migrated when possible. If browser storage refuses an autosave (for example, when quota is exhausted), the app shows an error asking the user to save to disk and check available storage.

### Desktop layout

The desktop layout is composed in `src/AppShell.tsx` from the top bar, screens/layers sidebar, canvas, inspector, and status bar. The canvas stage resizes with its pane; zoom, pan, grid, and selection are driven by the Zustand canvas slice.

### Command palette and shortcuts

Use `Ctrl/Cmd+K` to open the keyboard-navigable command palette. Type to filter actions, use the arrow keys and Enter to run one, click outside or press Escape to close. Focus is contained in the palette while it is open and returns to the previous control when closed. Core commands (new/open/save, undo/redo, grid/snap toggles, and update checks) are registered centrally in `src/commands/registry.tsx`; future features should contribute commands through this registry rather than modifying the palette UI.

Global shortcuts include `Ctrl/Cmd+S` to save, `Ctrl/Cmd+Z` to undo, `Ctrl/Cmd+Shift+Z` or `Ctrl/Cmd+Y` to redo, `Ctrl/Cmd+N` for a new project, `Ctrl/Cmd+O` to open, and `Ctrl/Cmd+'` to toggle the canvas grid. Text-editing shortcuts are left to the focused input for undo/redo and grid toggling.

### Auto-updates and release signing

Installed production desktop builds check the configured Tauri updater endpoint on launch and when the user requests a check. A detected version is offered in a toast; installation downloads the signed update and relaunches the app. Development builds and browser previews never call the updater. Tauri verifies the update signature before installation.

The updater signing public key is configured in `src-tauri/tauri.conf.json`. Keep the matching private key out of the repository and store it as the GitHub Actions secret `TAURI_SIGNING_PRIVATE_KEY`; configure `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if the key is password-protected. CI builds updater artifacts with `bundle.createUpdaterArtifacts`, signs them using the private key, and publishes each platform's update archive and `.sig` file to the release CDN. Serve a platform manifest at `https://releases.protoflow.app/{{target}}/{{arch}}/{{current_version}}` with the new version, notes, publication date, and target archive URL and signature. The endpoint and CDN must be deployed before users can receive updates.
