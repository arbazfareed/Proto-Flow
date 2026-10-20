# ProtoFlow privacy notes

This document describes the data used by PF-T302 anonymous wallet provisioning. It is a technical disclosure for this feature, not a complete legal privacy policy.

## Anonymous wallet identity

- On desktop, ProtoFlow computes a SHA-256 device ID locally from the hostname, operating system, and CPU architecture, then hashes that result together with the install UUID. The raw hostname and other source values are not sent to the Worker.
- ProtoFlow generates a random UUID install ID and stores it in the app's data directory. It is sent to the Worker with the hashed device ID to keep the wallet associated with the installation if the device fingerprint changes.
- The Worker stores the account UUID, hashed device fingerprint, install UUID, wallet balance, and wallet ledger entries in Cloudflare D1. Anonymous accounts do not include an email address.
- The app stores the signed wallet token in the operating system credential store. The balance and last-sync time are cached in local storage for offline display; the balance cache is not authoritative.
- Browser previews use a random installation UUID in browser local storage, derive the device ID hash from that random UUID, and keep the token only in session storage.

## Offline behavior and identity reset

When Cloudflare cannot be reached, the app may show the last synced balance for up to 24 hours after the last successful wallet sync. This is a display-only grace period; the server remains authoritative and cloud actions are unavailable offline. The app checks the Worker health endpoint every 30 seconds while reachable and backs off to 30 seconds, 1 minute, 5 minutes, and then 15 minutes after failures. The status bar reflects Worker reachability.

The wallet dialog's **Reset cloud identity** action creates a new random install ID, clears the locally cached wallet and signed token, and creates a new anonymous wallet when online. The previous cloud account and its records remain on the server. If the device fingerprint changes while the install ID remains stable, the Worker can still resolve the existing account using that install ID.

## Optional account sign-in

Signing in is optional. When a user requests an email link, the email address is sent to the Worker and Resend to deliver a one-time sign-in link. The Worker stores the address with the wallet only after verification; link tokens are single-use and expire after 15 minutes. Email requests are rate-limited by an HMAC of the normalized email address.

Google sign-in uses OAuth authorization-code flow with PKCE. Google returns a verified Google subject ID and email to the Worker; ProtoFlow stores those identifiers only when the user completes linking. OAuth state and short-lived verification tickets expire and are single-use. The desktop app uses the `protoflow://` callback scheme; browser previews return to the configured app origin.

When a verified email or Google identity already belongs to a different wallet, the Worker merges that wallet into the currently active wallet. It migrates ledger history and lifetime totals and caps the merged balance at 100 credits. Signing out unlinks the email and Google identifiers and removes the local session token without clearing the local wallet balance. Linked email addresses are held in app memory and the cloud account record, not the browser's local storage.

## Data handling

Wallet requests are sent to the configured Cloudflare Worker over HTTPS in production. For daily-refill abuse prevention, the Worker reads Cloudflare's `CF-Connecting-IP` request header and stores an HMAC hash of the address with recent wallet activity; it does not store the raw address in D1. The IP hash is keyed with the Worker JWT secret and is used to limit refills when five or more distinct wallets claim from the same IP within 24 hours. Hashed IP activity and IP grant markers are pruned after 30 days. Local requests without Cloudflare's IP header use per-account limits only. If Turnstile is configured later, suspicious claims may submit a challenge token to Cloudflare for verification.

The Worker uses the device and install IDs to resolve the anonymous account and returns a signed session token and wallet summary. This feature does not implement an account deletion workflow; deletion and retention policies should be defined before production launch.
