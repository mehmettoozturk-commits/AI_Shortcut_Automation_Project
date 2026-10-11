# P0-1 execution/setup truth gate (open)

Status: **OPEN**. This is a design and acceptance checkpoint, not evidence of
an implemented or physically verified permission flow. Product scope remains
the broad `MASTER_SPEC.md` P0 set chosen on 2026-10-11.

## Separate ownership, never infer one from another

The current registry's `permissions` field conflates the app's own iOS runtime
authorization with prerequisites belonging to Shortcuts or a third-party app.
The release implementation must represent these as separate concepts:

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

## Current failure path

`AutomationApp.swift` injects `MockPermissionService` with four pre-granted
strings. `HTTPBackedPlanner` forwards those strings as `grantedPermissions` to
`/plan`; the backend's Permission Validator returns HTTP 422 if they are
missing. Before the 422-preservation patch, Swift turned every 422 into
`.notUnderstood`, hiding the draft. It now shows a blocked-plan review
screen when the backend includes a draft and issues; **the screen cannot
create a setup record**. This only fixes visibility, not the underlying
permission-ownership split. Simply replacing the mock with OS authorization
checks would still be both a dead end and a false proof of Shortcuts/Tesla
readiness.

## Required implementation sequence

1. Split `runtimePermission` (only permissions actually used by this app)
   from `setupRequirement` (Shortcuts/Tesla prerequisites) in the registry,
   validator contract, and UI. Default external state to unknown/user-assisted.
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
Neither commit removes the mock or closes P0-1.
