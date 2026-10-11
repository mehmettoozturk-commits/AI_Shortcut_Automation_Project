# iOS MVP closure audit — evidence checkpoint (2026-10-11)

Status: **OPEN**. This is a read-only inventory against `MASTER_SPEC.md`,
not a release decision. `P0 Conversation Isolation` and Phase 5C NVIDIA soak
remain closed. No capability is promoted from Apple/vendor documentation to
an app-installed claim without a physical-device result.

## Rating rule

- **PASS:** implemented and tested at the level the claim describes.
- **PARTIAL:** a component or narrower path works, but the whole MVP claim
  does not yet have evidence.
- **MISSING:** no shipped iOS implementation/evidence found.
- **OUT-OF-SCOPE:** explicitly excluded by an existing product decision.

`registry evidence`, `native/manual device behavior`, and `our app's
end-to-end installation` are separate claims. An `installed` repository
record after “Ekledim/Bağladım” is user-confirmed, not an OS attestation.

## MVP lifecycle matrix

| Area | Rating | Evidence and exact remaining gap |
| --- | --- | --- |
| Natural-language input, clarification, correction | **PASS** for the tested text paths | `AutomationUI/HomeView.swift`, `BuilderMachine.swift`, Phase 5A Test 5 and `docs/conversation-isolation-validation.md`; P0 isolation was physically checked. |
| Schema/capability/permission/safety validation | **PARTIAL** | TypeScript validator tests and 307/307 suite pass; the iOS app feeds mock-granted permissions, so real permission handling is not validated. |
| Understand/preview and explicit create approval | **PASS** for supported tested path | `UnderstandingView.swift`, `ReadyView.swift`, `BuilderMachine.swift`; Phase 5A physical Test 2. Unsupported actions remain distinct. |
| Shortcuts handoff and user-assisted setup | **PARTIAL** | Real iPhone Phase 5A Test 2 proved the battery-notification → signed “Bildirim Göster” template → user import/link → success path; `TemplateBackedSetupService` has no template for four other supported action IDs. |
| Plan-to-template fidelity | **PARTIAL** for the exact tested template, **MISSING** for arbitrary plans | The 2026-10-11 guard now rejects plans with additional steps, confirmation branches, or action parameters instead of selecting the **first action ID** and silently dropping the rest. It still does not encode arbitrary plans or user-specific content into a shortcut. The tested single-action notification path cannot justify a general “AI built your full workflow” claim. |
| Installed list and restart persistence | **PARTIAL** | `HomeView.swift` displays repository rows; Phase 5A Test 3 confirmed a record survives app restart. No list-detail navigation or active control exists. |
| Voice input and visible transcript | **MISSING** | `HomeView.swift` explicitly marks `micButtonDisabled`; no speech capture/transcription flow in the iOS source. `MASTER_SPEC.md` §16/§21 lists voice in the MVP. |
| Account | **MISSING** | `MASTER_SPEC.md` §21 lists an account as P0; current iOS composition is local repository + backend URL with no sign-in/account flow. Decide whether the launch MVP is intentionally local-only before claiming completion. |
| Template catalog/customization | **PARTIAL** | One signed notification template exists in the registry and starter chips exist in `HomeView.swift`; there is no iOS template catalog/category/customization flow matching §6–7/§21. |
| Automation detail, post-install edit, disable, delete | **MISSING** in iOS UI | `HomeView.swift` rows are display-only. `AutomationRepository.setActive` exists, but no iOS UI calls it; changing a local flag would not by itself disable an OS Shortcuts automation. Builder `edit()` is pre-install revision, not post-install edit. Delete is not in the repository port. |
| Test/run and activity/execution log | **MISSING** | `Execution` is only a domain model (`Domain/Models.swift`). No execution repository, iOS Activity screen, test-run UX, or device proof of runtime logging was found. Phase 5A proves setup, not a full trigger-to-log lifecycle. |
| Permission-on-demand | **MISSING** in production wiring | `App/AutomationApp.swift` injects `MockPermissionService` pre-granting Bluetooth, Tesla, notifications, and location; it also hardcodes `DeviceContext(osVersion: 26, hasCarPlay: false)`. This must not ship as genuine permission/capability detection. |
| Error/failure honesty | **PASS** for tested paths, **PARTIAL** overall | Phase 5B physical/network/setup failure tests and Phase 5C distinct `provider_error`/safe telemetry passed. Untested capabilities and actual OS installation cannot be reported as verified. |
| Production backend/configuration | **MISSING** | `App/AutomationApp.swift` defaults to `http://localhost:3000/plan` when `PLAN_BACKEND_URL` is absent. This is a development route, not an on-device release configuration. |
| Navigation, accessibility, localization | **PARTIAL** | Current iOS root is a builder state switch, not §5's five-tab app. Existing accessibility identifiers support UI tests, but full VoiceOver/Dynamic Type/localization evidence is not recorded. |

## Capability coverage — all 15 registry entries

Inventory is from `src/capability-registry/registry.ts`; Swift uses a bundled
registry snapshot. `device_verified` below describes the particular native
behavior in its cited test, not app-level installation for every workflow.

| Capability | Registry/platform evidence | Our app / launch claim today |
| --- | --- | --- |
| `ios.carplay.disconnected` | Apple docs | No physical CarPlay/app E2E; unverified launch support. |
| `ios.bluetooth.disconnected` | Device-verified native trigger (Phase 3B Test 3) | Manual linking behavior known; no app E2E for this trigger/action pair. |
| `ios.location.leave` | Apple docs | No physical/app E2E; location permission is currently mocked. |
| `ios.time_of_day.daily` | Apple docs | No physical/app E2E. |
| `ios.wifi.connected` | Apple docs | No physical/app E2E. |
| `ios.message.received` | Apple docs | No physical/app E2E; Messages only, not WhatsApp. |
| `ios.focus.changed` | Apple docs for availability; autorun behavior unverified | No physical/app E2E. |
| `ios.battery.falls_below` | Apple docs | **App setup path tested** with notification template (Phase 5A Test 2); actual battery-threshold firing/logging not proven. |
| `ios.app.opened` | Apple docs | No physical/app E2E. |
| `ios.ask_confirmation` | Apple docs | No signed action template or app E2E. |
| `ios.notification.show` | Apple docs; signed iCloud template | **App import/setup/persistence tested** with battery trigger (Phase 5A Tests 2–3); execution logging not proven. |
| `tesla.sentry_mode.toggle` | Device-verified native Tesla action (Phase 3B Test 5) | No signed app template or app E2E; fixed `mode` parameter is required. |
| `tesla.climate.start` | Registry vendor/secondary claim; no cited physical action test | No signed template or app E2E. |
| `tesla.doors.lock` | Registry vendor/secondary claim; no cited physical action test | No signed template or app E2E; high-risk action must not auto-run without evidence. |
| `tesla.camera_action` | Explicitly unsupported native Shortcuts action | Guided-manual fallback exists; never claim automatic install. |

The 9 triggers do not each need a standalone import template; templates are
selected by primary **action** in `TemplateBackedSetupService.swift`. Of five
supported action IDs, only `ios.notification.show` currently has a signed
template. The other four action semantics lack template-backed app setup
evidence (a confirmation branch may require a full workflow template rather
than a standalone action template). Any broader template must be shown to
match the **whole plan**, not merely its first action. The camera row is an
intentional unsupported/guided-manual case, not a missing signed template.

## Next work and gate

1. **Launch scope decided by Mehmet on 2026-10-11:** retain the broad
   `MASTER_SPEC.md` P0 promise. Voice, account, templates, and automation
   management are **not deferred**. A narrow battery → notification demo is
   insufficient for MVP closure. The exact set of public launch capabilities
   still needs evidence-based definition; none may be advertised from the
   registry alone.
   **Account model chosen:** start without an account, then allow an optional
   account link. The sign-in provider(s), guest-to-account ownership/migration,
   and deletion/export behavior are still open decisions; no cloud identity
   implementation or migration is implied by this choice.
2. Before any release candidate, remove mock permission grants and hardcoded
   device assumptions; provide a real backend configuration; implement or
   explicitly scope out test/log, detail/edit/disable/delete, and verify that
   local status is not mistaken for Shortcuts OS state.
3. Run Swift build/tests, full UI regression, and physical iPhone tests for
   every capability/lifecycle behavior claimed for launch. Phase 5E release
   gate remains **OPEN** until those results and the launch-scope decision are
   recorded.

No remote push, production secret change, Apple signing/TestFlight action,
historical data migration/deletion, or public capability claim is authorized
by this audit.

## Local baseline after the audit

On 2026-10-11, `swift build` passed and `swift test` reported 50 passed,
0 failed, 1 optional slow timeout test skipped. This is package-level
validation on the Mac; it is not a fresh XCUITest or physical-iPhone release
gate result. The TypeScript baseline from Phase 5C remains 307/307 passed.
