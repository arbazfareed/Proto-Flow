# ProtoFlow privacy notes

This document describes the data used by PF-T302 anonymous wallet provisioning. It is a technical disclosure for this feature, not a complete legal privacy policy.

## Anonymous wallet identity

- On desktop, ProtoFlow computes a SHA-256 device ID locally from the hostname, operating system, and CPU architecture using the existing native `get_device_id` command. The raw hostname and other source values are not sent to the Worker.
- ProtoFlow generates a random UUID install ID and stores it in the app's data directory. It is sent to the Worker with the hashed device ID to keep the wallet associated with the installation if the device fingerprint changes.
- The Worker stores the account UUID, hashed device fingerprint, install UUID, wallet balance, and wallet ledger entries in Cloudflare D1. Anonymous accounts do not include an email address.
- The app stores the signed wallet token in the operating system credential store. The balance and last-sync time are cached in local storage for offline display; the balance cache is not authoritative.
- Browser previews use a random installation UUID in browser local storage, derive the device ID hash from that random UUID, and keep the token only in session storage.

## Offline behavior and identity reset

When Cloudflare cannot be reached, the app may show the last synced balance for up to 24 hours if the cached token is still unexpired. This is a display-only grace period; the server remains authoritative and cloud actions are unavailable offline.

The wallet dialog's **Reset identity** action refreshes the local signed token for the same device/install identity. It keeps the existing account and balance and does not issue another starter grant. Removing the app's local identity files does not delete a cloud account or its records.

## Data handling

Wallet requests are sent to the configured Cloudflare Worker over HTTPS in production. For daily-refill abuse prevention, the Worker reads Cloudflare's `CF-Connecting-IP` request header and stores an HMAC hash of the address with recent wallet activity; it does not store the raw address in D1. The IP hash is keyed with the Worker JWT secret and is used to limit refills when five or more distinct wallets claim from the same IP within 24 hours. Hashed IP activity and IP grant markers are pruned after 30 days. Local requests without Cloudflare's IP header use per-account limits only. If Turnstile is configured later, suspicious claims may submit a challenge token to Cloudflare for verification.

The Worker uses the device and install IDs to resolve the anonymous account and returns a signed session token and wallet summary. This feature does not implement an account deletion workflow; deletion and retention policies should be defined before production launch.
