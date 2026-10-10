# Phase 5C — NVIDIA repeated-intent soak plan

Status: blocked on NVIDIA chat-completion HTTP 403 after the bounded initial
run stopped on 2026-10-10. Conversation Isolation P0 remains closed;
Phase 5C is open.

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
