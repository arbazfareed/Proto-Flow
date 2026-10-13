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

Phase 1 is complete: the desktop shell, local project schema, native file I/O, local autosave and crash recovery, keyboard shortcuts, command palette, and updater integration are implemented. Phase 2 canvas work is underway: the Konva stage and navigation controls, configurable dot/line grid, grid snapping, sibling smart guides, primitive shapes, and mockup UI widgets are implemented. Selection transforms, inspector editing, and the rest of the canvas workflow remain future work.

### Phase 1 implementation reference

The Phase 2 canvas extends these foundations rather than introducing a parallel project model:

- `src/project/schema.ts` defines the versioned project, screen, and widget types and validates imported project data. Widgets already persist geometry, rotation, opacity, visibility, locking, z-order, style, and `props`.
- `src/store/documentSlice.ts` owns the active project, file path, dirty state, and document actions. `src/store/canvasSlice.ts` owns zoom, pan, grid and snap settings, and selected IDs. `src/store/historySlice.ts` owns bounded undo/redo snapshots. The slices are composed in `src/store/index.ts`.
- `src/canvas/CanvasStage.tsx` mounts the Konva stage in the center pane, tracks pane size with `ResizeObserver`, renders the configurable navigation grid and project widgets, and implements pointer-anchored zoom and Space/middle-button panning. Widget dragging and shape creation support grid snapping, Alt override, and sibling alignment guides. `src/canvas/shapes.tsx` is the shape registry for primitives and mockup widgets. The canvas toolbar activates click-and-drag tools, grouped as Shapes and Widgets. `R`, `O`, `T`, `L`, `B`, `I`, `M`, and `C` create a rectangle, ellipse, text, line, button, input, image, or checkbox; `Shift+R` and `Shift+T` create radio and toggle widgets. Double-click text-bearing widgets to edit their label; double-click an image placeholder to choose an image, or drop one onto the canvas. Images under 500 KB are embedded; larger desktop project images are saved beside the `.pflow` file in `assets/`. `Delete` removes the selection and supports undo. `Ctrl/Cmd+0` resets zoom and centers content; `Ctrl/Cmd+1` fits the selection. The stage's upper-right zoom control keeps the current percentage visible, overflowing workspace sidebars scroll independently, and the side panels collapse at narrower widths to preserve canvas space.
- `src/layout/ShellComponents.tsx` contains the surrounding shell. Extend the stage while preserving panel toggles, status bar, and selective Zustand subscriptions.
- `src/project/files.ts` and the Rust commands in `src-tauri/src/commands/file_io.rs` provide validated local project open/save. Keep rendered edits in the project model so the existing save and autosave flows continue to persist them.
- `src/commands/registry.tsx` is the extension point for new user commands; global shortcuts are handled in `src/commands/shortcuts.ts`.

Selection transforms, widget inspector editing, and screen/layer editing are still to be implemented.

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
