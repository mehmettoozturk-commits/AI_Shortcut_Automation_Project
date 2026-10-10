# P0 Conversation Isolation — 2026-10-05

Status: P0 closed after Mac, Simulator, and physical iPhone validation on 2026-10-10. Phase 5C is unblocked but has not started.

## Repository checkpoint

The Windows checkout started on `main` at `66ba1603e1ffa8f569f8c4ea33bc00018e0a85fa`.
Reading `git ls-remote origin HEAD` confirmed the same remote commit on 2026-10-05.
The AI Kestirme project's “Mobil uygulama projesi” conversation reports physical
5B-4/5B-5 completion and Phase 5B closure on 2026-09-27. Those closure updates
are absent from this checkout and the remote main checkpoint. This report does
not recreate or independently certify those historical device results.

## Change

- TS and Swift Planner ports require `resetConversation`.
- Builder open resets conversation before entering capturing; close clears
  attempt state and resets conversation before entering idle.
- Swift lifecycle methods await the actor reset; ViewModel, SwiftUI callers,
  and existing tests now await that boundary.
- TS `resetContext` remains a compatibility alias.
- Clarification and correction do not reset conversation within an attempt.
- Swift close also clears the pending Shortcuts handoff.

## Verified in Windows

- `npm.cmd test`: 283/283 passed, 21 test files.
- New TS isolation coverage: 3/3 passed, including abandoned-attempt isolation,
  open without prior close, and same-attempt multi-turn correction through install.
- `npm.cmd run build`: passed.
- `npm.cmd run build:web`: passed.

## Required before closing P0

No Swift, Xcode, UI, or physical iPhone tests were run in this Windows environment.
The Swift leakage test now asserts fresh conversation instead of expecting a leak.
A second test exercises same-attempt clarification/correction through installed.
Both are pending execution, not recorded as passing.

On Mac:

1. In `ai-automation/ios-bridge`, run `swift build` and `swift test`, including
   both `ConversationLeakageTests` and the complete Core/UI suites.
2. Run the complete AutomationApp XCUITest regression with the existing backend
   and a configured simulator. Keep personal signing/backend settings out of
   the feature commit.
3. On physical iPhone, verify `Arabadan inince klimayı aç` → Model Y →
   `Hayır, Model 3.`; confirm trigger/action remain intact and the corrected
   device is preserved. Abandon an attempt and confirm the next attempt has
   no previous conversation.
4. Record actual counts, results, commit hash, and Git status. Only then close
   Conversation Isolation P0 and proceed to 5C NVIDIA soak.

Real permissions, safety-validator confirmation semantics, request-size limits,
and historical Phase 5B documentation synchronization are separate work items.

## Mac and physical iPhone verification (2026-10-05–10)

- Mac `swift build`: passed. `swift test`: 49 passed, 1 optional slow timeout
  test skipped; `ConversationLeakageTests`: 2/2 passed.
- Complete AutomationApp XCUITest regression on iPhone 17 Pro Simulator
  (iOS 26.5): 7/7 passed. The temporary xcresult bundle was generated during
  the run but is no longer present on disk.
- Physical iPhone 16 Pro: after leaving the Tesla attempt, a new battery
  request showed a battery-level trigger and notification action, with no
  Tesla/climate content in the UI. This is an observed isolation result;
  the physical HTTP request payload was not captured. The Swift test above
  asserts that the new request omits the previous `conversation` payload.
- Physical text correction `Tesla Model Y` → `Hayır, Model 3.` preserved the
  Bluetooth-disconnect trigger and climate action in the UI. The resulting
  device record `auto-968977AD` has `trigger.device = "Tesla Model 3"` but
  `trigger.params.vehicle = "Tesla Model Y"` (status `pending_user`). The
  plan is internally inconsistent, so the correction criterion fails and
  P0 stays open. The earlier selection-based change, record `auto-CCCFFC5A`,
  set `device = "Tesla Model 3"` while leaving `params.vehicle = null`.
- Cause located without a code change: `plan-builder.ts` copies the original
  semantic vehicle into both fields; `DefaultPlanRevisionEngine.revise()`
  updates `trigger.device` and `answers.vehicle`, leaving
  `trigger.params.vehicle` unchanged. Swift `answerMissingInfo()` likewise
  updates only `trigger.device`.

Required next: reconcile vehicle fields, add a regression assertion for both
the text correction and selection paths, rerun Mac/UI tests, and repeat the
physical correction check. Close P0 only after the stored plan is consistent;
then begin Phase 5C NVIDIA soak.

## Vehicle consistency fix and P0 closure (2026-10-10)

- Commit `48d08db` synchronizes vehicle fields on text correction and
  clarification selection. Full TypeScript tests: 286/286; Swift tests:
  50 passed, 1 optional skip, including leakage 3/3; XCUITest on iPhone 17
  Pro Simulator (iOS 26.5): 7/7.
- On physical iPhone 16 Pro, `Arabadan inince klimayı aç.` retained the
  Bluetooth-disconnect trigger and Tesla climate action after the final text
  correction `Hayır, Model 3.`. New record `auto-02DB16B9` has both
  `trigger.device` and `trigger.params.vehicle` equal to `Tesla Model 3`.
- After terminating and relaunching the app, a fresh battery request showed
  only battery-level trigger and notification action, with no Tesla/climate
  content. Swift leakage tests confirm the previous conversation payload is
  absent. No Shortcuts import or Tesla action was run for this check.

Conversation Isolation P0 is **closed**. Phase 5C is unblocked, but its
separate SPEC/PLAN and NVIDIA soak have not run yet.
