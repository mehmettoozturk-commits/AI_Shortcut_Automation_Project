import XCTest
@testable import AutomationCore

final class AutomationActivityStoreTests: XCTestCase {
    func testPersistsProvenanceAndRevisionWithoutTouchingAutomationFile() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let automationFile = directory.appendingPathComponent("automations.json")
        let legacyData = Data("legacy-data".utf8)
        try legacyData.write(to: automationFile)

        let event = AutomationActivity(
            eventId: "event-1", automationId: "root-1", revisionId: "revision-2",
            eventType: .testUserPassed, source: .userReported,
            timestamp: Date(timeIntervalSince1970: 1_700_000_000)
        )
        let store = FileBackedAutomationActivityStore(directory: directory)
        let firstAppend = await store.append(event)
        let repeatedAppend = await store.append(event)
        XCTAssertTrue(firstAppend)
        XCTAssertTrue(repeatedAppend)

        let reopened = FileBackedAutomationActivityStore(directory: directory)
        let events = await reopened.list()
        XCTAssertEqual(events, [event])
        XCTAssertEqual(try Data(contentsOf: automationFile), legacyData)
    }

    func testMissingFileStartsEmpty() async {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let store = FileBackedAutomationActivityStore(directory: directory)
        let events = await store.list()
        XCTAssertTrue(events.isEmpty)
    }

    func testCorruptActivityFileIsNotOverwritten() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let fileURL = directory.appendingPathComponent("activity.json")
        let original = Data("broken-json".utf8)
        try original.write(to: fileURL)
        let store = FileBackedAutomationActivityStore(directory: directory)
        let accepted = await store.append(AutomationActivity(
            eventId: "e", automationId: "a", revisionId: "a",
            eventType: .testRequested, source: .appObserved, timestamp: Date()
        ))
        XCTAssertFalse(accepted)
        XCTAssertEqual(try Data(contentsOf: fileURL), original)
    }
}
