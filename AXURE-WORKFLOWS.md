# PF-T716 Axure-workflow regression suite

These are automated regression journeys through ProtoFlow's current UI. Browser tests run on Windows and Linux in CI; the native desktop journey is Windows-only. Screenshots are attached to the Playwright report at the named workflow milestones. Each browser journey fails if its execution exceeds five minutes.

The suite uses the available starter projects and checks supported behavior without making paid cloud requests. It does not claim that every Axure RP capability is implemented or that a human Axure user has approved parity.

## W1 — Dashboard

- Start from the Dashboard starter project.
- Verify dashboard content in the editor and live preview.
- Switch preview to desktop/tablet/mobile and check all three frames render.
- Download and inspect the free responsive HTML archive and runtime.
- Evidence: editor, preview, and export screenshots.

## W2 — Mobile screens

- Start from the Mobile app starter project and add four iPhone 15 screens.
- Confirm five screens exist, the preview uses touch input mode, and screen selection works.
- Download and inspect a free responsive HTML export.
- Evidence: five-screen editor, preview, and export screenshots.

## W3 — Responsive marketing page

- Start from the Landing page starter project and switch Desktop, Tablet, and Mobile breakpoints.
- Verify the three-device preview, open Flow, and save a named local checkpoint.
- Download the per-device HTML archive and check its desktop, tablet, mobile, shared entry, and runtime files.
- Evidence: breakpoints, multi-device preview, and export screenshots.

## W4 — Admin data table

- Start from the Data table starter project and import a 50-row CSV into its repeater.
- Export the 50-row dataset as CSV and verify the preview reports 50 rows.
- Evidence: repeater data and preview screenshots.

## Known scope and limitations

- These UI journeys verify representative existing workflows, not the full original specification's four-screen flow graph, ten validated form fields, multi-state tab navigation, expression totals, annotation requirement IDs, or rich-text editing. Those workflows need additional product fixtures/interaction coverage before they can be claimed as end-to-end verified.
- React ZIP generation, cloud publishing, collaboration, and other billable cloud actions are not invoked; tests must not spend user credits.
- Frame-rate and 20% slowdown thresholds are not measured by this suite. The five-minute upper bound is enforced; no historical timing baseline is available for a 20% comparison.
- Human review by an Axure RP user is a beta process and is not inferred from automated test results.
- Linux runs browser journeys only. Native Linux desktop automation is not configured in this repository.

## Running locally

- Browser journeys: `npx playwright test e2e/browser/axure-workflows.spec.ts`
- Windows desktop dashboard journey: `npm run test:e2e:desktop -- --spec ./e2e/desktop/axure-workflows.spec.mjs`
