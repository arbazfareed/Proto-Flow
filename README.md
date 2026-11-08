# ProtoFlow

ProtoFlow is a local-first desktop studio for designing, testing, and sharing interactive web and mobile prototypes. It brings a visual canvas, responsive device previews, reusable interface components, interaction logic, and code export into one workspace.

The application is built with React, TypeScript, Vite, Konva, and Tauri 2. Projects are stored locally as portable `.pflow` files; cloud features are optional and require a separately configured service.

## What you can do

### Design on a visual canvas

- Create multi-screen interfaces with text, shapes, controls, images, icons, layouts, and common application components.
- Import common raster and vector image formats, including HEIC/HEIF and TIFF; larger desktop project images can be stored as linked assets.
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
