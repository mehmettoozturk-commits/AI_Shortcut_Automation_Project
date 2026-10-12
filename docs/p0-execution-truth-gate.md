# P0-1 execution/setup truth gate (open)

Status: **OPEN**. This is a design and acceptance checkpoint, not evidence of
an implemented or physically verified permission flow. Product scope remains
the broad `MASTER_SPEC.md` P0 set chosen on 2026-10-11.

## Separate ownership, never infer one from another

The legacy registry field `permissions` was treated as if it were this app's
iOS authorization, although its values describe Shortcuts/Tesla setup. P0-1
has renamed it to `setupRequirements` in both TS and the Swift snapshot;
`runtimePermissions` is reserved for app-owned OS APIs. The concepts must
stay separate:

| Requirement | Owner / observable state | What the app must not claim |
| --- | --- | --- |
| App notification authorization | This app's `UNUserNotificationCenter` settings | This does not prove the imported **Shortcuts Show Notification** action or automation is configured. |
| App Bluetooth authorization | This app's Core Bluetooth authorization, if the app itself uses Core Bluetooth | This does not prove a Bluetooth-disconnect personal automation is configured in Shortcuts. |
| App location authorization | This app's Core Location status, if the app itself uses location | This does not prove a Shortcuts location automation has its own required access/setup. |
| Tesla action/account setup | Tesla app and Shortcuts action; currently user-assisted/unknown to this app | This does not become verified because an app-local OS permission is granted. |

Until a requirement has an observable verification source, use `unknown` or
`user_assisted`, **not** `granted`. After a documented step, a separate
`user_confirmed` state can record what the person reported; it is not machine
verification of action execution. The existing two explicit import/link
confirmations remain necessary. If the UI calls that state `installed`, it
must say it is user-reported, not independently verified; actual trigger
execution/logging requires separate evidence.

Apple references: [notification authorization](https://developer.apple.com/documentation/usernotifications/unusernotificationcenter/requestauthorization%28options%3Acompletionhandler%3A%29/),
[Core Bluetooth authorization](https://developer.apple.com/documentation/corebluetooth/cbmanager/authorization-swift.type.property),
[Core Location authorization](https://developer.apple.com/documentation/corelocation/cllocationmanager),
[Shortcuts Show Notification](https://support.apple.com/en-ie/guide/shortcuts/apd2175adcab/ios).

## Failure path and current mitigation

Before P0-1, `AutomationApp.swift` injected `MockPermissionService` with four
pre-granted strings. `HTTPBackedPlanner` forwarded those as
`grantedPermissions`; without them the backend returned HTTP 422, and Swift
hid the draft as `.notUnderstood`. The mock is now removed from production.
Today's registry declares no app-owned runtime permissions, so the app sends
no OS grants and the backend returns the plan with external setup warnings;
preview displays user-assisted requirements. A future app-owned permission
without a native adapter fails closed. Independent 422s carrying draft and
issues show a blocked-plan screen with **no create path**. None of this
proves the external Shortcuts/Tesla setup actually succeeded.

## Required implementation sequence

1. `runtimePermission` (only permissions actually used by this app) and
   `setupRequirement` (Shortcuts/Tesla prerequisites) are split in the
   serialized registry, validator and UI. Finish the persistent user-assisted
   state model; default external state to unknown.
2. Preserve the draft and typed issues on backend 422. The first patch shows
   the plan and safe, generic issue guidance without a create path; full
   actionable requirement-specific guidance is still pending. Never label
   a recognized draft generic “not understood”.
   A 422 containing non-permission schema/capability/safety errors remains
   fail-closed. Do not treat issue codes or client-side state as proof of a
   granted permission.
3. Read actual app-owned permission states only where the app truly needs
   the corresponding framework, with denied/restricted/not-determined paths.
   Do not request an app OS permission solely to satisfy a Shortcuts-owned
   requirement. The app now reads its OS major version from `ProcessInfo` and
   leaves CarPlay support unknown rather than asserting `false`; the resolver
   conservatively offers Bluetooth until CarPlay support can be established.
4. Gate setup on whole-plan/template fidelity and visible user-assisted
   prerequisites. Unsupported combinations must stay out of the import path.
5. Verify full Swift and TS suites and XCUITest. On a physical iPhone,
   exercise a real battery → notification Shortcuts handoff in both success
   and cancellation/failure paths. The app must not request its own
   notification, Bluetooth or location permission for APIs it does not use;
   any Shortcuts/system prompt is a user observation, not app verification.
   Show external requirements before setup. The success path needs both
   explicit import/link confirmations before the UI says “Kurulum bildirildi”.
   A failed setup must not become installed. Relaunch after both paths to
   check persistence. Separately, exercise a backend 422 carrying draft and
   issues on-device: retain the draft and block Create, with no technical
   capability ID visible. No actual execution claim follows from handoff.

Already implemented in local commits: `fad82bf` rejects additional steps,
parameters and confirmation branches for the one static template; `22228d9`
rechecks the permission service immediately before creating a pending record.
`6b8e9d0` preserves backend 422 draft/issues on a blocked review screen;
`05b2e42` reads the actual OS major version and represents CarPlay support as
unknown. `a4e6cc2` removed the production mock and separated app-owned
runtime permissions from external setup warnings; `ca53656` renamed the
serialized registry field and clarified user-reported installation in the UI.
P0-1 remains open pending fresh regression and physical evidence.

## 2026-10-11 local regression after removing the production mock

- `npm run build`: pass; TypeScript `npm test`: **308/308 pass** after the
  serialized registry rename and TS↔Swift snapshot parity check. API test
  verifies empty app runtime grants produce a visible plan plus
  `setup_requirement_unverified` warning, not a fake grant or HTTP 422.
- Swift package `swift test`: **57 pass, 1 optional slow test skipped**.
  Tests distinguish external setup disclosure from app runtime permission,
  and ensure an added app-owned permission without a grant fails closed.
- iOS Simulator app build: pass. Full XCUITest on iPhone 17 Simulator,
  iOS 26.5: **7/7 pass**, 0 failed/skipped. Result bundle:
  `/private/tmp/codex-p0-ui-20261011-2337.xcresult`.
- No fresh physical-iPhone permission, import/link, or actual trigger run
  was performed in this checkpoint. A simulator pass is not release evidence.

## 2026-10-12 regression and physical-device checkpoint (in progress)

- Fresh `npm run build`: pass; TypeScript suite: **308/308 pass**. A first
  sandboxed test invocation could not bind a local socket (`EPERM`), so the
  complete suite was rerun with local-socket access and passed.
- Fresh `swift build` and `swift test`: pass, **57 passed / 1 optional skipped**
  across the package suites at the initial checkpoint. Full iPhone 17
  Simulator XCUITest: **7/7 pass**, result bundle
  `/private/tmp/codex-p0-ui-20261012.xcresult`.
- Current signed development app was installed on a paired iPhone 16 Pro.
  With a deterministic local backend, the user observed a battery →
  notification plan and a visible external setup warning on the real device.
  This proves neither a Shortcuts import nor actual trigger execution.
- On the cancellation path, the user opened Shortcuts, did **not** add the
  template, returned and selected “Ekleyemedim”. Reading only the app's local
  `automations.json` before and after showed 6 → 7 records, `failed` 1 → 2,
  `installed` unchanged at 1, and all 6 preexisting record IDs/statuses
  preserved. After an app process restart, the user observed the failed
  attempt still labeled “Başarısız” on Home.
- A separate physical iPhone XCUITest exercised the real backend validator's
  HTTP 422 response with a known battery trigger plus blocked capability and
  safety issues. The first device-runner attempt timed out during CoreDevice
  authentication before app tests began; after closing iPhone Mirroring and
  keeping the device awake, the retry and final run each passed **1/1**.
  Final result bundle: `/private/tmp/codex-p0-physical-422-final.xcresult`.
  The blocked screen retained the known draft, showed distinct safe guidance
  without technical capability IDs, and offered neither Create nor import.
  Reading the app's `automations.json` before and after relaunch showed all
  **7** records unchanged, so the blocked attempt created no false setup
  record. The final Swift unit suite passed **58 tests / 1 optional skipped**.
  The fresh full iPhone 17 Simulator UI regression passed **7/7** with zero
  failures or skips (`/private/tmp/codex-p0-ui-20261012-final.xcresult`).
- A later Home screenshot showed that the user had tapped the read-only
  “Otomasyonlarım” rows; that did not enter a Shortcuts import flow. The
  successful import/link path and its relaunch persistence still require
  physical evidence.
- In a new physical attempt, the user added the signed “Bildirimi Göster”
  template; it appeared in Shortcuts' “Tüm Kestirmeler” library. The app's
  two confirmation buttons were then tapped, and its new record changed
  `pending_user` → `installed` in place (8 → 8 records; the other seven
  records were unchanged). However, the iOS 27 Shortcuts “Otomasyon” view
  still displayed **“Otomasyon Yok”**. Thus the app label “Kurulum
  bildirildi” correctly describes only a user report; the actual trigger
  was not linked. Running the imported shortcut also produced a Shortcuts-
  owned privacy error: it cannot access “Notification” until configured
  in the shortcut's privacy settings. No app-owned notification permission
  prompt was observed. Neither the trigger nor notification action can be
  counted as physically working yet.
- Apple’s [iOS 27 Shortcuts guide](https://support.apple.com/en-om/guide/shortcuts/apdfbdbd7123/10.0/ios/27)
  describes adding an automation from an existing shortcut via Edit →
  Automation. The older generic guidance to use the empty Automation view's
  plus button opened a blank new shortcut on this phone; it was exited
  without saving. The battery-specific iOS 27 instructions were corrected
  in Swift. Final Swift suite passed **59 tests / 1 optional skipped**;
  a fresh full iPhone 17 Simulator UI regression passed **7/7** with zero
  failures or skips (`/private/tmp/codex-p0-ui-20261012-ios27-guidance.xcresult`).
  The corrected instructions have not yet been reinstalled and observed on
  the physical iPhone. **P0-1 remains OPEN.**
