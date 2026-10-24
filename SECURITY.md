# Security and release verification

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for this repository rather than opening a public issue with exploit details. Include the affected version, impact, and steps to reproduce. Do not include real user projects, credentials, or personal data.

## Windows release signatures

Official Windows release installers are Authenticode-signed and timestamped with DigiCert's timestamp service. The release workflow verifies each `.msi` and NSIS `.exe` with Windows SDK `signtool` before publishing.

To check a downloaded installer on Windows:

```powershell
Get-AuthenticodeSignature .\ProtoFlow-Setup.exe | Format-List Status,StatusMessage,SignerCertificate
Get-FileHash .\ProtoFlow-Setup.exe -Algorithm SHA256
```

The signature status should be `Valid`. Compare the SHA-256 digest with `SHA256SUMS.txt` attached to the same GitHub release. A valid checksum alone does not establish publisher identity; verify both the Authenticode signature and digest.

## Tauri updater signatures

The updater public key is configured in [`src-tauri/tauri.conf.json`](./src-tauri/tauri.conf.json), with `requireSignedVersion` enabled. Official updater artifacts are created with Tauri's updater signing key and are verified by the Tauri updater plugin before installation; the signature's trusted version must match the version in the update response. Because Authenticode signing changes installer bytes, the release workflow regenerates the Tauri updater signature after Authenticode signing. The private updater key and password must be stored only as the GitHub Actions secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Never commit or publish the private key. The app must not install an updater artifact if signature validation fails.

The updater public key currently identifies itself as `567C30596D856E3D` in its minisign comment. Rotate the configured public key and matching GitHub private-key secrets together if the private key is compromised.

## GitHub Actions release secrets

Before pushing a `vX.Y.Z` release tag, configure these repository Actions secrets:

- `WINDOWS_SIGNING_CERTIFICATE_PFX`: base64-encoded PFX for the production Authenticode certificate
- `WINDOWS_SIGNING_CERTIFICATE_PASSWORD`: PFX password
- `TAURI_SIGNING_PRIVATE_KEY`: Tauri updater private key
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: updater-key password

The release job fails closed if any secret is missing, no installer is generated, signing fails, or signature verification fails. Pull-request checks do not receive signing secrets and do not publish releases.

## Linux signing status

Linux release builds and GPG signatures are deferred until Linux release packaging is validated on the planned Kali/Linux setup. No Linux signing key or public fingerprint is currently published. Do not treat unsigned Linux artifacts as verified official releases. When Linux signing is enabled, publish the GPG public key and fingerprint here and provide detached `.asc` signatures for each `.deb` and `.AppImage`.

## SBOM and checksums

Each Windows release includes a CycloneDX JSON software bill of materials and `SHA256SUMS.txt`. These describe/check files for that release but do not replace trusted code signatures.

## Revocation and feature deprecation

If a release key is compromised, stop publishing, revoke/replace the affected signing key or certificate, publish the new trusted key through a separate trusted channel, and mark affected releases as withdrawn. Tauri updater signatures prevent tampered update payloads; they do not independently provide a minimum-version policy or remote feature-deprecation service.

Minimum-version enforcement and a signed remote feature-revocation list are not currently configured. Do not claim an affected feature can be remotely disabled until a trusted revocation service, signing key, client verification, and tested rollback procedure have been provisioned.

## Build reproducibility

The repository locks JavaScript dependencies in `package-lock.json` and Rust dependencies in `src-tauri/Cargo.lock`. Releases use GitHub-hosted Windows Server 2022, Node.js 22, stable Rust, and the locked dependency graph. Builds are not yet bit-for-bit reproducible.
