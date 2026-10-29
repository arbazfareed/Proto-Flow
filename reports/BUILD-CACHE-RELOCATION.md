# Local Rust build-cache relocation

**Branch:** `feature/build-cache-outside-workspace`  
**Date:** 2026-10-29  
**Purpose:** Keep large generated Rust outputs out of the ProtoFlow source checkout without changing application code or deleting source/project files.

## What changed

- Added `.cargo/config.toml` with `build.target-dir = "../ProtoFlow-build/target"`.
- GitHub Actions that use `rust-cache` or package Windows releases explicitly set `CARGO_TARGET_DIR` to the existing runner-local `src-tauri/target` path. This preserves current CI cache and bundle assumptions.
- Moved the active ignored cache intact: `src-tauri/target` → `../ProtoFlow-build/target`.
- After confirming `target-pf-t309` had no source/build references (only its `.gitignore` entry and this report) and no Rust build process was active, removed that obsolete generated cache. It contained 7,552 files and was about 7.47 GiB; its contents are reproducible build artifacts, not source or user projects.

The move preserved all 40,941 files in the active Rust target. No tracked source files, saved prototypes, or app functionality were removed or modified for this optimization.

## Measured footprint

Before relocation/cleanup, the main target was about 40.57 GiB and the obsolete legacy target about 7.47 GiB. Together they accounted for about 48 GiB of generated data in the checkout. After moving the active cache and removing the obsolete cache, the checkout was about 0.60 GiB (including dependencies and other ignored build output); the active cache remains at about 40.57 GiB beside it.

**Important:** moving the active cache to a sibling folder on C: reduces the checkout size but does not free drive space. The obsolete cache contained 7.47 GiB of logical file data and was deleted; the exact free-space delta can differ due to filesystem allocation and other disk activity. A post-cleanup snapshot showed 28.81 GiB free on C: (the earlier snapshot before cleanup showed 24.76 GiB). The active cache still occupies about 40.57 GiB on C: and is intentionally kept so rebuilds remain fast. It can be regenerated if later removed after closing ProtoFlow.

## Verification

- `cargo metadata --manifest-path src-tauri/Cargo.toml --format-version 1 --no-deps` resolved the local target directory to the sibling `ProtoFlow-build/target`.
- After legacy cleanup, `npm test -- --reporter=dot`: 401 tests passed across 62 files.
- After legacy cleanup, `npm run build`: passed (Vite emitted its existing large-chunk advisory).
- After legacy cleanup, `PF_DEVICE_FULL=1 npm run verify:devices`: passed with all 21 device frames at four emulated DPRs and responsive/per-device exports in Chromium, Firefox, and WebKit.
- After legacy cleanup, `cargo test --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`: 22 Rust tests passed using the relocated target.
- After cleanup, `../ProtoFlow-build/legacy-target-pf-t309` is absent and `../ProtoFlow-build/target` remains the active Cargo target.
- The Tauri release executable rebuild after legacy cleanup is still running; native launch verification will be recorded after it finishes.

## Reverting the path choice

To return future Cargo builds to the default location, remove the local `.cargo/config.toml` setting. The active cache remains in the sibling `ProtoFlow-build/target` folder; moving it back is a separate manual operation. CI continues to use its explicit runner-local target path and is not affected by local machine cache location.
