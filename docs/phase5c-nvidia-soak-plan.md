# Phase 5C — NVIDIA repeated-intent soak plan

Status: replacement credential restored NVIDIA chat-completion access on
2026-10-11. Conversation Isolation P0 remains closed. Phase 5C remains open:
the latest bounded run had one final provider error and a 65.3-second tail.

## Objective and scope

Repeat the same five non-sensitive intent prompts against the configured
`openai/gpt-oss-20b` NVIDIA NIM endpoint. Measure first-pass success, success
after the pipeline's one repair, final `provider_error`, the returned outcome
status, and request latency per prompt. Identify intents that fail repeatedly;
do not hide `provider_error` as `unsupported` or `not_understood`.

The five prompts are the existing `scripts/retry-smoke-test.mjs` scenarios:
Sentry Mode, climate after leaving the car, 9:00 reminder, unsupported Tesla
live camera, and battery-level notification. Each request uses a fresh empty
conversation context. The first run uses three rounds (15 top-level requests),
serially to avoid adding load to the trial endpoint. An internal repair or SDK
transport retry can make more than one underlying HTTP request for a top-level
request, so this is a bounded initial soak, not a billing or reliability SLA.

Use `scripts/nvidia-soak-test.mjs` after `npm run build`. It requires the
already-configured `NVIDIA_API_KEY` or `LLM_API_KEY`; never print or commit the
key, raw model output, or personal prompts. Report aggregate and per-intent
counts plus p50/p95/max latency. Stop before the next request after two
consecutive final provider errors or 30 minutes elapsed. This stop condition
does not interrupt an in-flight request. Record any incomplete sample as such;
do not infer a success rate for the full planned run.

## Interpretation

- A plan, missing-info question, or intentional unsupported result is a
  valid pipeline outcome if the intent semantics are correct; `provider_error`
  is not. Review per-intent statuses, not just aggregate metrics.
- Compare to the historical 10-request smoke sample (8 first-pass, 1 repair,
  1 final provider error), but do not present either small sample as a stable
  production reliability estimate.
- Phase 5C closure requires reviewing repeated failures and latency tails,
  documenting any needed hardening and a rerun. No release decision is made
  from the initial bounded run alone.

NVIDIA's [current model page](https://build.nvidia.com/openai/gpt-oss-20b)
lists this model and the `https://integrate.api.nvidia.com/v1` prototype
endpoint. The project provider is already configured for that model/endpoint.

## Initial run and follow-up

The planned 15-request run stopped after 2/15 top-level requests, as specified:

| Prompt | Pipeline result | Latency |
| --- | --- | ---: |
| Sentry departure | `provider_error` | 376 ms |
| Climate departure | `provider_error` | 244 ms |

No remaining prompt or repeat was sent. Aggregate: first-pass 0, repair 0,
final provider error 2. These fast failures are **not** evidence of model
quality or a meaningful soak sample. Read-only checks found the NVIDIA host
reachable over TLS, the configured credential accepted by `GET /v1/models`
(HTTP 200), and `openai/gpt-oss-20b` present in the account's model list.
The exact chat-completion failure cause is still unknown because the current
provider turns transport/API details into a generic `provider_error`.

One separate, content-free diagnostic call through the same provider returned
HTTP 403 (`LlmProviderError`, non-retryable). The model-listing HTTP 200 does
**not** prove inference permission. Similar firsthand reports on the
[NVIDIA Developer Forum](https://forums.developer.nvidia.com/t/403-authorization-failed-on-integrate-api-nvidia-com-v1-chat-completions-while-v1-models-returns-200-request-to-enable-public-api-endpoints-on/383161)
describe model-listing success and chat-completion 403 when Public API
Endpoints access may be missing; this is a plausible explanation, **not a
confirmed diagnosis** for this account. Check the NVIDIA organization's
inference/public-endpoint entitlement or ask NVIDIA support to review the
403. Do not share the full key in support posts or logs. Only after access is
restored should the bounded soak restart. Do not reinterpret 2/15 as a
completed reliability measurement or close 5C.

## Fresh run with replacement credential (2026-10-11)

The user replaced the configured credential without sharing its value. A
single short chat-completion diagnostic returned HTTP 200. After `npm run
build` passed, the bounded soak restarted from round 1 with clean counters;
the prior 2/15 failures were not included.

| Measure | Fresh-run result |
| --- | ---: |
| Planned / completed top-level requests | 15 / 15 |
| First-pass success | 10 |
| Success after one repair | 5 |
| Final provider errors | 0 |
| Stop reason | none |
| Elapsed time | 255,047 ms |
| Latency p50 / p95 / max | 10,727 / 43,399 / 43,399 ms |

| Intent | Outcomes across three rounds | First pass / repair | Latency p50 / p95 / max (ms) |
| --- | --- | ---: | ---: |
| Sentry departure | `plan`, `plan`, `plan` | 2 / 1 | 12,943 / 30,588 / 30,588 |
| Climate departure | `needs_clarification`, `plan`, `plan` | 2 / 1 | 10,727 / 19,217 / 19,217 |
| 09:00 reminder | `needs_clarification` × 3 | 1 / 2 | 10,168 / 43,399 / 43,399 |
| Unsupported live camera | `unsupported` × 3 | 3 / 0 | 10,269 / 15,804 / 15,804 |
| Battery notification | `plan` × 3 | 2 / 1 | 26,513 / 33,436 / 33,436 |

The access block is removed for the replacement credential; the precise
reason the prior credential received 403 remains unproven. This small sample
is not a production reliability estimate. The deterministic contract test for
the unspecified-vehicle climate request expects a `vehicle` clarification,
but two NVIDIA rounds returned `plan`; the bounded script records statuses,
not plan fields, so semantic correctness of those plans is not established.
The first run exposed an ungrounded vehicle in two climate plans. Follow-up
hardening requires a vehicle for vehicle actions to come from the current
utterance or explicitly selected same-attempt context; model-supplied vehicle
claims alone do not count.

## Follow-up bounded runs (2026-10-11)

After vehicle grounding, a second clean 15-request run completed with zero
provider errors and 14/15 semantic matches. Climate correctly requested a
vehicle in all three rounds. One `9'da bana hatırlat.` result was
`not_understood` instead of the required time-of-day clarification. The
follow-up deterministic fallback is limited to a fresh attempt where the
rule-based extractor independently recognizes a time-triggered notification
missing `time_of_day`; it has a separate counter and does not mask provider
errors.

After that fallback, a third clean 15-request run completed with no stop
reason. First-pass success was 12, repair success 2, deterministic fallback 0,
and final provider error 1. Semantic matches were 14/15. Climate was 3/3
`needs_clarification`; reminder was 2/3 `needs_clarification` and 1/3
`provider_error` (round 3, 65,335 ms). All other scenarios matched their
expected outcomes in all three rounds. Overall latency p50 was 16,384 ms and
p95/max was 65,335 ms. The fallback counter being zero does not invalidate
its deterministic regression tests; it means the fallback was not needed in
this sample. The 65.3-second error suggests a timeout or transport issue but
is **not classified** by the retained sample: no HTTP status, error type, or
per-attempt duration was recorded. Do not relabel it as a confirmed timeout.

The TypeScript suite passed 292/292 and `npm run build` passed after the
semantic hardening. Existing small samples are not a production reliability
estimate. Before a final validation run, add safe failure-only metadata at
the provider boundary (category, HTTP status when present, pipeline stage and
attempt count, durations), without logging prompts, keys, headers, bodies,
raw responses, or raw exceptions. Then rerun all tests and one fresh bounded
15-request soak. Phase 5C can close only if 15/15 requests complete with zero
provider errors and 15/15 semantic matches. Record p50/p95/max; the plan has
no binding latency SLO, so a repeated 60+ second tail is a P1 latency and
reliability finding rather than an automatic semantic failure.
