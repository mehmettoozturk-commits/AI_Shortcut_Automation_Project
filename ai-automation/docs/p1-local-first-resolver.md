# P1 — Local-first resolver (local development)

Scope: deterministic backend planning before the configured provider. This is
not offline iPhone planning. No new provider, quota, subscription or payment
is enabled. P2–P5, push and deployment require separate approval.

## Implementation map

- `src/nlu/local-first-provider.ts`: `resolveLocalPlan(input, context)` returns
  `local_template` with a semantic intent or `ai_required`. `LocalFirstProvider`
  implements the existing `NluProvider` port and delegates unmatched input,
  repair hints and cancellation to the existing provider.
- `src/api/serve.ts`: wraps the configured provider (or existing no-key rule-based
  provider) with `LocalFirstProvider`.
- `src/nlu/pipeline.ts`: targets the replacement vehicle rather than the first
  vehicle mentioned; supports missing clock/battery answers; preserves the
  existing registry mapping, clarification and validation flow.
- `tests/local-first.test.ts`: deterministic, isolation, cancellation and HTTP
  regression tests. Providers are fake; HTTP uses only localhost.

## Supported grammar

Normalization: NFC, Turkish lowercase, whitespace, typographic apostrophes and
one terminal sentence punctuation mark. No fuzzy matching or embeddings.

1. Exact normalized `Saat gelince bildirim gönder`: asks for a clock.
2. `Saat 08.00'de bildirim gönder` / `Saat 09:00'da bana haber ver`:
   clock preserved; hour-only input asks AM/PM when ambiguous.
3. `Pil/Batarya %20 altına düşünce bildir` and `%20 üstüne çıkınca bildir`:
   percentages 0–100, explicit `below`/`above` retained. `yüzde 20` also accepted.
4. `Pil/Batarya azalınca bana haber ver`: asks for a percentage.
5. With a Tesla plan, `Tesla Model Y yerine Model 3 kullan`: changes vehicle
   fields only, preserving steps, trigger type and other parameters.

Notification endings are `bildir`, `bildirim gönder`, `bana haber ver`.
The whole utterance must match. Exceptions, extra actions, negation, quoted
instructions, unsupported parameters and unknown phrases fall through to the
configured provider. A provider's success is never inserted in a shared cache.
No previous conversation entities are inherited by a fresh local template.

## Validation and limitations

Local output passes through the same semantic checks and registry mapping as
provider output. HTTP plans then pass schema, capability, permission and safety
validation. User approval and manual Shortcuts setup remain required.
Tests prove wrong-platform plans, unknown capabilities and unconfirmed risky
actions are rejected even after local resolution/revision.

The registry's historical battery semantic is named `battery_below`; actual
comparison is explicitly carried in `trigger.params.condition`. Backend tests
cover both directions. The follow-up P1 presentation fix makes Swift summaries
and setup instructions read the comparison, instead of hardcoding below.
At the initial implementation checkpoint, real-device above-threshold
installation was unverified. See the dated manual verification below.
The conservative setup text remains unchanged and does not claim successful installation.
No new capability or installation method was introduced.

Coverage is deliberately bounded. Natural-language variations outside these
grammars still need the existing provider. Without a configured AI key the
existing rule-based fallback retains its documented limitations. Clarification
responses accept supported single values, not compound instructions.

## Verification

TypeScript build passed. Full backend regression: 533 tests passed, including
28 new P1 tests and 5 pre-existing untracked auth-server tests. Therefore the
tracked baseline plus P1 corresponds to 528 tests. No real AI calls, provider
activation, purchase, push or deploy.
Existing unrelated dirty/untracked files were preserved.

## P1 presentation follow-up

Read-only review found existing iOS text always said below. Fixed in:
`HomeView.swift`, `BuilderViewModel.swift`, `BuilderMachine.swift` and
`CapabilityRegistryLoader.swift`, with regression matrices in
`BuilderViewModelTests.swift` and `BuilderMachineTests.swift`.
The shared registry presentation method feeds Home, understanding and detail
views; the static registry snapshot and backend JSON contract are unchanged.
Missing/invalid conditions and percentages produce clarification text, not a
below default. Setup instructions cover versions 26 and 27 and distinguish
above/below; the conservative above-support warning remains unchanged and
must not be read as a guarantee across devices or iOS versions.

Full Swift package: 141 passed, 1 existing slow-network test skipped
(126 Core executed including skip, 16 UI passed). Swift package build passed.
No physical iPhone test or XCUITest ran at the initial package-test checkpoint.

## Physical iPhone verification — 2026-10-15

The current Debug application was built and installed on a physical iPhone 16 Pro.
The Shortcuts editor directly displayed the battery trigger condition
“Üstüne Çıktığında”. The user reported receiving a notification after the
battery level crossed the configured 61% threshold, rather than by pressing Play.

The final saved rule and notification content were not independently inspected.
This is user-confirmed manual verification of the Shortcuts trigger behavior,
not independent end-to-end verification of the undeployed P1 backend-to-iPhone
flow. The Local-First Resolver remains server-side and does not provide offline
planning. The test counts above are from the previous regression run, not a
new run during this physical verification. No push or deployment was performed.

P2 follow-up: `resolveLocalPlan` exposes the route and intent.missing exposes
clarification needs, but the existing provider interface returns only intent.
HTTP provenance and per-request AI call accounting are not implemented.
Existing retryMetrics must not be used for billing: they also count local
success. Quota/router implementation remains outside P1.
