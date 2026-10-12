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

The desktop shell, local project schema, native file I/O, local autosave and crash recovery, keyboard shortcuts, command palette, and signed updater integration are being built in this phase. The canvas renderer is intentionally reserved for Phase 2.

### `.pflow` project schema

Version `1.0.0` projects contain UUID-backed project, screen, widget, variable, and interaction-rule entities. A project has at least one screen and a `startScreenId` that refers to one of them. Widget geometry, visibility, z-order, style, and freeform `props` are validated before a project is loaded or saved.

Use `createEmptyProject(name)` to create a starter project and `parseProject(raw)` to validate either a JSON string or an in-memory value. Invalid data throws `SchemaValidationError`, whose `issues` property contains the Zod issue list.

Project files are opened and saved through Rust Tauri commands. Saves stage data in the destination directory, sync it to disk, then atomically replace the target; the frontend validates project data with the shared Zod schema before saving and after opening.

### State management

The Zustand store is composed from independent document, canvas, history, and UI slices in `src/store/`. Components subscribe to only the fields they use; the history keeps at most 50 snapshots and the store is exposed through Redux DevTools in development.

### Local autosave and recovery

Unsaved projects are snapshotted to browser local storage every 30 seconds. Clean projects and snapshots whose project data has not changed are skipped. On startup, a valid snapshot no older than seven days can be restored or discarded; previous recovery snapshots are migrated when possible.

### Desktop layout

The desktop layout is composed in `src/AppShell.tsx` from the top bar, screens/layers sidebar, canvas placeholder, inspector, and status bar. Sidebar visibility, canvas zoom, grid, and selection are driven by the Zustand UI and canvas slices.

### Command palette and shortcuts

Use `Ctrl/Cmd+K` to open the keyboard-navigable command palette. Type to filter actions, use the arrow keys and Enter to run one, click outside or press Escape to close. Core commands (new/open/save, undo/redo, grid/snap toggles, and update checks) are registered centrally in `src/commands/registry.tsx`; future features should contribute commands through this registry rather than modifying the palette UI.

Global shortcuts include `Ctrl/Cmd+S` to save, `Ctrl/Cmd+Z` to undo, `Ctrl/Cmd+Shift+Z` or `Ctrl/Cmd+Y` to redo, `Ctrl/Cmd+N` for a new project, `Ctrl/Cmd+O` to open, and `Ctrl/Cmd+'` to toggle the canvas grid. Text-editing shortcuts are left to the focused input for undo/redo and grid toggling.

### Auto-updates and release signing

Installed production desktop builds check the configured Tauri updater endpoint on launch and when the user requests a check. A detected version is offered in a toast; installation downloads the signed update and relaunches the app. Development builds and browser previews never call the updater. Tauri verifies the update signature before installation.

The updater signing public key is configured in `src-tauri/tauri.conf.json`. Keep the matching private key out of the repository and store it as the GitHub Actions secret `TAURI_SIGNING_PRIVATE_KEY`; configure `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if the key is password-protected. CI builds updater artifacts with `bundle.createUpdaterArtifacts`, signs them using the private key, and publishes each platform's update archive and `.sig` file to the release CDN. Serve a platform manifest at `https://releases.protoflow.app/{{target}}/{{arch}}/{{current_version}}` with the new version, notes, publication date, and target archive URL and signature. The endpoint and CDN must be deployed before users can receive updates.
