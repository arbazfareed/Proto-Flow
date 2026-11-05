# Security and release verification

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for this repository rather than opening a public issue with exploit details. Include the affected version, impact, and steps to reproduce. Do not include real user projects, credentials, or personal data.

There is currently no verified project PGP public key. Do not rely on an unverified key for encrypted disclosure; use GitHub's private vulnerability reporting.

We aim to acknowledge reports within five business days and provide an initial assessment within ten business days. These are targets, not a guarantee.

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

## PF-T707 self-audit

The 2026-11-05 self-audit covered the OWASP Top 10 areas relevant to the Cloudflare Worker routes, AI rule generation, Tauri commands, authentication, and project-file handling. It was a static/code-and-test review, not a penetration test against a deployed service.

The audit found and fixed a Unix file-permission issue: atomic project saves no longer copy broad permissions from an existing file. New and replaced project files are created with owner-only permissions (`0600`). Unix regression tests cover both new files and replacements.

AI rule generation rejects tested instruction-override, DAN/jailbreak, secret-disclosure, and malware-generation requests before contacting the provider. Provider output is also schema-validated and checked against the supplied project references. These checks cover known test cases; they do not prove that every prompt injection or model response will be safe.

### Scan and validation status

- `npm audit --omit=dev --audit-level=high`: zero production dependency vulnerabilities.
- Full `npm audit --audit-level=high`: not clean. The current development/test dependency graph reports 15 high and 11 moderate advisories, including WebDriverIO/Tauri-service transitive packages. npm's proposed automatic fix requires a breaking WebDriverIO downgrade; `extract-zip` has no patched npm release available. These dependencies were not force-downgraded because that would risk breaking Windows desktop E2E.
- `cargo audit`: compatible Rustls and certificate-store updates were applied. Four ZIP crate advisories remain, including one critical, because the stable Tauri updater currently depends on `zip` 4.6.1 and the advisory fix requires `zip` 9 or later. Disabling ZIP support or moving to the updater's pre-release major version could break signed updater artifacts, so neither change was made without a compatible upstream release and platform verification.
- Rust formatting and 31 Rust tests pass on Windows. Unix-only permission tests require the Linux CI job; they are not exercised by a Windows test run.
- All 68 Cloudflare Worker tests pass, including the prompt-injection rejection cases. The 11 browser E2E tests and both Windows desktop E2E tests pass.
- Gitleaks 8.30.1 scanned the repository and its Git history; no leaks were found.
- OWASP ZAP and deployed-service scans were not run in this environment.
- A third-party penetration test was not performed. Do not interpret this self-audit as a clean full-dependency, OWASP ZAP, or secret-scanner result.

Re-run dependency scans and the Rust test matrix before release. Resolve or explicitly accept the development-tooling and Tauri updater advisories before claiming that all PF-T707 acceptance criteria have passed.
