# PF-T709 Axure-parity feature test results

This document records automated regression coverage and the limits of the environments actually exercised. Unit, component, browser, and desktop results are separate evidence; one does not certify another.

## Automated coverage

| Feature | Automated coverage | Remaining manual or platform checks |
|---|---|---|
| Dynamic panels | State flattening and nested-widget edits; `.pflow` round-trip; five-level nesting limit; state-target validation; runtime switching and all six transition values. | Editor state rename/duplicate/delete/reorder UI, warnings shown to users, and native OS behavior. |
| Repeaters | Dataset/CSV validation and import, `{{item.field}}` interpolation, all five data actions, row-specific interaction context, and virtualized 500-row rendering with a 200 ms server-render budget. | Native editor row CRUD and actual browser paint timing on every target OS. |
| Expressions | Operators and documented functions; variable, widget, and item references; malformed input and forbidden properties; finite-result checks; editor preview/autocomplete; generated-runtime parity and no `eval`. | Browser/WebView engine-specific behavior beyond the configured browser runs. |
| Local variables | Runtime precedence (interaction over screen over project), per-event and repeater-row isolation, shadowing validation, and expression references. | Recursion-triggered workflows are not supported as a separate runtime contract and are not claimed. |
| Flow diagrams | Navigation edge extraction/labels, layout and persisted positions, SVG generation, browser UI smoke for SVG/PNG downloads, and native UI smoke opening Flow. | Manual edge creation/deletion, two-way editor sync, and native desktop image downloads. |
| Annotations | Note fields, custom metadata, priority/status, search/filter, bulk edits, and CSV/Markdown export. | Native OS-specific visual review. |
| Rich text | Supported Markdown/marks, safe links, interpolation, semantic HTML, escaping, contrast, and editor toolbar component behavior. | Full-format toolbar interaction and visual rendering on each native OS. |
| Version history | Five-minute autosave, manual checkpoints, 50-entry pruning, restore/diff, undo messaging, project isolation, storage, and performance tests; browser/native UI smoke creates a local checkpoint. | Full import/export and restore/undo UX across every OS. Cloud history sync is not implemented and is not tested or claimed. |

Primary command:

```text
npm run test:axure-parity
npm run test:components
npm run test:e2e:browser
npm run build:e2e:desktop
npm run test:e2e:desktop
```

The GitHub Actions compatibility job runs the feature and component suites, browser/device verification, Rust/Tauri tests, and a Windows desktop build. Windows E2E runs browser and native desktop scenarios. Cross-browser export QA runs its Chromium smoke on pull requests and the full configured engine set on main pushes/manual runs.

## Operating-system evidence

| Target | Status for this test task | Evidence / limitation |
|---|---|---|
| Windows 11 | Tested locally only for commands explicitly reported in the task session; hosted CI uses Windows Server 2022, not Windows 11. | Browser engines and native WebView2 are not equivalent to testing every browser on Windows 11. |
| Ubuntu 24.04 | Not verified. | No Ubuntu desktop runner is configured for this task. |
| Kali | Not verified. | No Kali runner is configured. |
| Debian 12 | Not verified. | No Debian runner is configured. |
| Fedora 40 | Not verified. | No Fedora runner is configured. |
| Arch | Not verified. | No Arch runner is configured. |

Do not treat containers, browser emulation, or the Windows WebView2 run as native desktop certification for the Linux distributions. The six-OS acceptance criterion remains open until these targets have actual runners and recorded results.

## Run record

| Run | Commit | Host OS / browser or desktop | Command | Result |
|---|---|---|---|---|
| Local validation | PF-T709 working tree | Windows 11 Pro Education 10.0.26300; Playwright Chromium; WebView2 156.0.4314.58 | Feature, component, browser, native desktop, export, and device suites listed above | 105 feature, 33 component, 11 Chromium browser, and 3 native desktop tests passed; responsive/device verification and export QA exited successfully. |
| GitHub Actions | Pending | Windows Server 2022 | PF-T709 compatibility workflow | Pending |
