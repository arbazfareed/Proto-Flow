# ProtoFlow Ops dashboard

This is a separate static React/Vite application for the maintainer. It does not use the desktop wallet JWT and has no local authentication bypass. The Worker accepts admin requests only when it verifies the signed `Cf-Access-Jwt-Assertion` against the configured Cloudflare Access issuer and application audience and the verified email is in `ADMIN_ALLOWED_EMAILS`.

## Local development

1. Apply the Worker migrations from `cloud/` with `npm run db:apply:local`.
2. Add a non-production `ADMIN_ACCESS_TEAM_DOMAIN`, `ADMIN_ACCESS_AUD`, and `ADMIN_ALLOWED_EMAILS` to `cloud/.dev.vars` if you have a local Access token issuer for tests. These are omitted by default; without them, every admin API request fails closed with `ADMIN_NOT_CONFIGURED`.
3. Run the Worker on port 8790 (`npm run dev -- --port 8790` from `cloud/`).
4. Run `npm install` and `npm run dev` from `cloud/admin/`.

The local Pages preview is at `http://127.0.0.1:1422`. Browser auth still needs an Access-issued assertion. Unit tests provide a test RSA/JWKS issuer and never add a runtime bypass.

## Cloudflare Pages setup

Create a Git-integrated Pages project for this repository with:

- **Root directory:** `cloud/admin`
- **Build command:** `npm run build`
- **Build output directory:** `dist`
- **Production branch:** `main`
- **Build watch paths:** `cloud/admin/**` (and any shared paths that are later introduced)
- **Environment variable:** `VITE_ADMIN_API_URL=https://<your-worker-host>`
- **Custom domain:** for example `admin.protoflow.app`

In Zero Trust, protect both the Pages hostname and Worker API hostname with Cloudflare Access and an **Allow** policy whose Include selector is the maintainer’s exact email. Prefer one multi-hostname Access application so the browser carries the API-host cookie and the Worker receives the matching audience; if they are separate applications, configure `ADMIN_ACCESS_AUD` to the API application's AUD (the Pages app's AUD is not interchangeable). Do not add an Everyone rule, Bypass policy, or service-token exception for the browser dashboard. The Worker still independently validates the Access JWT, issuer, API application AUD, and `ADMIN_ALLOWED_EMAILS` list.

Configure Worker variables (do not commit actual values):

- `ADMIN_ACCESS_TEAM_DOMAIN=https://<team-name>.cloudflareaccess.com`
- `ADMIN_ACCESS_AUD=<Access application AUD for the Worker API application>`
- `ADMIN_ALLOWED_EMAILS=<comma-separated exact maintainer emails>`
- `ADMIN_ALLOWED_ORIGINS=https://admin.protoflow.app`
- Optional alerts: `ADMIN_ALERT_EMAIL`, `ADMIN_ALERT_WEBHOOK_URL`, `ADMIN_AI_COST_THRESHOLD_USD`
- Optional estimate rates: `GEMINI_INPUT_USD_PER_MILLION`, `GEMINI_OUTPUT_USD_PER_MILLION`, `R2_STORAGE_USD_PER_GB_MONTH`, `D1_READ_USD_PER_MILLION`, `D1_WRITE_USD_PER_MILLION`

Protect the Worker admin API hostname/path with Cloudflare Access too. Apply `0007_admin_audit_usage.sql` to each D1 database before deploying the Worker. Deploy the Worker and Access policy before connecting Pages production traffic.

## Operational semantics

- Cost charts are estimates, not billing data. They use configurable rough unit rates and token/asset byte counters when available.
- Today’s metered handlers are deliberately not implemented and do not charge credits. The Worker records request counts only; reported request counts do not imply completed AI, publish, or export operations.
- Alerts check hourly for signup spikes, configured AI cost thresholds, and accounts spending at least 500 credits in an hour. Email and/or an HTTPS webhook must be configured for delivery. Alerts are deduplicated in KV for 48 hours.
- Adjustments and bulk actions are bounded, require a reason, and write an `admin_audit` record. Device hashes and linked emails are the only identity fields shown; raw device IDs, prompts, IPs, credentials, and JWTs are never displayed.
