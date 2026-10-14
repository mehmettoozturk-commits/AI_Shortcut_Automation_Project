import XCTest
@testable import AutomationCore

@MainActor
final class VoiceSessionGateTests: XCTestCase {
    func testPermissionWaitRejectsDuplicateStart() async {
        let gate = VoiceSessionGate()
        var continuation: CheckedContinuation<Bool, Never>?
        var calls = 0
        let first = Task { await gate.authorize { calls += 1; return await withCheckedContinuation { continuation = $0 } } }
        while continuation == nil { await Task.yield() }
        let second = await gate.authorize { calls += 1; return true }
        XCTAssertNil(second)
        XCTAssertEqual(calls, 1)
        continuation?.resume(returning: true)
        let token = await first.value
        XCTAssertNotNil(token)
    }

    func testStoppedSessionAndOldErrorCannotAffectNewSession() async throws {
        let gate = VoiceSessionGate()
        let oldResult = await gate.authorize { true }
        let old = try XCTUnwrap(oldResult)
        gate.stop()
        XCTAssertFalse(gate.accepts(old))
        let newResult = await gate.authorize { true }
        let new = try XCTUnwrap(newResult)
        var transcript = "new"
        // Native callbacks apply precisely this shared ownership check.
        if gate.accepts(old) { transcript = "stale"; gate.stop() }
        XCTAssertEqual(transcript, "new")
        XCTAssertTrue(gate.accepts(new))
    }

    func testStopDuringPermissionWaitDoesNotStartAudioOrClaimNewOwnership() async {
        let gate = VoiceSessionGate()
        var continuation: CheckedContinuation<Bool, Never>?
        let first = Task { await gate.authorize { await withCheckedContinuation { continuation = $0 } } }
        while continuation == nil { await Task.yield() }
        gate.stop()
        let new = await gate.authorize { true }
        continuation?.resume(returning: true)
        let old = await first.value
        XCTAssertNil(old)
        XCTAssertTrue(new.map(gate.accepts) ?? false)
    }
}
