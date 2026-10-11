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
5. Verify full Swift and TS suites, XCUITest, then physical iPhone denied →
   grant/Settings and a real Shortcuts handoff. No `installed` status for a
   denied/unaddressed prerequisite or before the explicit user confirmation
   chain; distinguish user-reported setup from machine-verified execution.

Already implemented in local commits: `fad82bf` rejects additional steps,
parameters and confirmation branches for the one static template; `22228d9`
rechecks the permission service immediately before creating a pending record.
`6b8e9d0` preserves backend 422 draft/issues on a blocked review screen;
`05b2e42` reads the actual OS major version and represents CarPlay support as
unknown. The next local change removes the production mock and separates
app-owned runtime permissions from external setup warnings. P0-1 remains open.

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
