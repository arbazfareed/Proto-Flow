# ProtoFlow

ProtoFlow is a local-first desktop studio for designing, testing, and sharing interactive web and mobile prototypes. It brings a visual canvas, responsive device previews, reusable interface components, interaction logic, and code export into one workspace.

The application is built with React, TypeScript, Vite, Konva, and Tauri 2. Projects are stored locally as portable `.pflow` files; cloud features are optional and require a separately configured service.

## What you can do

### Design on a visual canvas

- Create multi-screen interfaces with text, shapes, controls, images, icons, layouts, and common application components.
- Import PNG, JPEG, GIF, BMP, AVIF, HEIC/HEIF, TIFF, ICO, SVG, and WebP images. Individual source files are limited to 25 MB and decoded images to 50 megapixels. HEIC/HEIF and TIFF are converted to PNG for canvas rendering; SVG imports reject scripts and external resources.
- Keep image-heavy desktop projects manageable: image payloads are measured by decoded bytes rather than base64 text length. On desktop, images of 500 KB or more, and images that would exceed the 2 MiB cumulative inline-image budget, are saved under the project's `assets/` directory and referenced from the `.pflow` file instead of embedding their base64 data. Smaller images remain embedded. Save As copies linked assets so the new project remains self-contained; browser projects keep images inline.
- Arrange and edit layers, group related widgets, reuse symbols, and use familiar selection, alignment, zoom, grid, and snapping tools.
- Organize screens with flow diagrams, and add notes, requirement IDs, priorities, and status to design elements.
- Work with rich text, dynamic panels, repeaters, variables, and safe expressions to build realistic prototypes.

### Build responsive, interactive prototypes

- Configure desktop, tablet, mobile, and custom breakpoints, device presets, safe areas, and per-breakpoint widget overrides.
- Connect screens and widgets with interactions for navigation, visibility, variables, panel states, and repeater data.
- Preview a prototype in a separate window, inspect it across one or multiple device sizes, and test mouse or touch behavior.
- Preserve project state through undo/redo, local autosave and recovery, and version history.

### Import, preview, and export

- Import HTML and CSS into an isolated, sandboxed preview, then translate supported content into editable canvas widgets.
- Export a standalone HTML bundle locally, including responsive or per-device variants.
- Generate React and Tailwind projects or a JSX component, with cloud-backed export options subject to service configuration and usage limits.
- Save and reopen portable `.pflow` project files; desktop builds also support native file dialogs and linked project assets.

Imported code conversion supports a useful subset of common HTML and CSS rather than a complete browser layout engine. Complex layouts, unsupported CSS, and JavaScript behavior may need manual adjustment after conversion. See [the code-import guide](./docs/code-import.md).

## Project phases at a glance

The phases below summarize how ProtoFlow has grown, from its local editing foundation to import and quality work. They are broad development stages, not promises that every platform, cloud integration, or acceptance check is complete. For verification details and known limitations, see the linked guides.

1. **Phase 1 — Desktop and project foundations:** Established the React/Tauri desktop shell, portable project model, native project open/save, local autosave and recovery, keyboard commands, and updater foundations.
2. **Phase 2 — Visual canvas and responsive screens:** Built the Konva editing surface, widget library, screen and layer management, selection and geometry tools, symbols, device presets, breakpoints, and responsive overrides.
3. **Phase 3 — Optional cloud services:** Added the Cloudflare Worker service layer for wallet and account flows, metered actions, AI-assisted interactions, published previews, and generated-code export. These cloud-backed features require separately configured infrastructure and credentials; the local editor and local HTML export do not.
4. **Phase 4 — Interactive prototyping:** Expanded prototypes with variables, conditional interactions, a local preview runtime, dynamic panels, repeaters, expressions, flow diagrams, annotations, rich text, version history, multi-device preview, touch input, and richer interface components. Axure-style workflow examples and evidence are documented in [AXURE-PARITY.md](./AXURE-PARITY.md); they distinguish automated checks from real-user comparison.
5. **Phase 5 — Performance and release foundations:** Added canvas performance work, benchmarks, platform build workflows, signing and updater safeguards, and Windows smoke verification. Build configuration is not the same as a completed release or verified native experience on every operating system.
6. **Phase 6 — Scope not recorded:** The available repository documentation and commit history do not identify a distinct Phase 6 feature scope. No features or completion claims are assigned to this phase here.
7. **Phase 7 — Quality and compatibility verification:** Added unit and backend coverage, performance and accessibility checks, security hardening, cross-browser export QA, responsive/device verification, onboarding and documentation tests, and Axure-style workflow regression coverage. See [the compatibility matrix](./docs/cross-browser-export-qa.md) and [the Axure parity evidence](./AXURE-PARITY.md) for what has and has not been verified.
8. **Phase 8 — HTML/CSS import:** Added a sandboxed code editor and preview, HTML/CSS parsing, semantic icon suggestions, and conversion of supported markup into editable canvas widgets. This is a bounded translation rather than a full browser rendering engine; JavaScript behavior stays in the isolated preview and does not become canvas interactions. See [the import guide](./docs/code-import.md).

## Privacy and cloud services

Core design, project files, local previews, and standalone HTML exports work on the user's device. Crash reporting and anonymous feature telemetry are separate, opt-in settings. The import preview runs in a sandbox and should still be treated as untrusted code.

Wallet, account linking, AI-assisted interactions, cloud previews, collaboration, and some generated-code workflows depend on a separately deployed Cloudflare Worker and configured provider credentials. Their presence in the application does not mean a production cloud service or third-party provider has been provisioned. See the `cloud/` directory and its setup instructions before enabling these features.

Plugins are an optional extension mechanism. The runtime is development-only and unsigned; production plugin installation and execution remain disabled until a signing trust store and revocation service are configured.

## Getting started

### Requirements

- Node.js 20.19+ or 22.12+
- Rust stable and the platform prerequisites listed in the [Tauri v2 setup guide](https://tauri.app/start/prerequisites/)
- Windows desktop development additionally requires the supported MSVC build tools and WebView2 runtime.

### Run the application

```sh
npm install
npm run tauri dev
```

The Vite development server uses port `1420`. To run the web version in a browser, use `npm run dev`.

## Validation

Run the checks relevant to your change:

```sh
npm run build
npm test
npm run test:components
npm run test:e2e:browser
npm run build:e2e:desktop
npm run test:e2e:desktop
npm run benchmark:performance
```

Browser end-to-end tests use Playwright. Desktop end-to-end tests use WebdriverIO with Tauri WebDriver and WebView2 on Windows. The component suite uses React Testing Library and jsdom; its coverage gate applies to the selected UI modules configured in `vite.components.config.ts`.

## Guides and references

- [Accessibility checklist and statement](./ACCESSIBILITY.md)
- [Cross-browser export QA and compatibility matrix](./docs/cross-browser-export-qa.md)
- [Responsive and per-device export guidance](./docs/choosing-responsive-vs-per-device-export.md)
- [HTML/CSS import behavior and limitations](./docs/code-import.md)
- [Rich expressions](./docs/rich-expressions.md) and [local variables](./docs/local-variables.md)
- [Widget notes](./docs/widget-notes.md)
- [Interactive tutorial](./docs/interactive-tutorial.md)
- [Performance benchmarks](./benchmarks/README.md)
- [Axure-style compatibility overview](./AXURE-PARITY.md) and [workflow examples](./docs/axure-parity-workflows.md)

Example projects are available in [`demos/`](./demos/), including the [Forma storefront](./demos/forma-storefront.pflow) and [Relay messaging suite](./demos/relay-messaging-suite.pflow).

## Desktop builds

Tauri packaging is configured for Windows MSI and Linux DEB/AppImage. Platform installers, updater artifacts, and signing require the corresponding build environment and release configuration.
