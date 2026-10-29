# Axure-parity compatibility and verification

**Task:** PF-T513  
**Status:** Windows-focused verification in progress; the all-OS and real-Axure-user acceptance criteria are not complete.  
**Last evidence review:** 2026-10-29

This document reports what the repository tests and current host can establish. Unit tests, headless browser runs, native builds, physical desktop testing, and user-confirmed parity are different evidence types; a pass in one is not presented as a pass in the others.

## Compatibility matrix

| Feature | ProtoFlow implementation and automated evidence | Axure RP comparison |
|---|---|---|
| Dynamic panels | State editing, nested state data, transitions, preview runtime, HTML/React export; `src/project/dynamicPanels.test.ts`, `src/preview/runtime.test.ts`, `src/preview/publishBundle.test.ts`, `src/preview/codeExport.test.ts` | No side-by-side Axure RP session recorded; workflow parity is unconfirmed. |
| Repeaters | Dataset parsing/CSV, row templates and `{{item.field}}`, bounded set/add/remove/sort/filter actions, item interactions; `src/project/repeaters.test.ts`, `src/preview/runtime.test.ts`, export tests | No side-by-side Axure RP session recorded; workflow parity is unconfirmed. |
| Expressions | Safe parser, documented built-ins, interpolation, references, and invalid-input handling; `src/project/expressions.test.ts`, runtime and export tests | No side-by-side Axure RP session recorded; workflow parity is unconfirmed. |
| Local variables | Per-invocation values, local-over-screen-over-project precedence, repeater item context; `src/project/interactions.test.ts`, `src/preview/runtime.test.ts`, export tests | No side-by-side Axure RP session recorded; workflow parity is unconfirmed. |
| Flow diagrams | Navigation edges, auto-layout, persisted positions, SVG generation; `src/project/flow.test.ts`. Canvas gestures and PNG/SVG download require interactive verification. | No side-by-side Axure RP session recorded; workflow parity is unconfirmed. |
| Annotations | Note data, priority styling, search/filter, CSV/Markdown generation; `src/project/widgetNotes.test.ts`, `src/project/flow.test.ts`. Overlay and bulk-edit UI require interactive verification. | No side-by-side Axure RP session recorded; workflow parity is unconfirmed. |
| Rich text | Markdown subset, marks, sanitized links, semantic HTML and export behavior; `src/project/richText.test.ts`, preview/export tests. Floating-toolbar interaction needs browser/manual verification. | No side-by-side Axure RP session recorded; workflow parity is unconfirmed. |
| Version history | Manual/automatic checkpoints, local persistence, reconstruction, diff, restore model, autosave interval; `src/project/versionHistory.test.ts`. Native Tauri storage and full dialog flow need desktop verification. Cloud checkpoint sync is not implemented. | No side-by-side Axure RP session recorded; workflow parity is unconfirmed. |

“Automated evidence” above means the named repository tests exercise implementation behavior; it does not imply that every feature has been exercised through the editor UI on each OS.

## Operating-system and browser evidence

| Target | Browser/runtime evidence | Native desktop evidence | Status |
|---|---|---|---|
| Windows 10 Pro Education, build 26300 (current host) | **Passed 2026-10-29:** Chromium rendered all 21 device frames at emulated 100%, 125%, 150%, and 200% DPR; responsive and per-device exports passed in Chromium, Firefox, and WebKit. | **Passed 2026-10-29:** 22 Rust tests passed and the Tauri release executable built. The native app UI/workflows were not manually exercised. | Host available; not Windows 11. |
| Windows 11 | No Windows 11 host available in this task. | Not verified on Windows 11. | **Not verified.** |
| Ubuntu 24.04 | Existing GitHub Actions workflows run headless browser checks on Ubuntu. This is not a local Linux desktop session. | Native Ubuntu desktop/Tauri UI is not established by headless browser CI. | **CI/headless only; native desktop not verified.** |
| Kali Linux | No local distro/session was available. | Not verified. | **Deferred.** |
| Debian 12 | No local distro/session was available. | Not verified. | **Deferred.** |
| Fedora 40 | No local distro/session was available. | Not verified. | **Deferred.** |
| Arch Linux | No local distro/session was available. | Not verified. | **Deferred.** |

No WSL distribution suitable for this task was available; WSL reports only the Docker Desktop distribution. No Linux distro or additional toolchain was installed. Existing Ubuntu CI results are cited only as headless CI evidence, not as local WSL or native Linux verification.

## DPI, display server, and hardware notes

- The existing device verification report records browser device-scale-factor emulation at 100%, 125%, 150%, and 200% on the Windows 10 host. Emulation does not change Windows display scaling and is not a physical DPI certification; see [`reports/DEVICE-VERIFICATION.md`](reports/DEVICE-VERIFICATION.md).
- No physical Windows 11, X11, or Wayland desktop session was available. Wayland-specific transition/rendering behavior is unknown, not assumed equivalent.
- Playwright touch emulation is not a test on a physical touch screen. Hardware-specific gesture behavior remains unverified.
- Browser-engine results do not certify the corresponding operating-system desktop or native Tauri window.

## Workflow protocols and evidence records

The three step-by-step dashboard, onboarding, and settings workflows are in [`docs/axure-parity-workflows.md`](docs/axure-parity-workflows.md). At present, they are protocols—not recorded Axure-user sessions. Repository tests can verify model/runtime and export behavior; they cannot establish that an Axure RP user completed or approved a workflow.

No real-user testimonials or Axure-user confirmations are included because none were supplied for this task. Do not add names, quotes, or parity claims without the tester's explicit permission and confirmation. Use the record template in the workflow guide, and keep private contact details out of the repository.

## Comparison boundaries and differentiators

ProtoFlow includes a local HTML export, optional AI interaction generation, React/Tailwind export, annotations, and Linux packaging configuration. These are potential differentiators in the product; they are **not** a verified claim that ProtoFlow exceeds Axure RP in a like-for-like evaluation. Some cloud-backed actions are metered, while local HTML export is free. Version-history cloud sync is not implemented. Linux packaging configuration alone does not establish Linux compatibility.

A feature-by-feature competitive conclusion requires the same named task, comparable versions/configurations, and a recorded tester evaluation on both products. Until that is done, the comparison column above remains unconfirmed and no broad “matches/exceeds” claim should be published.

## Regression and release gates

- `npm run test:axure-parity` runs focused regression tests for all eight feature families and their preview/export paths.
- The PF-T513 Windows workflow runs the focused suite, TypeScript/Vite build, Playwright device/browser smoke checks, and Rust/Tauri checks on pull requests; the post-merge run expands browser verification where configured.
- The signed Windows release verification must pass parity tests and browser smoke checks before the release job can run.
- A failing automated check blocks its GitHub Actions job. Repository branch-protection settings are controlled by GitHub and must require the relevant check to make failed PR checks merge-blocking; no branch-protection configuration is claimed here.
- A regression found by a manual workflow should be filed as a parity-gap issue and kept open until the workflow is rerun successfully.

## Local validation run — 2026-10-29

- `npm run test:axure-parity -- --reporter=dot`: **14 test files, 88 tests passed**.
- `npm test -- --reporter=dot`: **62 test files, 401 tests passed**.
- `npm run build`: passed; Vite reported the existing large-chunk advisory for the bundled HEIC/application chunks.
- `$env:PF_DEVICE_FULL='1'; npm run verify:devices`: passed on this Windows 10 host. Chromium rendered all 21 device frames at the four emulated DPRs; responsive/per-device exports passed in Chromium, Firefox, and WebKit.
- The run refreshed `reports/device-verification/screenshots/multi-device-preview-100dpi.png`; CI uploads verification screenshots as run artifacts.
- `cargo test --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`: **22 Rust tests passed**.
- `npm run tauri -- build --target x86_64-pc-windows-msvc --no-bundle`: passed; produced `src-tauri/target/x86_64-pc-windows-msvc/release/proto-flow.exe`. No native desktop UI session has been manually exercised.
- Linux distribution tests and Windows 11 certification were not run; no WSL distro or Linux desktop environment was installed for this task.

## Acceptance status

| PF-T513 criterion | Current status |
|---|---|
| Feature regression coverage | Existing unit/runtime/export tests cover the eight feature groups; the new focused suite passed locally (14 files, 88 tests). UI coverage gaps remain identified above. |
| Windows 11 | Not verified; current host is Windows 10. |
| Ubuntu, Kali, Debian, Fedora, Arch native desktop | Not verified in this Windows-focused task; Linux desktop work is deferred. |
| Three workflows pass on all six OSes | Not established. The workflows are documented; all-OS interactive execution remains pending. |
| Axure-user confirmation/testimonials | Pending; no tester evidence provided. |
| `AXURE-PARITY.md` and compatibility notes | This document is the initial evidence-bounded report; update its statuses only after tests are actually run. |
| Main-merge regression checks / release blocking | Windows parity CI and signed-release verification gates are added on this branch; GitHub Actions has not run them yet. Branch protection must separately require PR checks. |

## Related documentation

- [Step-by-step workflow protocols](docs/axure-parity-workflows.md)
- [Phase 4 QA dashboard](reports/phase4-e2e-checklist.html)
- [Device/DPI verification report](reports/DEVICE-VERIFICATION.md)
- [Existing parity performance report](reports/PERF-AXURE-PARITY.md)
- [Beta program and tester-confirmation policy](docs/beta-program.md)
