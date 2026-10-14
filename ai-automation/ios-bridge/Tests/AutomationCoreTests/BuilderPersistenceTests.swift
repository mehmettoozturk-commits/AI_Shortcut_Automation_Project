import XCTest
@testable import AutomationCore

private actor ControlledAutomationRepository: AutomationRepository {
    private let base = InMemoryAutomationRepository()
    private var writable = true
    func allowWrites(_ value: Bool) { writable = value }
    func list() async -> [Automation] { await base.list() }
    func storageState() async -> AutomationStorageState { .ready }
    func save(_ automation: Automation) async -> Bool {
        guard writable else { return false }
        return await base.save(automation)
    }
    func setActive(_ id: String, active: Bool) async -> Bool {
        guard writable else { return false }
        return await base.setActive(id, active: active)
    }
    func deleteLocalRecord(_ id: String) async -> Bool {
        guard writable else { return false }
        return await base.deleteLocalRecord(id)
    }
}

@MainActor
final class BuilderPersistenceTests: XCTestCase {
    func testGuidedConfirmationWriteFailureDoesNotClaimInstalled() async throws {
        var capabilities = try CapabilityRegistry.loadFromBundle().capabilities
        let index = try XCTUnwrap(capabilities.firstIndex { $0.id == "tesla.sentry_mode.toggle" })
        capabilities[index].installMethod = .guidedManual
        let registry = try CapabilityRegistry(capabilities: capabilities)
        let repo = ControlledAutomationRepository()
        let machine = BuilderMachine(registry: registry, planner: MockPlanner(registry: registry),
            permissions: MockPermissionService(granted: ["bluetooth", "tesla_account"]),
            setup: MockSetupService(), shortcutsHandoff: MockShortcutsHandoff(), repository: repo,
            device: DeviceContext(osVersion: 26, hasCarPlay: false))
        await machine.open()
        machine.setText("Arabadan inince Tesla Model Y Sentry Mode'u aç")
        await machine.submit()
        await machine.confirmUnderstanding()
        await machine.create()
        await repo.allowWrites(false)
        await machine.confirmGuidedSetupDone()
        guard case .setup = machine.step else { return XCTFail("failed guided save must stay in setup") }
        let items = await repo.list()
        XCTAssertEqual(items.first?.installStatus, .pendingUser)
        XCTAssertNotNil(machine.persistenceMessage)
    }

    func testFailedCreateAndCheckpointsStayPutAndRetrySameRecord() async throws {
        let registry = try CapabilityRegistry.loadFromBundle()
        let repo = ControlledAutomationRepository()
        let handoff = MockShortcutsHandoff()
        let activity = FileBackedAutomationActivityStore(directory: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString))
        let machine = BuilderMachine(registry: registry, planner: MockPlanner(registry: registry),
            permissions: MockPermissionService(granted: ["bluetooth", "tesla_account"]),
            setup: MockSetupService(), shortcutsHandoff: handoff, repository: repo,
            activityStore: activity, device: DeviceContext(osVersion: 26, hasCarPlay: false))
        await machine.open()
        machine.setText("Arabadan inince Tesla Model Y Sentry Mode'u aç")
        await machine.submit()
        await machine.confirmUnderstanding()
        await repo.allowWrites(false)
        await machine.create()
        guard case .previewConfirm = machine.step else { return XCTFail("failed create must stay in preview") }
        XCTAssertNotNil(machine.persistenceMessage)
        await repo.allowWrites(true)
        await machine.create()
        let id = await repo.list().first?.id
        await repo.allowWrites(false)
        await machine.prepareHandoff()
        guard case .setup = machine.step else { return XCTFail("failed checkpoint must stay in setup") }
        await repo.allowWrites(true)
        await machine.prepareHandoff()
        await repo.allowWrites(false)
        await machine.handOffToShortcuts()
        guard case .userAssistedImport = machine.step else { return XCTFail("handoff must not advance") }
        await repo.allowWrites(true)
        await machine.handOffToShortcuts()
        await repo.allowWrites(false)
        await machine.confirmShortcutAdded()
        guard case .waitingForUser = machine.step else { return XCTFail("failed added checkpoint must stay put") }
        await repo.allowWrites(true)
        await machine.confirmShortcutAdded()
        await repo.allowWrites(false)
        await machine.confirmTriggerLinked()
        guard case .linkingTrigger = machine.step else { return XCTFail("failed installed save must never show success") }
        let pending = await repo.list()
        XCTAssertEqual(pending.first?.installStatus, .pendingUser)
        await repo.allowWrites(true)
        await machine.confirmTriggerLinked()
        guard case .installed = machine.step else { return XCTFail("explicit retry should succeed") }
        let items = await repo.list()
        XCTAssertEqual(items.count, 1)
        XCTAssertEqual(items.first?.id, id)
        XCTAssertNil(machine.persistenceMessage)
        let opened = await handoff.openedURLs
        XCTAssertEqual(opened.count, 1, "failed checkpoint retry must not open twice")
        let events = await activity.list()
        XCTAssertEqual(events.filter { $0.eventType == .automationCreated }.count, 1)
        XCTAssertEqual(events.filter { $0.eventType == .setupUserConfirmed }.count, 1)
        XCTAssertEqual(events.filter { $0.eventType == .setupHandoffOpened }.count, 1)

        let original = try XCTUnwrap(items.first)
        let revisionOpened = await machine.openRevision(of: original.id)
        XCTAssertTrue(revisionOpened)
        machine.setText("Arabadan inince Tesla Model Y Sentry Mode'u aç")
        await machine.submit()
        await machine.confirmUnderstanding()
        await repo.allowWrites(false)
        await machine.create()
        guard case .previewConfirm = machine.step else { return XCTFail("failed revision save must stay in preview") }
        let unchanged = await repo.list()
        XCTAssertEqual(unchanged.count, 1)
        XCTAssertEqual(unchanged.first?.id, original.id)
        XCTAssertEqual(unchanged.first?.installStatus, .installed)
        let paused = await repo.setActive(original.id, active: false)
        let deleted = await repo.deleteLocalRecord(original.id)
        XCTAssertFalse(paused)
        XCTAssertFalse(deleted)
        let retained = await repo.list()
        XCTAssertEqual(retained.first?.status, .active)
    }
}
