import XCTest
@testable import AutomationCore

@MainActor
final class VoiceResourceOwnerTests: XCTestCase {
    enum StubFailure: Error { case taskStart }

    func testPartialAcquisitionReleasesTapBeforeNextSession() throws {
        let owner = VoiceResourceOwner()
        var taps = 0
        var releases = 0
        XCTAssertThrowsError(try owner.start(acquire: {
            taps += 1
            throw StubFailure.taskStart
        }, release: { taps -= 1; releases += 1 }))
        XCTAssertEqual(taps, 0)
        XCTAssertEqual(releases, 1)
        try owner.start(acquire: { taps += 1 }, release: { taps -= 1; releases += 1 })
        XCTAssertEqual(taps, 1)
        XCTAssertThrowsError(try owner.start(acquire: { taps += 1 }, release: { taps -= 1 }))
        XCTAssertEqual(taps, 1)
        owner.stop()
        owner.stop()
        XCTAssertEqual(taps, 0)
        XCTAssertEqual(releases, 2)
    }
}
