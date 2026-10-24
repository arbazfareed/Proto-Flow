# Worker Load Testing & Reliability

## Scope and safe operation

The k6 runner is opt-in and requires an exact staging hostname allowlist, a staging target classification, and the acknowledgement `I_CONFIRM_AUTHORIZED_STAGING`. ProtoFlow production domains are rejected. Never run it against production, shared customer data, or a staging account without approval.

GitHub Actions runs the Worker unit tests and typecheck nightly. The separate staging workflow runs a 30-second, 1-request/second health smoke test nightly only when its `staging` environment is configured with `LOADTEST_TARGET_URL` and `LOADTEST_ALLOWED_HOST`. Manual runs require explicit acknowledgement. Keep the GitHub `staging` environment protected with reviewer approval, and do not configure a target until the environment is authorized. Protected wallet/action scenarios require a disposable `LOADTEST_TOKEN`. Action scenarios additionally require `LOADTEST_ACTION_PAYLOAD_JSON` containing synthetic data and may spend staging credits or trigger provider/storage costs.

The profiles are:

| Profile | Rate | Duration |
|---|---:|---:|
| smoke | 1 request/second | 30 seconds |
| baseline | one tenth of the requested endpoint rate (minimum 1/second) | 10 minutes |
| target | requested endpoint rate | 10 minutes |

Scenario rates reflect the requested Phase 5 targets: anonymous auth 500/s, wallet read 1,000/s, daily claim 100/s, AI 50/s, publish 20/s, code export 20/s, and collaboration 5/s. They are stress targets, not expected production-safe rates.

## Endpoint coverage and limits

`/auth/anonymous`, `/wallet/me`, `/wallet/claim-daily`, and metered action types are exercised through their current Worker routes. Collaboration session creation is `POST /action/run` with `type: collaboration_session`; there is no `/collab/session` route. Responsive export is not a distinct cloud action in the current API, so the harness does not invent one. Use the code-export scenario only with a valid synthetic payload.

The Worker rate limits (including 10 anonymous identities/device/hour, 100 anonymous requests/IP/hour, 5 collaboration sessions/device/day, and 10 publish/export actions/device/hour) intentionally conflict with several requested peak rates. Anonymous auth also creates identities and can trigger signup-abuse challenges. Expected `402`, `409`, and `429` responses are reported in `expected_rejections`; other failures such as `403` challenges do count as failures. A low failure rate therefore does not mean the requested number of operations succeeded. Review accepted throughput and throttling alongside latency. Do not weaken abuse protections in production to make a benchmark pass.

The harness enforces P95 latency below 200 ms and an unexpected HTTP/network failure rate below 0.5%. These are acceptance thresholds, not achieved results. No hosted load run has been performed as part of this change.

## Existing and added failure coverage

The Worker test suite includes deterministic dependency failure coverage for:

- AI provider failure: returns a service error without charging credits.
- Preview publish R2/D1 failure: returns a service error without charging and cleans up uploaded objects.
- Collaboration session R2/D1 failure: returns `COLLABORATION_UNAVAILABLE`, charges no credits, and removes any uploaded project object.

Run locally from `cloud/`:

```powershell
npm ci
npm test
npm run typecheck
```

Run a staging smoke manually (k6 must be installed; use an exact hostname):

```powershell
$env:TARGET_URL = "https://<authorized-staging-host>"
$env:LOADTEST_ALLOWED_HOST = "<authorized-staging-host>"
$env:LOADTEST_TARGET_CLASS = "staging"
$env:LOADTEST_ACK = "I_CONFIRM_AUTHORIZED_STAGING"
$env:SCENARIO = "health"
$env:PROFILE = "smoke"
k6 run cloud/loadtests/worker.js
```

To exercise an authenticated endpoint, select `wallet_me` and set `LOADTEST_TOKEN` to a disposable staging JWT. It expires after 24 hours; rotate it before scheduled authenticated runs.

For a metered action, provide a valid synthetic `ACTION_PAYLOAD_JSON`. Target profile runs sustain the full requested rate for ten minutes and may cause significant traffic, credit consumption, and third-party provider/storage charges. Run them only after staging-owner approval and after setting provider spend limits outside this harness.

## Recovery and operational gaps

- **Gemini/provider failure:** covered by AI route tests; retry/backoff and circuit-breaker behavior are not established by this load-test task.
- **R2 publish failure:** covered for publish; the Worker returns an explicit failure and does not deduct credits.
- **D1 outage:** deterministic action failure coverage exists, but wallet reads do not currently fall back to a KV wallet cache.
- **KV outage:** the abuse-control test verifies fail-closed `503 RATE_LIMIT_UNAVAILABLE`; JWT validation alone does not bypass the failed abuse limiter.
- **Durable Object outage:** collaboration endpoint fault injection and force-ending/refunding a stuck live session are not implemented by this task.
- **Cloud spend cap and 80% alert:** the existing admin metrics estimate usage/costs, but an enforced daily hard cap is not implemented by this task.
- **Client offline retry, exponential backoff, and circuit breaker:** not validated here; no claim of implementation is made.

Before a real chaos drill, agree on an operator, time window, rollback path, staging backup/reset procedure, and maximum spend. Stop the run if unexpected 5xx rates, provider charges, or data changes exceed the approved bounds. Record the environment, exact scenario/profile, duration, k6 summary, throttling, and cost after each authorized run; do not present unrun targets as measured outcomes.
