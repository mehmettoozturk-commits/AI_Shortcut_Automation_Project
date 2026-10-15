# P2-A — Routing provenance foundation

Baseline: `49f92c9e290c48d0f0e6bb6a7fa3ec81b5b882d7`.
Backend-only local development. No quota, entitlement, StoreKit, provider
activation, new key, database, commit, push or deployment.

## Request boundary and observation

Each `NluPipeline.planAsync` or `answerClarification` entry allocates a fresh
`PlanningTrace`. The trace is an optional fifth argument on `NluProvider.plan`
and is explicitly forwarded through LocalFirstProvider and repair attempts.
It is never stored on the shared pipeline/provider or in ConversationContext.
No global current-request variable or shared mutable last-result slot exists.

The optional sixth NluPipeline constructor argument, `onPlanningComplete`,
receives one frozen, detached snapshot in a finally block. Observer errors
cannot change the planning result. Production does not currently install an
observer or persist these records; a future consumer must opt in. The trace
retains no user text, model content, credentials, or raw error messages.

This boundary is NLU planning, not every HTTP request. Rejected HTTP bodies,
rate limits, and requests rejected before NLU do not generate these records.
The legacy synchronous `plan` API is unchanged and does not emit a record.

## Model

| Field | Meaning |
| --- | --- |
| `requestId` | Fresh server-generated UUID, independent of client input. |
| `route` | Routing result described below; null for an unidentified custom path. |
| `aiRequired` | AI routing was selected, independent of whether any SDK was invoked. |
| `providerUnavailable` | No AI provider was selected (rule-based fallback), or planning ended in a non-cancelled provider_error. This does not imply zero calls. |
| `resolutionSource` | local_template, rule_based, provider, deterministic_fallback, clarification_answer, or unknown. |
| `pipelineAttempts` | Pipeline attempts, including deterministic attempts; not an AI count. |
| `providerCallCount` | Number of observed adapter-to-SDK invocations for this request. |
| `callAccounting` | known for instrumented adapters/deterministic paths; unknown for an uninstrumented custom provider. Unknown zero must not authorize free usage. |
| `providerInvocations` | SDK family, first/repair stage, and pending/returned/threw for each invocation. |
| `outcome` | Existing pipeline outcome, separate from route; null if planning unexpectedly threw. |
| `cancelled` | AbortSignal state at completion. |
| `aiPlanProduced` | At least one SDK invocation, provider is the final semantic source, and pipeline outcome is plan. Not HTTP validation success, installation success, or billing confirmation. |

Routes:

- `local_template`: a supported P1 grammar resolved locally without AI.
- `clarification_required`: missing input needs clarification, or this request
  is a clarification answer (even when that answer completes a plan). Source,
  outcome and call count distinguish these cases. AI-generated clarification
  can have a nonzero call count.
- `ai_required`: unmatched local input selected AI routing, or an instrumented
  SDK was invoked directly. This alone never proves a provider call occurred.
- `provider_unavailable`: existing no-key rule-based fallback, or a final
  non-cancelled provider_error (including exhausted malformed-output repair).
  Calls already attempted remain recorded. Cancelled requests retain the
  selected route with cancelled=true rather than being relabelled unavailable.

Existing no-key fallback behavior is preserved: the rule-based provider can
still produce a useful plan. Its result is never labelled an AI-produced plan.

## Actual call recording

Claude, Gemini and OpenAI-compatible adapters call `invokeProvider` immediately
around `messages.parse`, `models.generateContent`, and
`chat.completions.create`, respectively. Prompt construction happens first.
NVIDIA and Groq use the existing OpenAI-compatible adapter. No provider choice,
SDK timeout, retry setting, prompt, or HTTP response contract changes.

First and repair calls are distinct entries. A returned SDK response with
invalid model JSON still counts as a call, even if the pipeline repairs it.
A deterministic rescue after an AI response retains its call history and
sets source=deterministic_fallback, aiPlanProduced=false.

These are SDK invocation records, not proof of network delivery, token usage,
or billable wire attempts. Any internal SDK transport retries are not counted
separately. Future quota policy must consider callAccounting, cancellation,
provider failures, repair, and idempotency; P2-A does not enforce such policy.

`retryMetrics` remains backward compatible as legacy workflow counters. It
includes local/rule-based successes and must not be interpreted as AI usage.
AI production and SDK calls now have separate request-scoped fields instead.

AbortSignal forwarding to the OpenAI-compatible SDK, one-repair behavior,
provider-error mapping and timeout settings are unchanged. Claude/Gemini's
pre-existing lack of SDK AbortSignal forwarding is not expanded in this phase.

## Verification

- TypeScript build: PASS.
- Targeted regression: 69/69 PASS across five files.
- Full backend regression: 548/548 PASS across 37 files, including 15 new
  provenance tests and five pre-existing untracked auth-server tests.
  Tracked baseline plus P2-A tests corresponds to 543 tests.
- Parallel HTTP test gates two SDK calls while completing a local request;
  snapshots contain 0/1/1 calls with local/success/failure routes and distinct
  request IDs. Client-supplied provenance does not become server metadata.
- Other tests cover local clarification and answers, no-key fallback,
  AI-required with no dispatch, all three existing SDK adapters, repair,
  timeout, pre/in-flight cancellation, AI clarification, deterministic rescue,
  unknown adapters and frozen observer snapshots.
- Existing real SDK-to-localhost timeout, disconnect and capacity tests PASS.
- HTTP response keys and existing validation behavior are preserved.
- Initial sandbox test attempt could not bind localhost (EPERM); the permitted
  local-server rerun passed. A missing trigger=null in a new mock was corrected.
- No external AI calls. Swift/UI were not changed or retested.

OPEN: billing semantics, durable usage/idempotency, observers in production,
and instrumentation of future custom providers. These belong to later scopes.
P2-B/P3/P4 and production deployment remain unstarted.
