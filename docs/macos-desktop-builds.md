# macOS desktop builds

ProtoFlow's macOS desktop bundles are built with Tauri 2.

## Local build

On macOS, install the prerequisites from the [Tauri v2 macOS setup guide](https://v2.tauri.app/start/prerequisites/), then run:

```sh
npm ci
npx tauri build --bundles app,dmg --config '{"bundle":{"createUpdaterArtifacts":false}}'
```

The `.app` bundle and `.dmg` installer are written under `src-tauri/target/release/bundle/`.

## Continuous integration

`.github/workflows/macos-packages.yml` builds both supported desktop architectures:

- Apple Silicon (arm64), on the `macos-26` runner.
- Intel (x86_64), on the `macos-26-intel` runner.

Each run verifies the disk image and app bundle, then publishes the `.dmg`, a zipped `.app`, build metadata, and SHA-256 checksums as workflow artifacts.

## Signing and distribution status

These CI artifacts are **not Developer ID signed or Apple-notarized**. They are intended for build validation, not yet as a public end-user release. Before publishing macOS installers, configure an Apple Developer ID Application certificate, signing identity, and notarization credentials in GitHub Actions, then add a signing/notarization verification gate. Do not distribute unsigned CI artifacts as production releases.

The existing Windows and Linux packaging workflows remain responsible for their respective installers. The Tauri bundle target list includes Windows MSI/NSIS, Linux DEB/RPM/AppImage, and macOS APP/DMG.
