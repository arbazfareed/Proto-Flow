# Cross-browser export QA

Run the Chromium pull-request smoke check with:

```sh
npm run qa:exports
```

Run the full browser matrix on Windows with Chrome, Edge, Firefox, WebKit, and the Chromium/WebKit mobile emulations installed:

```sh
npm run qa:exports:full
```

The full run exercises responsive HTML, desktop/tablet/mobile HTML variants, the self-contained published-preview bundle used by cloud publishing, and generated React. It verifies 320px–3840px responsive breakpoints, interactions, panel-state transitions, repeater data, expression evaluation, rich text, Inter font loading, reduced-motion behavior, dark color-scheme rendering, axe-core WCAG 2.1 AA, and a 2-second local navigation-load budget.

Playwright tests the Chromium, Firefox, and WebKit engines. The full Windows matrix additionally launches branded Chrome and Edge channels. Mobile Safari is WebKit mobile emulation and Chrome Android is Chromium mobile emulation; these are not physical-device certifications. The load-time budget measures the local exported page and does not include network or cloud-host latency.

Visual baselines are checked into [`reports/cross-browser-qa/baselines/`](../reports/cross-browser-qa/baselines/). Screenshots capture a fixed browser viewport (rather than the variable full-page document height) so platform-specific scrollbar and content-height differences do not create false failures. Each run compares screenshots against the per-browser baseline, writes the current screenshots and compatibility matrix under `reports/cross-browser-qa/`, and CI uploads that directory as an artifact. To intentionally refresh baselines, review the screenshot changes and run:

```sh
npm run qa:exports:full -- --update-baselines
```

The generated [compatibility matrix](../reports/cross-browser-qa/compatibility-matrix.md) records browser, surface, performance, and visual-check results. CI runs Chromium smoke on pull requests and the full matrix on pushes to `main` and this QA branch. Windows desktop smoke runs on pushes to this QA branch and remains covered by the [Windows E2E workflow](../.github/workflows/windows-e2e.yml).

Inter is embedded as a variable WOFF2 font in HTML, published-preview, and React exports. The export bundle includes the font's SIL Open Font License; non-Latin glyphs fall back to the platform system font stack.
