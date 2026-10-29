# Local Rust build-cache relocation

**Branch:** `feature/build-cache-outside-workspace`  
**Date:** 2026-10-29  
**Purpose:** Keep large generated Rust outputs out of the ProtoFlow source checkout without changing application code or deleting build artifacts.

## What changed

- Added `.cargo/config.toml` with `build.target-dir = "../ProtoFlow-build/target"`.
- GitHub Actions that use `rust-cache` or package Windows releases explicitly set `CARGO_TARGET_DIR` to the existing runner-local `src-tauri/target` path. This preserves current CI cache and bundle assumptions.
- Moved, without deleting, the existing ignored cache directories to sibling folders:
  - `src-tauri/target` → `../ProtoFlow-build/target`
  - `src-tauri/target-pf-t309` → `../ProtoFlow-build/legacy-target-pf-t309`

The move preserved the measured file counts: 40,941 files in the main Rust target and 7,552 files in the legacy target. Both destination directories exist. No tracked source files or app functionality were removed or modified for this optimization.

## Measured footprint

Before relocating the caches, the main target was about 40.57 GiB and the legacy target about 7.47 GiB. Together they accounted for about 48 GiB of generated data inside the checkout. After relocation, a recursive scan of the workspace was about 0.60 GiB (including dependencies and other ignored build output).

**Important:** both locations are on the same C: volume. Moving caches out of the checkout reduces the project folder's size but does not, by itself, reclaim C: drive capacity. No cache was deleted. To actually reclaim drive space, an operator would need to archive/move these preserved folders to a different volume and explicitly approve any later deletion; that was not done here.

## Verification

- `cargo metadata --manifest-path src-tauri/Cargo.toml --format-version 1 --no-deps` resolved the local target directory to the sibling `ProtoFlow-build/target`.
- `npm test -- --reporter=dot`: 401 tests passed across 62 files.
- `npm run build`: passed (Vite emitted its existing large-chunk advisory).
- `PF_DEVICE_FULL=1 npm run verify:devices`: passed with all 21 device frames at four emulated DPRs and responsive/per-device exports in Chromium, Firefox, and WebKit.
- `cargo test --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`: 22 Rust tests passed using the relocated target.
- `npm run tauri -- build --target x86_64-pc-windows-msvc --no-bundle`: passed; executable was produced under `../ProtoFlow-build/target/x86_64-pc-windows-msvc/release/`.
- The rebuilt native app launched; Windows reported its main window title as `ProtoFlow` and `Responding = True`.

## Reverting the path choice

To return future Cargo builds to the default location, remove the local `.cargo/config.toml` setting. The relocated cache folders are preserved as ordinary sibling directories; moving them back is a separate manual operation. CI continues to use its explicit runner-local target path and is not affected by local machine cache location.
