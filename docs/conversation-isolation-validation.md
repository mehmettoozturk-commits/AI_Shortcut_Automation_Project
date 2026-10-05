# P0 Conversation Isolation — 2026-10-05

Status: implementation prepared; P0 remains open until Mac and physical iPhone validation.

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
