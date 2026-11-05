# Rust backend tests

Run the native backend checks from the repository root:

```powershell
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml --locked
```

The test suite uses a fresh `tempfile` directory per filesystem test. It exercises
project read/write helpers, atomic replacement and cleanup, large project files,
platform-specific path behavior, and device fingerprint properties.

The Tauri save/open commands call native file dialogs through `AppHandle`; those
dialogs are not opened in headless unit tests. The command paths use the tested
filesystem helpers after a path is selected. Deep-link dispatch is handled by the
frontend through the Tauri deep-link plugin; documentation-link parsing has its
own Vitest coverage in `src/help/docs.test.ts`.

GitHub Actions runs the Rust formatting check and tests on Windows and Ubuntu.
