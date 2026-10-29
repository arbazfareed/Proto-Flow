# Phase 5.1 — Windows interactive verification

**Scope:** real editor UI smoke in a Chromium browser and a Windows desktop launch check. Linux distribution testing remains deferred to a separate Phase 5.2 task. This report does not certify Windows 11; the local host is Windows 10 Pro Education, build 26300.

## Automated editor browser smoke

Run `npm run verify:phase5` on Windows. The default opens a visible Chromium window and drives the actual Vite-hosted ProtoFlow editor. Set `PF_E2E_HEADLESS=1` for the GitHub Actions runner.

The smoke executes these user-facing paths:

1. Resolve the first-launch privacy dialog with both optional settings off.
2. Create a new project.
3. Draw a Button on the Konva editor canvas and verify its layer-tree row.
4. Open the secondary Preview window and verify rendered preview widgets.
5. Switch to Flow and verify the screen node appears.
6. Edit widget notes, requirement ID, and priority in the inspector.
7. Add a second screen, switch to Flow, verify both screen nodes, and export SVG.
8. Create two named Version History checkpoints around a project rename and verify both entries appear.
9. Capture an editor screenshot at `reports/phase5.1/screenshots/editor-flow-smoke.png`.

**Local result (2026-10-29):** visible Chromium run passed; headless Chromium run passed. Screenshot saved at the path above. The app logged connection-refused cloud-wallet requests because no local cloud Worker was started, plus one 404 resource request; these did not produce uncaught page errors or block the tested editor workflow. The new GitHub workflow is configured but has not yet run for this branch.

This is a focused happy-path UI smoke, not a complete execution of the three PF-T513 workflows, a Windows 11 certification, or an Axure-user parity evaluation. It does not exercise every inspector/editor control or the native Tauri window. The CI job runs headless; local runs are visible by default.

## Native Windows desktop status

The T513 task built `src-tauri/target/x86_64-pc-windows-msvc/release/proto-flow.exe` and passed 22 Rust tests. **Local launch smoke (2026-10-29):** started that executable; Windows reported main window title `ProtoFlow` and `Responding = True`. The native app window was left open for inspection. Only startup/window responsiveness was verified in Tauri; notes, screen creation, drawing, Preview, Flow/SVG, and checkpoint interactions were exercised in the browser app, not repeated in the native window. Do not mark native desktop workflows complete based on the browser run.

## Deferred / still unverified

- Windows 11 host; current Windows 10 is not a substitute.
- Linux X11/Wayland and Kali/Debian/Fedora/Arch desktop/package validation; no Linux distro or extra toolchain is installed for this task.
- Three full dashboard/onboarding/settings workflows through the editor UI on each OS.
- Real Axure RP user confirmation/testimonials.
- Production release, provider, beta, and launch operations described in `AXURE-PARITY.md` and the Phase 5 checklist.

## Branch plan

- This branch: `feature/phase5.1-windows-interactive-e2e`.
- Later Linux task: `feature/phase5.2-linux-validation`, when the required Linux hosts/environments are available.
