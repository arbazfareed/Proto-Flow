# ProtoFlow Privacy Policy

**Last updated: 24 October 2026**

ProtoFlow is a desktop prototyping app. Your local project files stay on your device unless you choose a cloud feature that sends project data to ProtoFlow. Wallet, diagnostics, and telemetry are separate controls; crash reporting and anonymous telemetry are off until you opt in.

## Information ProtoFlow processes

- **Local app data:** project files you save, app preferences, privacy choices, and a short in-memory diagnostic log. Local project files are not uploaded by autosave.
- **Cloud wallet:** an account ID, a random installation ID, a SHA-256 device fingerprint, wallet totals, and credit-ledger entries. Anonymous wallets do not need an email. A linked email or Google account is stored only if you choose account linking.
- **Cloud publishing and collaboration:** when you publish a preview or start collaboration, the selected project content, project name, preview/session metadata, and collaboration checkpoints are sent to ProtoFlow's Cloudflare services. Published previews are accessible to anyone with their unlisted link until they expire or are removed.
- **Abuse prevention:** Cloudflare supplies a client IP to the Worker. ProtoFlow stores keyed hashes, not raw IP addresses, for abuse limits. Keyed IP activity is pruned after 30 days; abuse flags are retained for up to 90 days.
- **AI actions:** when you explicitly use an AI feature, the prompt and the selected context required for that action are sent to the configured AI provider. Do not include information you are not comfortable sharing with that provider.
- **Crash reporting and telemetry:** these are independent, optional settings. If enabled and configured, sanitized crash diagnostics may be sent to a Sentry/GlitchTip-compatible endpoint and allow-listed feature events may be sent to Umami. Analytics events use fixed event names and allow-listed enums/counts, a fixed app URL, and batches of up to 20 events flushed every 30 seconds. They do not include project contents, names, file paths, variable values, browser paths, referrers, cookies, or account/device identifiers. They are not used to upload project content. No third-party analytics cookies are used.

## Why and where data is processed

ProtoFlow processes cloud account data to provide wallet synchronization, account recovery, cloud previews, and real-time collaboration. Cloudflare is the infrastructure provider and processor for the Worker, D1 database, KV, R2 storage, and Durable Objects. Resend sends email sign-in links when configured. Google handles Google sign-in and, when configured, Gemini AI requests. Sentry/GlitchTip and Umami are optional diagnostic and analytics subprocessors; they receive data only when the relevant preference is enabled and the endpoint is configured.

Cloud requests use HTTPS in production. The app does not use third-party cookies. Browser previews store a random install ID in local storage and a short-lived session token in session storage. The desktop app stores its session token in the operating system credential store; local wallet display data and preferences are stored on the device.

## Retention

- Cloud previews expire after 30 days unless removed sooner.
- Inactive collaboration sessions end after four hours. Their session and checkpoint records remain while the cloud account is active, unless the account owner requests cloud-data deletion.
- When you request cloud-data deletion, ProtoFlow disables the account immediately and attempts to remove published previews, collaboration sessions, and checkpoints immediately. Remaining wallet, ledger, authentication, and account records are queued for permanent deletion after a 30-day recovery period. If cloud-content cleanup is temporarily unavailable, the Worker retries it during scheduled retention cleanup.
- Abuse-prevention IP hashes are kept for up to 30 days, and abuse flags for up to 90 days. Email sign-in links expire after 15 minutes.
- Local project files, local preferences, and local diagnostic logs are not deleted by cloud-data deletion. Export local diagnostic logs separately from Privacy & diagnostics settings.

## Your choices and rights

You can independently turn crash reporting and anonymous telemetry on or off in **Privacy & diagnostics**. Cloud features are optional. In Wallet settings, **Export my data** downloads a JSON copy of account and wallet details, the complete credit ledger, cloud preview/collaboration metadata, and (only when crash reporting is enabled) recent sanitized diagnostic lines held in memory. Crash reports sent to an external provider are not linked to a ProtoFlow account and cannot be retrieved by this export.

Anonymous telemetry is off unless you opt in. Its catalog covers lifecycle, project, canvas, logic, preview/runtime, panels/repeaters, exports, sign-in provider, metered action type/outcome, and coarse error category events. Events are queued locally and sent only to the configured Umami endpoint after consent; disabling telemetry clears unsent events. The current build has no analytics endpoint configured, so it does not transmit telemetry. Dashboard publication, scheduled weekly email digests, and user-level retention/cohort analysis require separate provider and maintainer infrastructure. User-level retention/cohorts are not enabled because the telemetry payload intentionally contains no persistent user or device identifier.

In Wallet settings, **Delete my cloud data** requires typing `DELETE`. It clears the local cloud session and wallet cache after the Worker accepts the request. The action does not remove local project files or local diagnostic logs. You can also request access, correction, or deletion by emailing [privacy@protoflow.app](mailto:privacy@protoflow.app). We target a response within 30 days. Deletion requests are subject to the 30-day recovery period described above and any data that must be retained by law.

## Children and age

ProtoFlow is intended for people aged 13 or older, and 16 or older in the European Union. The app does not perform age verification or knowingly seek personal information from children below those ages.

## Contact

For privacy questions or data-rights requests, contact [privacy@protoflow.app](mailto:privacy@protoflow.app). Do not email project files, passwords, authentication tokens, or other sensitive material.

## Implementation notes

The app's JSON export includes metadata about cloud previews, collaboration sessions, and checkpoints; it does not include the content of cloud checkpoint objects. The app does not associate Sentry/GlitchTip crash events with wallet accounts. A live public website for this policy is not configured in this repository; deploy the packaged `public/privacy.html` page to the production website before representing this policy as publicly published.
