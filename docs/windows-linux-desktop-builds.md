# Windows and Linux desktop builds

## Windows

### Local build

Install the prerequisites in the [Tauri v2 Windows setup guide](https://v2.tauri.app/start/prerequisites/), including the MSVC C++ build tools and WebView2, then run:

```powershell
npm ci
npm run build
npx tauri build --bundles msi,nsis --config '{"bundle":{"createUpdaterArtifacts":false}}'
```

Installers are written under `src-tauri/target/release/bundle/msi/` and `src-tauri/target/release/bundle/nsis/`.

### CI and signing

`windows-packages.yml` builds unsigned x64 MSI and NSIS preview installers for pull requests to `main`, pushes to the cross-platform release branch, and manual runs. It uploads the installers and SHA-256 checksums as workflow artifacts for 14 days. `windows-e2e.yml` also runs desktop WebView2 E2E checks on pushes to the release branch.

Tagged production releases continue to use `signed-windows-release.yml`. That workflow requires the Windows Authenticode PFX/password and Tauri updater signing key/password secrets. It signs and verifies the executable and installers before publishing them. Never publish the unsigned preview artifacts as production installers.

## Linux

### Local build

Install the Tauri Linux prerequisites (`libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, and `patchelf` on Debian/Ubuntu-based systems), then run:

```sh
npm ci
npx tauri build --bundles deb,rpm,appimage --config '{"bundle":{"createUpdaterArtifacts":false}}'
```

Packages are written under `src-tauri/target/release/bundle/`.

### CI and install validation

`linux-packages.yml` builds DEB, RPM, and AppImage packages on Ubuntu 22.04. It runs on pushes to the cross-platform release branch and validates installation, launch, and uninstall in Ubuntu 22.04/24.04, Debian 12, Kali, Fedora, openSUSE Tumbleweed, and Arch Linux containers. Tagged builds attach packages and SHA-256 checksums to the GitHub release.

The supported x86_64 Linux install script is `scripts/install-linux.sh`. It detects DEB/RPM families, falls back to AppImage for other distributions, supports a specific release or local package, and provides an uninstall option. The Linux packages are built on Ubuntu 22.04 and therefore require glibc 2.35 or newer.

## Release and trust notes

Windows production releases are Authenticode-signed and updater-signed when the required secrets are configured. Linux packages are not currently signed with a repository/package-manager signing key; release checksums detect accidental corruption but do not authenticate the publisher. Configure and distribute a trusted package-signing key before claiming authenticated Linux packages.

macOS build and signing status is documented separately in [macOS desktop builds](./macos-desktop-builds.md).
