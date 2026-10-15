# P2-B1 — Backend router foundation

Baseline: `a0f260a8240ae80810767bd18400c7b4f31a21e6`.
Local backend implementation and mock tests only. No commit/push, live provider
activation, new credentials, billing, subscription, quota or deployment.

## Changed files

- New `src/nlu/routing-access.ts`: server identity/access contracts and defaults.
- New `src/nlu/provider-router.ts`: separate channel contracts, immutable
  configuration snapshots, bounded access resolution and request-bound router.
- Modified `src/api/server.ts`: optional router injection after HTTP admission
  and body/schema checks; lazy server identity resolution before AI only.
- Modified `src/nlu/planning-provenance.ts`: internal channel/configuration
  metadata and authoritative zero-dispatch recording on router rejection.
- New `tests/provider-router.test.ts`: 36 deterministic tests.
- New `docs/p2-b1-router-foundation.md`: this report.

## Default OFF and existing API security

`createPlanServer` only selects the router when `routing.enabled === true`.
Omission or false keeps the original injected/default pipeline. `serve.ts`
still calls `createPlanServer({ pipeline, auth, tls })` and is unchanged.
No environment flag enables this foundation. No channel/provider factories
are added to production startup; all enabled examples are test injections.

Existing rate/concurrency limits and body/schema checks precede planning.
Local-First then runs before entitlement resolution. All completed plans still
cross the existing schema/capability/permission/safety validation chain.
Existing auth routes and transport policy are unchanged. The existing public
guest `/plan` access is preserved; this work does not invent a mandatory login
check for local plans or weaken any existing check.

Tests prove 400/413/429/503 admission behavior, wrong-platform 422 responses,
and rejection of client-supplied unsafe/unknown capabilities after local
revision, even with the router enabled.

## Trusted access boundary

`RoutingSubject` is a frozen server-created guest/account identity. It is not
read from request JSON, conversation history, tier/premium/userId claims or
custom Premium headers. For AI requests, absence of Authorization means guest.
A supplied bearer token must be valid according to the existing AuthService
session lookup and existing auth transport policy; malformed, expired, revoked,
unverifiable or unavailable identities block AI routing. Errors do not expose
raw identity/token details. No new auth storage or session format is introduced.

The injected server `AccessResolver(subject, signal)` returns:

| Access | Basis | Behavior |
| --- | --- | --- |
| free | guest / no_premium | Select only the Free binding. |
| premium | verified_entitlement, account identity required | Select only the Premium binding. |
| unavailable | unresolved | Reject before SDK dispatch. |

Invalid/malformed resolver output, exceptions and timeout also block dispatch.
Guest identity cannot receive Premium even if a resolver mistakenly returns it.
The default resolver allows guests as Free and returns unavailable for accounts:
Apple login is not proof of an entitlement or absence of one.
`developmentFreeAccessResolver` is an explicitly named development fixture;
it is never implicitly selected. Production entitlement verification is absent.

Resolution has a default 2-second deadline, capped at 5 seconds. Client abort
propagates to its AbortSignal. Even an uncooperative late resolver cannot cause
SDK dispatch after timeout/cancellation. Cooperative implementations remain
responsible for stopping their own background work.

## Configuration and repair affinity

Each channel has a separate binding: channel, non-secret configurationId,
providerId, model, symbolic keyReference, enabled state and an injected provider.
Only existing provider IDs are accepted. Missing/disabled/malformed bindings
block dispatch. General LLM_API_KEY references, shared channel key references,
shared configuration IDs and credential-like diagnostic labels are rejected.

These are configuration/binding contracts, not credential resolution or SDK
construction. No key is read or provisioned by the router. P2-B2 must validate
that real provider factories honor each model/key binding before activation.
The legacy production key/provider path remains untouched while routing is OFF.

The server snapshots bindings on construction. Every accepted planning request
gets a fresh router and pipeline, with one memoized access/provider selection.
Repair uses the same provider reference and configuration; access is not
resolved again. Reusing a router with another request trace is rejected.
There is no automatic Premium-to-Free, provider-to-provider or rule-based
fallback in the enabled router. Existing narrow deterministic pipeline rescue
remains unchanged and retains the original AI call accounting.

## Provenance and response compatibility

P2-A snapshots now also contain `routingAccess`, `routingChannel` and
`routingConfigurationId`. They remain null for router-OFF/local-only paths.
Only validated non-secret configuration IDs are recorded; model/key reference,
token, identity, raw entitlement output and errors are not copied into traces.
Blocked selections have zero calls and known accounting. Actual calls are still
recorded only by the existing SDK-boundary instrumentation, including repair.
SDK failures retain their selected channel and actual invocation history.

Router rejection uses non-retryable LlmProviderError and the existing HTTP 502
provider_error response shape. No tier/provenance field is added to the API.
Existing OpenAI-compatible AbortSignal/timeout settings remain unchanged.
Enabled routing creates per-request pipeline counters; the request provenance
observer, not a shared legacy retryMetrics object, is the observation boundary.

## Verification

- TypeScript build: PASS.
- Full backend regression: **584/584 PASS**, 38 files, including **36 new router
  tests** and 5 pre-existing untracked auth-server tests. Tracked baseline plus
  P2-B1 tests corresponds to 579 tests.
- Initial targeted run: 48/48 PASS before four additional HTTP/isolation tests
  and two explicit validation tests were added.
- A new test's cleanup initially attempted to close an unstarted auxiliary
  server. The fixture was corrected; the final complete run passed.
- Guest/verified-test-Premium routing, forged client claims, unresolved/error/
  malformed access, no-Premium versus unresolved account, missing/invalid
  bindings, config snapshots, same-provider repair, parallel isolation,
  access timeout/abort, in-flight SDK abort/timeout and router-OFF coverage PASS.
- Existing SDK-to-localhost timeout/disconnect/capacity regressions PASS.
- `git diff --check`: PASS. No external AI calls; SDK clients are mocked, HTTP
  tests bind localhost. No Swift/UI changes or tests in this phase.

## OPEN / activation blockers

- No authoritative Premium entitlement implementation (P4), real Free/Premium
  provider selection, credential binding validation or activation (P2-B2).
- No daily quota, durable usage, reservations or idempotency (P3).
- iPhone plan requests do not yet attach account sessions.
- SDK calls are not token/billing/wire-retry accounting. Custom providers still
  require instrumentation; unknown accounting cannot authorize free usage.
- Existing Claude/Gemini cancellation limits and RH-02/RH-07 remain open.
- No production decision or deployment is authorized by this implementation.

STOP after P2-B1. All real-user routing activation requires a separate decision.
