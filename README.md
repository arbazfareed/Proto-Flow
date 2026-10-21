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

Phase 1 is complete: the desktop shell, local project schema, native file I/O, local autosave and crash recovery, keyboard shortcuts, command palette, and updater integration are implemented. Phase 2 tasks PF-T201 through PF-T213 are implemented: Konva navigation, configurable grid and snapping, primitive shapes and UI widgets, selection transforms, geometry/style/responsive inspectors, the screen/layer sidebar, the device preset library, editor-only device frame rendering, responsive breakpoints, canvas copy/paste/context actions, and reusable symbols.

### Phase 1 implementation reference

The Phase 2 canvas extends these foundations rather than introducing a parallel project model:

- `src/project/schema.ts` defines the versioned project, screen, widget, and symbol types and validates imported project data. Widgets persist geometry, rotation, opacity, visibility, locking, z-order, style, `props`, cascade behavior, and optional breakpoint overrides; projects persist reusable symbol definitions and screens persist optional breakpoint definitions.
- `src/store/documentSlice.ts` owns the active project, file path, dirty state, and document actions. `src/store/canvasSlice.ts` owns zoom, pan, grid and snap settings, and selected IDs. `src/store/historySlice.ts` owns bounded undo/redo snapshots. The slices are composed in `src/store/index.ts`.
- `src/canvas/CanvasStage.tsx` mounts the Konva stage in the center pane, tracks pane size with `ResizeObserver`, renders the configurable navigation grid and project widgets, and implements pointer-anchored zoom and Space/middle-button panning. Widget dragging and shape creation support grid snapping, Alt override, and sibling alignment guides. `src/project/widgetClipboard.ts` validates ProtoFlow widget clipboard JSON, generates fresh IDs, preserves parent links and responsive offsets, and provides selection z-order operations. `src/project/symbols.ts` creates normalized symbol masters, places instances, expands them on detach, preserves instance text overrides and nested group links, and swaps symbol references without changing transforms. The Symbols library in `src/layout/SymbolLibrary.tsx` supports placement, rename, master text/fill edits, instance detachment, and deleting a symbol while detaching its instances. Select layers and use the canvas or layer context menu's Create Symbol action (or `Ctrl/Cmd+Alt+K`); editing a master updates its instances, and instance transforms and text overrides are independently editable. `src/canvas/shapes.tsx` is the shape registry for primitives and mockup widgets. The canvas toolbar activates click-and-drag tools, grouped as Shapes and Widgets. Element-library icons can also be dragged directly onto the canvas to create a widget at the drop point; dropping inside a container nests it in the live layer hierarchy when its bounds fit. Clicking an icon still activates the existing click-and-drag drawing tool. `R`, `O`, `T`, `L`, `B`, `I`, `M`, and `C` create a rectangle, ellipse, text, line, button, input, image, or checkbox; `Shift+R` and `Shift+T` create radio and toggle widgets. Double-click text-bearing widgets to edit their label; double-click an image placeholder to choose one or more images, or use the Image URL action to import an HTTP(S) image. PNG, JPEG, WebP, AVIF, GIF, BMP, SVG, HEIC/HEIF and TIFF images are accepted; HEIC/HEIF and TIFF are normalized for canvas rendering, with normalized images limited to 50 megapixels. Individual source images are limited to 25 MB; desktop saves move images of 500 KB or more and images that exceed the cumulative 2 MiB inline budget to `assets/`. Saving a project to a different path copies linked assets so the new project remains self-contained. Browser imports remain inline instead of being blocked by the desktop asset budget. `Ctrl/Cmd+C` and `Ctrl/Cmd+X` copy/cut selected widgets, `Ctrl/Cmd+V` pastes with a 20px offset, and `Ctrl/Cmd+D` duplicates the selection with fresh IDs and a 20px offset. Copy writes ProtoFlow JSON to the system clipboard when allowed; paste prefers the internal clipboard and validates external widget JSON. `Delete` removes the selection and supports undo. Canvas right-click exposes clipboard, duplicate, grouping, lock, delete, and z-order actions. `Ctrl/Cmd+0` fits the active device frame; `Ctrl/Cmd+1` fits the selection. The stage's upper-right zoom control keeps the current percentage visible, overflowing workspace sidebars scroll independently, and the side panels collapse at narrower widths to preserve canvas space.
- `src/layout/ShellComponents.tsx` contains the surrounding shell. Extend the stage while preserving panel toggles, status bar, and selective Zustand subscriptions.
- `src/project/files.ts` and the Rust commands in `src-tauri/src/commands/file_io.rs` provide validated local project open/save. Keep rendered edits in the project model so the existing save and autosave flows continue to persist them.
- `src/commands/registry.tsx` is the extension point for new user commands; global shortcuts are handled in `src/commands/shortcuts.ts`.

Selection transforms, geometry/style/responsive inspector editing, the screen/layer tree, device presets, device frame rendering, and responsive breakpoint switching are implemented. The PF-T208 sidebar supports screen switching, rename, duplication, deletion, start-screen assignment and reordering; layer selection sync, visibility, lock, rename, duplicate, delete and z-order reordering; and widget grouping with collapse-state persistence. PF-T211 adds a versioned 21-preset catalog, per-screen viewport/DPR/safe-area metadata, search and category filters, recents, custom sizes, and proportional or absolute-position device changes. PF-T212 renders the device frame and status chrome outside the persisted project model, clips content to the viewport, visualizes safe areas, snaps to safe-area boundaries, warns on unsafe widgets, and supports orientation changes with optional widget rotation. PF-T213 adds editable desktop/tablet/mobile and custom breakpoints, per-widget geometry/visibility/style/property overrides, responsive canvas sizing, cascade modes, pin/center/scale constraints, and viewport or missing-important-override warnings; breakpoint selection remains transient while breakpoint definitions and overrides are persisted in `.pflow`.

The element library includes dedicated canvas visuals for avatars, icon buttons, badges, alerts, progress, ratings, data summaries, and modern app patterns such as notifications, metric/profile/pricing cards, empty states, code blocks, segmented controls, and step indicators. Canvas icons use a Lucide preset selector in the inspector and render as SVGs on the canvas; library thumbnails continue to use the shared widget icon registry. Click an element to activate its draw tool, then drag on the canvas; alternatively, drag the library item directly onto the canvas to place it at that point.

### Phase 3 — Cloud API gateway scaffold

`cloud/` contains the Cloudflare Workers/Hono API scaffold for PF-T301. It defines local Wrangler bindings for D1 (`DB`), KV (`CACHE`), and R2 (`ASSETS`), repeatable D1 migrations plus standalone `schema.sql`, origin allowlisting, consistent JSON errors, and HS256 Bearer JWT verification for wallet routes. Anonymous wallet provisioning, authenticated wallet reads, daily claims, optional email/Google account linking, PF-T404 AI interaction generation, PF-T405 cloud preview publishing, PF-T406 React/Tailwind code export, and Cloudflare Access-protected admin endpoints are implemented. Admin endpoints fail closed until Access settings are configured.

Use Node.js 20.19+ or 22.12+:

```sh
cd cloud
npm install
Copy-Item .dev.vars.example .dev.vars
# Replace JWT_SECRET in .dev.vars with a random secret of at least 32 characters.
npm run db:apply:local
npm test
npm run typecheck
npm run dev
```

Before production deployment, create the named D1 database, KV namespace, and R2 bucket, replace the placeholder binding IDs in `cloud/wrangler.toml`, authenticate Wrangler, and set the JWT secret with `npx wrangler secret put JWT_SECRET`. Apply migrations remotely before `npm run deploy`. Do not commit `.dev.vars` or production secrets. Configure `ALLOWED_ORIGINS` with the shipped Tauri origins and any web-app origin that should be permitted. Set `PREVIEW_PUBLIC_BASE_URL` to the HTTPS origin used for public `/p/{id}` preview links when that differs from the Worker request origin. Production deployment requires an authenticated Cloudflare account and account-specific resources.

### PF-T302 — Anonymous wallet

On startup, the desktop app reads a locally hashed device/install identity and calls `POST /auth/anonymous`. The Worker reuses an account found by either identifier or creates an account and a one-time 50-credit starter wallet and ledger grant. The signed 24-hour JWT is stored in the operating system credential store; the last balance is cached locally for display during up to 24 hours offline. Offline mode is display-only; cloud actions still require the server. The wallet button in the top bar opens the balance and usage dropdown. Wallet settings can reset the cloud identity, clearing local credentials and creating a new wallet when online; the prior server-side account remains.

For local development, start the Worker with `cd cloud; npm run dev`, then start the desktop app in another terminal with `npm run tauri dev`. Provide `cloud/.dev.vars` with a non-production `JWT_SECRET` of at least 32 characters. Production builds need `VITE_CLOUD_API_URL` configured to the deployed Worker URL. Technical details of data sent and stored are documented in [PRIVACY.md](./PRIVACY.md).

### PF-T303 — Client wallet and balance pill

The always-visible top-bar pill uses green for 20+ credits, yellow for 5–19, and red for fewer than 5. Its dropdown shows lifetime totals, the latest 20 ledger entries, sync/offline status, refresh, and a daily claim when available. Wallet snapshots (not JWTs) are cached in local storage; desktop JWTs stay in the operating system credential store, and browser-preview JWTs use session storage. The UI syncs on launch, when the app becomes visible, and every 60 seconds while active. Email and Google sign-in are optional and available from wallet settings; metered actions remain unavailable offline.

### PF-T305 — Daily refill and abuse limits

The Worker silently attempts an automatic refill after the initial wallet sync and on the first app launch. A successful claim grants 20 credits per fully elapsed 24-hour UTC period since the previous daily refill, capped at 60 catch-up credits and at a 100-credit wallet balance. A refill is not granted more frequently than once per rolling 24 hours. The wallet dropdown shows whether a refill is available, the next refill countdown, and the corresponding local time; manual claims use the same server-authoritative rules. Lifetime spending is unchanged by refills.

The Worker observes only Cloudflare's `CF-Connecting-IP` header and stores an HMAC hash rather than the raw address. Hashed IP activity and IP grant markers are pruned after 30 days. Once five distinct wallet accounts have attempted a claim from the same IP within 24 hours, further grants from that IP are limited to one per rolling 24 hours, including claims already made by those accounts in the current window. Local development requests without Cloudflare's IP header use per-account cooldowns only.

### PF-T308 — Rate limiting and abuse prevention

The Worker uses KV-backed approximate sliding-window counters: anonymous provisioning is limited to 10 requests/hour/device and 100/hour/IP; AI requests to 30/minute/device; publish/export requests to 10/minute/device; email-link sends to 3/hour/email; and metered-action IP traffic to 500/hour/IP. A global 1,000-request/hour/IP safeguard applies to all routes. Daily claims retain their database-enforced 24-hour cooldown and IP safeguards. Rate-limited responses return structured `429` errors, `Retry-After`, and `X-RateLimit-*` headers, which are exposed to configured browser origins. KV counters are best-effort under concurrent requests because KV is eventually consistent.

Cloud preview publishing and React/Tailwind code exports use a separate limit of 10 requests per device per hour.

The Worker stores HMAC-hashed IP signup activity for 30 days and flags an address after five wallet signups in 24 hours. Repeated identical AI prompts and accounts spending 100+ credits in an hour are flagged; repeated account flags escalate to read-only access for 24 hours. Abuse flags are persisted in D1 for the future PF-T310 admin dashboard. Configure Cloudflare Turnstile using the Worker secret `TURNSTILE_SECRET_KEY` and build-time client variable `VITE_TURNSTILE_SITE_KEY`; the client only loads the invisible challenge when the Worker requests it. Without those values, challenged requests fail with a clear configuration/review error rather than bypassing the challenge. An optional weekly aggregate email digest can be enabled with `ABUSE_DIGEST_EMAIL`, `RESEND_API_KEY`, and `AUTH_EMAIL_FROM`; the scheduled report includes counts and reasons, not IP or account identifiers.

Apply migration `0005_rate_limits_abuse_flags.sql` using `npm run db:apply:local` from `cloud/` for local testing or `npm run db:apply:remote` after configuring production resources.

### PF-T309 — Usage ledger, history, and data controls

The Worker exposes the authenticated wallet ledger at `GET /wallet/ledger` with cursor pagination (up to 50 entries) and reason filtering. The wallet menu's **View full history** dialog shows local timestamps and credit/debit colors, and exports the filtered history as CSV. Wallet settings can download the full account, wallet totals, and ledger as JSON, or request cloud-data deletion by typing `DELETE`. Deletion revokes the current session immediately, retains an inaccessible tombstone for 30 days, and the daily scheduled task then removes the account and its related wallet, ledger, authentication, and abuse rows. The weekly abuse digest remains weekly. Ledger metadata is restricted to non-PII usage counters; account-merge balance caps are recorded as `account_merge_cap` debits. Apply `0006_usage_ledger_data_controls.sql` before deploying this version.

### PF-T310 — Admin dashboard and operations

`cloud/admin/` is a separate React/Vite static dashboard for Cloudflare Pages. Configure the Pages project root as `cloud/admin`, build command `npm run build`, and output directory `dist`. Protect the Pages hostname with a Cloudflare Access self-hosted application and an exact-email Allow policy; also protect the Worker API hostname with Access. The Worker independently verifies `Cf-Access-Jwt-Assertion` using the Access JWKS issuer, app audience, and `ADMIN_ALLOWED_EMAILS`, and fails closed when those values are absent.

The dashboard provides account search/detail, ledger and flag review, bounded manual adjustments, temporary read-only flags, bulk unflag/daily refill reissue, 30-day usage/cost estimates, and an audit log. AI usage records token counts only; prompts, raw device identifiers, and IP addresses are not stored. AI credits are charged only after provider output passes rule and context-reference validation. Publish and code export are not implemented and do not charge credits. Hourly anomaly checks can send deduplicated alerts to a configured Resend email and/or HTTPS webhook. Configure Access, origins, alert destinations, and rough service rates in Worker environment variables; never commit their values. Apply `0007_admin_audit_usage.sql` before enabling the dashboard against D1. Setup details are in `cloud/admin/README.md`.

### PF-T306 — Device identity and offline resilience

The client caches only the wallet snapshot and last successful sync time in local storage; the JWT remains in the OS credential store on desktop and session storage in browser previews. The cached balance is display-only for 24 hours after sync, and cloud actions remain disabled offline. The app checks Worker `/health` immediately and every 30 seconds while reachable; failures back off to 30 seconds, 1 minute, 5 minutes, then 15 minutes. The status bar shows actual Worker reachability and a successful reconnect triggers wallet sync.

Wallet sync silently provisions a replacement JWT through idempotent `/auth/anonymous` when the current token is missing, invalid, or within one minute of expiry. The random install ID remains stable across operating-system fingerprint changes, allowing the Worker to find the existing account and update its hashed device fingerprint. Reset cloud identity explicitly creates a new install ID, clears the local cache and JWT, and provisions a new wallet once connected; the old server account is retained.

### PF-T307 — Optional email and Google sign-in

The wallet dropdown opens settings where users can request a one-time email link or start Google OAuth. Email tokens are single-use and expire after 15 minutes; email requests are limited to three per address per hour. Google uses OAuth authorization-code flow with PKCE. Both flows link the verified identity to the current wallet and merge an already-linked wallet into it, capping the resulting balance at 100 credits while retaining lifetime totals and ledger history. Signing out removes the linked email/Google identity but keeps the local wallet and balance. JWTs remain in the desktop OS credential store or browser session storage; linked email addresses are not written to local storage.

Configure the following before enabling production sign-in:

- Verify a sending domain with Resend, then configure `RESEND_API_KEY` and `AUTH_EMAIL_FROM`. The sender must be authorized by that Resend account.
- Create a Google OAuth web client. Configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI`; register the exact Worker callback URL (`https://<worker-host>/auth/google/callback`) as an authorized redirect URI in Google Cloud Console.
- Add the deployed web-app origin to Worker `ALLOWED_ORIGINS` if browser access is needed. The desktop callback scheme `protoflow://` is registered by the Tauri deep-link plugin; desktop OAuth opens in the system browser and returns to the app.
- Apply migration `0004_optional_account_sign_in.sql` in each D1 environment before deploying the new Worker.

For local development, put provider values in the ignored `cloud/.dev.vars` file. For production, use `npx wrangler secret put` for the Resend API key and Google client secret; configure non-secret sender/client/redirect values as Worker variables or secrets. Never place provider credentials in Vite environment variables, frontend code, or committed files. Live email and Google sign-in require provider credentials, verified sender configuration, and an authorized Google redirect URI. The app uses a hashed device fingerprint and random install ID for anonymous wallet identity; an email or Google identity is stored only after the user chooses to link an account.

### PF-T304 — Metered action confirmation

Use `useMeteredAction` from `src/wallet/meteredActions.tsx` for cloud actions. It checks the online wallet and balance, requires confirmation for paid actions unless the user has opted out for that action and account, and sends only the action type and JSON payload. The Worker owns the action cost map (1 credit for AI interaction generation, 2 for cloud preview publish, and 3 for React/Tailwind export); the client never sends a cost. Insufficient funds prompt the user to claim the daily refill. Rate-limit, network, invalid-request, and server-error responses have separate user-facing messages. Usage telemetry is an on-device aggregate, disabled until the user opts in.

### PF-T404 — AI interaction generator

Choose **Generate with AI** in the selected widget's Interactions tab, describe the behavior, and choose whether to include the current screen or only that widget as context. Prompt examples are available. The Worker rate-limits AI requests, strips HTML/script markup, rejects likely instruction overrides, and calls the currently supported Gemini 2.5 Flash model in JSON mode (the requested Gemini 1.5 Flash model is no longer listed in Google's current model catalog). It retries malformed output at most twice, validates the generated rule against the shared `InteractionRuleSchema` and supplied variables/screens/widgets, and then atomically records the one-credit ledger debit and provider token counts. Provider errors and invalid output do not deduct credits. The generated rule is highlighted, editable, and unsaved until the user explicitly saves interactions. Thumbs feedback is stored separately without charging credits.

For local tests, AI provider calls are mocked; no live Gemini request is made. To try real generation, configure your own key in ignored `cloud/.dev.vars`, apply migration `0008_ai_interaction_feedback.sql` with the other Worker migrations, and restart the Worker.

### PF-T405 — Cloud web preview publisher

Choose **Publish** in the top bar to generate a self-contained HTML preview and upload it to R2. Publishing costs 2 credits only after the bundle is stored and the wallet/ledger transaction succeeds. Bundles are limited to 10 MiB, expire after 30 days, and are served in a script-only sandbox with network, form, cookie, and storage access denied. The dialog shows the share link, QR code, expiry, view count, and recent previews; an owner can unpublish a preview without a refund. The Worker limits publishing to 10 requests per device per hour and removes expired R2 objects, KV mappings, and D1 metadata on its hourly scheduled cleanup. Apply migration `0009_cloud_previews.sql` before deploying this feature. Set `PREVIEW_PUBLIC_BASE_URL` when public preview URLs must use a separate HTTPS origin.

### PF-T406 — React/Tailwind code generator

Choose **Export code** in the top bar to download a generated Vite + React + TypeScript + Tailwind ZIP for all screens or the selected screen, with controls for interactions, variables, embedded assets, and Tailwind CSS 3 or 4. The Worker validates the `.pflow` schema, builds screen components, React Router routes, widget renderers, and variable/interaction hooks, and charges 3 credits only after archive generation succeeds. Export input is capped at 10 MiB and requests are limited to 10 per device per hour. The free **Export as JSX** option downloads a single TSX component without a package manifest. Extract ZIPs and run `npm install` followed by `npm run dev`.

### PF-T407 — Free local HTML bundle exporter

Choose **Export HTML** to create an offline ZIP entirely on the client, with no cloud request, rate limit, or credit cost. The archive contains `index.html`, `runtime.js`, `style.css`, and an `assets/` folder. Project image assets are packaged as local files, and supported interaction rules, variable interpolation, screen navigation, and runtime controls reuse the local preview renderer. In the desktop app, the native save dialog writes the archive; in a browser, it downloads the ZIP. Remote image URLs are rejected when embedding images so the bundle remains offline and private; disable image assets to omit them.

### PF-T218 — Layer tree behavior and implementation notes

The layer tree should make the canvas structure and stacking order understandable without rendering miniature shapes or images in each row. Each active screen is a root; its rows distinguish containers, direct screen children, and descendants. The hierarchy view is the default, while category, type, and z-order views remain available. Rows use the shared Lucide element icon mapping, short labels, expandable parent controls, child counts, and CSS-drawn tree branches. Indentation is 16px per level, capped at 80px, and branch lines close at the last visible descendant.

Parentage is live rather than a one-time creation property. The tree uses the active breakpoint's resolved widget geometry, matching the canvas. A valid explicit widget `groupId` relationship is honored when the child's bounds remain within its parent; otherwise, recognized containers (including Rectangle, Card, Modal, Frame, and Panel) may infer a parent from containment, choosing the innermost eligible container. An 8px edge tolerance accommodates small alignment/rounding differences (for example, a child whose edge extends a few pixels past its container). Canvas creation and geometry commits synchronize widget `groupId` values with this parent map; moving a child beyond that tolerance clears its widget-parent relationship, and items outside containers remain screen-level siblings. Semantic group IDs that do not identify widgets remain virtual groups. Selection highlighting follows the same parent map. New widgets may be nested by selection only when the single selected widget is a screen-level parent and the new bounds fit inside it; selecting an already nested child does not make subsequent widgets its descendants. New containers are not implicitly nested by selection.

Dragging an element-library item onto a widget nests the new element under that drop target when its bounds fit inside the target. This explicit drop behavior also supports shape widgets such as rectangles as parents; the resulting parent-child relationship is reflected recursively in the Layers panel.

Within each parent, hierarchy siblings are listed top-to-bottom by canvas `y`, then left-to-right by `x`; canvas stacking order (`zIndex`, then widget-array order) breaks ties at identical positions. A parent row stays above its descendants, even when a child is independently brought forward. Reordering, moving, or resizing widgets must update the layer tree as the project state changes.

The hierarchy is a view over widget data, not a separate persisted tree. Existing `groupId` values are preserved; inferred containment is derived from geometry. Core implementation is in `src/project/layers.ts`, `src/layout/layerTree.ts`, and `src/layout/ScreenLayerSidebar.tsx`; regression coverage for nesting, movement, ordering, and parent highlighting is in the corresponding `*.test.ts` files.

Layer rows flag visible widgets that extend beyond the active responsive viewport with a red accent, warning icon, and pixel-distance tooltip. Hovering an overflowing row uses a red canvas outline. The layer tree exposes treeitem levels, expansion, selection, child groups, and labeled visibility/lock controls to assistive technology. Dragging outside the tree shows a cancel hint and disables the drop effect; Escape cancels an active layer drag. The virtualized tree remains bounded when hundreds of layers are expanded.

The expected screen-root hierarchy is:

```text
Screen 1 (Root Container) [PARENT]
|-- Rectangle [PARENT]
|   `-- Text [CHILD]
|-- Rectangle [CHILD]
`-- Text [CHILD]
```

Layer rows use category-specific accent stripes; category headers retain their category tint. Container rows are bold and show a live direct-child badge (or a gray `empty` badge), while panels and repeaters report their state and row counts. The canvas view controls include Pan mode for repositioning the viewport and Fit screen for recentering the active screen. The Image URL import action is available in the Elements library.

Container expansion is stored per screen and project. Chevron clicks toggle one level, Alt-click expands or collapses the full subtree, and the context menu supports expanding all, collapsing all, or expanding through a selected depth; Left/Right arrow keys navigate and toggle tree rows. Hovering a layer outlines its canvas bounds with that layer's category accent, while canvas hover highlights and scrolls the matching layer row into view.

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
| PF-T210 | Project schema `1.1.0` persists UUID-backed symbol masters and symbol-instance references; schema `1.0.0` files migrate with an empty symbol library. Master edits propagate through references. Detach/delete expand instances into regular widgets with fresh IDs, and swap preserves the instance transform. |

Automated tests verify pure math, parser and schema behavior, image payload externalization, text limits, and selection bounds. Pointer-capture lifecycle and actual native file dialogs still require manual desktop interaction; they are not claimed as automated end-to-end coverage.

### `.pflow` project schema

Version `1.3.0` projects contain UUID-backed project, screen, widget, variable, interaction-rule, and symbol entities. Versions `1.0.0` through `1.2.0` migrate to the current format; prior variable defaults are retained as typed initial values, and legacy interaction rules default to matching all conditions. Variables have unique JavaScript-identifier names within project or screen scope, typed initial values, and screen references are checked against existing screens. Interaction rules can bind to a widget, select any/all condition matching, and include click, hover, change, load, and touch triggers. The inspector provides ordered rule conditions and actions, target and type validation, navigation-loop/self-visibility warnings, test feedback, and undoable saves. A project has at least one screen and a `startScreenId` that refers to one of them; every symbol instance must reference an existing symbol. Widget coordinates are bounded to ±100,000 units, dimensions must be at least one unit, and opacity must be between zero and one. Geometry, visibility, z-order, style, and freeform `props` are validated before a project is loaded or saved.

Use `createEmptyProject(name)` to create a starter project and `parseProject(raw)` to validate either a JSON string or an in-memory value. Invalid data throws `SchemaValidationError`, whose `issues` property contains the Zod issue list.

### PF-T401 — Variable management foundation

Use the Variables tab in the left sidebar to create, edit, rename, and delete project- or screen-scoped string, number, and boolean variables. Text editors support `{{variableName}}` completions; renaming a variable updates matching widget text and interaction references. The variable validation panel reports unknown references, unused variables, and interaction type mismatches. Variable definitions are persisted in `.pflow` files and participate in undo/redo. `VariableRuntimeStore` provides per-preview initial values, typed updates, reset, and text interpolation for the preview runtime.

### PF-T402 — Conditional logic and trigger builder

Select a widget and choose **Interactions** in the inspector to bind click, hover, change, load, tap, and touch-start/end triggers. Rules support ordered conditions with all/any matching and ordered navigate, show/hide, variable, panel-state, and repeater-data actions. The editor validates targets and variable types, warns about navigation loops and a trigger hiding itself, supports templates and rule testing against the variables' initial values, and saves changes as a single undoable project edit. Interactions persist in the `.pflow` schema; legacy rules without a widget binding remain readable and migrate with all-condition matching.

### PF-T403 — Local preview runtime

Choose **Preview** in the editor toolbar to open the current prototype in a separate Tauri window (or a browser popup during web development). The preview renders widgets as DOM elements, listens for project edits over Tauri events or a local `BroadcastChannel`, and preserves runtime values while a project hot-reloads. Its toolbar supports screen navigation/back, restart, desktop/tablet/mobile device sizes, device-frame toggling, and a live variable inspector. Triggered rules execute in order and support navigation, visibility, typed variable, panel-state, and repeater-data actions; runtime errors are logged and shown in the preview rather than terminating it.

Project files are opened and saved through Rust Tauri commands. Saves stage data in the destination directory, sync it to disk, then atomically replace the target; the frontend validates project data with the shared Zod schema before saving and after opening.

### State management

The Zustand store is composed from independent document, canvas, history, and UI slices in `src/store/`. Components subscribe to only the fields they use; the history keeps at most 50 snapshots and the store is exposed through Redux DevTools in development.

### Local autosave and recovery

Unsaved projects are snapshotted to browser local storage every 30 seconds. Clean projects and snapshots whose project data has not changed are skipped. On startup, a valid snapshot no older than seven days can be restored or discarded; previous recovery snapshots are migrated when possible. If browser storage refuses an autosave (for example, when quota is exhausted), the app shows an error asking the user to save to disk and check available storage.

### Desktop layout

The desktop layout is composed in `src/AppShell.tsx` from the top bar, screens/layers sidebar, canvas, inspector, and status bar. The canvas stage resizes with its pane; zoom, pan, grid, and selection are driven by the Zustand canvas slice.

### Command palette and shortcuts

Use `Ctrl/Cmd+K` to open the keyboard-navigable command palette. Type to filter actions, use the arrow keys and Enter to run one, click outside or press Escape to close. Focus is contained in the palette while it is open and returns to the previous control when closed. Core commands (new/open/save, undo/redo, grid/snap toggles, and update checks) are registered centrally in `src/commands/registry.tsx`; future features should contribute commands through this registry rather than modifying the palette UI.

Global shortcuts include `Ctrl/Cmd+S` to save, `Ctrl/Cmd+Z` to undo, `Ctrl/Cmd+Shift+Z` or `Ctrl/Cmd+Y` to redo, `Ctrl/Cmd+N` for a new project, `Ctrl/Cmd+O` to open, and `Ctrl/Cmd+'` to toggle the canvas grid. Canvas editing shortcuts include `Ctrl/Cmd+C` copy, `Ctrl/Cmd+X` cut, `Ctrl/Cmd+V` paste, `Ctrl/Cmd+D` duplicate, and `Delete`/`Backspace` to delete. Text-editing shortcuts are left to the focused input for undo/redo and grid toggling.

### Auto-updates and release signing

Installed production desktop builds check the configured Tauri updater endpoint on launch and when the user requests a check. A detected version is offered in a toast; installation downloads the signed update and relaunches the app. Development builds and browser previews never call the updater. Tauri verifies the update signature before installation.

The updater signing public key is configured in `src-tauri/tauri.conf.json`. Keep the matching private key out of the repository and store it as the GitHub Actions secret `TAURI_SIGNING_PRIVATE_KEY`; configure `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if the key is password-protected. CI builds updater artifacts with `bundle.createUpdaterArtifacts`, signs them using the private key, and publishes each platform's update archive and `.sig` file to the release CDN. Serve a platform manifest at `https://releases.protoflow.app/{{target}}/{{arch}}/{{current_version}}` with the new version, notes, publication date, and target archive URL and signature. The endpoint and CDN must be deployed before users can receive updates.
