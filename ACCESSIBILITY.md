# Accessibility

ProtoFlow aims to conform to WCAG 2.1 AA. Accessibility checks are part of pull-request CI; they complement, but do not replace, manual testing with assistive technology.

## Automated coverage

- `npm run test:components` runs component behavior and `jest-axe` checks.
- `npm run test:e2e:browser` uses axe-core to check the workspace, device picker, notes manager, screen-flow view, command palette, help panel, and version history in Chromium.
- `npm run test:e2e:desktop` runs axe-core inside the Windows Tauri WebView and checks the privacy dialog, onboarding, workspace, and help panel.
- Automated scans use WCAG 2.1 A/AA rules and fail CI on critical or serious violations.
- Browser E2E also checks Escape-key dismissal, reduced-motion CSS, and reflow at a 320 CSS-pixel viewport. Desktop E2E checks visible keyboard focus.

To run the checks locally:

```powershell
npm run test:components
npm run test:e2e:browser
npm run build:e2e:desktop
npm run test:e2e:desktop
```

The desktop commands require Windows, Rust, MSVC build tools, WebView2, and the Tauri/WebDriver prerequisites described in [README.md](./README.md).

## Manual release checklist

Automated scans cannot establish full WCAG conformance. Before each major release, record the tester, app version, operating system, assistive-technology version, and outcome for each item:

- [ ] Complete primary journeys using only the keyboard; verify logical focus order, no keyboard traps, and Escape/Enter/arrow-key behavior where applicable.
- [ ] Verify screen-reader names, roles, values, heading structure, landmarks, status announcements, and modal focus management.
- [ ] Test with NVDA on Windows and VoiceOver on macOS; test Orca on Linux when Linux is in the release scope.
- [ ] Check text contrast at 4.5:1 and non-text controls/focus indicators at 3:1; do not convey meaning with color alone.
- [ ] Check 200% zoom and narrow reflow, including a 320 CSS-pixel viewport, without loss of content or function.
- [ ] Check touch targets meet 44 × 44 CSS pixels where touch input is supported.
- [ ] Verify `prefers-reduced-motion` for transitions, panel states, loading indicators, and other animation.
- [ ] Exercise advanced features by keyboard: panel states, repeater rows, expression entry, flow diagram, notes, rich text, version history, device picker, and breakpoint controls.

Document any remaining issues and their severity in the release record. Do not describe the product as fully conformant until the manual checks have been completed.

## Reporting an accessibility issue

Use the [GitHub issue tracker](https://github.com/arbazfareed/Proto-Flow/issues) and include the app version, operating system, assistive technology (if applicable), steps to reproduce, and the expected and actual result. Do not include private project files or personal data.

See the [accessibility statement](./public/accessibility.html).
