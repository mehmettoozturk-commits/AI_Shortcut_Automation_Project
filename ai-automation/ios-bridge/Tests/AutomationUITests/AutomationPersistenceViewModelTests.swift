import XCTest
@testable import AutomationCore
@testable import AutomationUI

private actor UIStorageStub: AutomationRepository {
    private let base: InMemoryAutomationRepository
    private var writable = true
    private var state: AutomationStorageState = .ready
    init(seed: [Automation]) { base = InMemoryAutomationRepository(seed: seed) }
    func fail(_ state: AutomationStorageState = .ready) { writable = false; self.state = state }
    func list() async -> [Automation] { state == .ready ? await base.list() : [] }
    func storageState() async -> AutomationStorageState { state }
    func save(_ automation: Automation) async -> Bool { writable ? await base.save(automation) : false }
    func setActive(_ id: String, active: Bool) async -> Bool { writable ? await base.setActive(id, active: active) : false }
    func deleteLocalRecord(_ id: String) async -> Bool { writable ? await base.deleteLocalRecord(id) : false }
}

@MainActor
final class AutomationPersistenceViewModelTests: XCTestCase {
    private func record(_ status: InstallStatus) -> Automation {
        Automation(id: "original", userId: "local", name: "Test", platform: .ios, status: .active,
            trigger: TriggerDTO(type: "ios.bluetooth.disconnected", device: nil),
            workflow: [.action(type: "tesla.sentry_mode.toggle", params: nil)], version: 1,
            createdAt: Date(), updatedAt: Date(), requiresGuidedSetup: false, installStatus: status)
    }
    private func model(_ repo: UIStorageStub) throws -> BuilderViewModel {
        let registry = try CapabilityRegistry.loadFromBundle()
        let machine = BuilderMachine(registry: registry, planner: MockPlanner(registry: registry),
            permissions: MockPermissionService(granted: ["bluetooth", "tesla_account"]), setup: MockSetupService(),
            shortcutsHandoff: MockShortcutsHandoff(), repository: repo, device: DeviceContext(osVersion: 26, hasCarPlay: false))
        return BuilderViewModel(machine: machine, registry: registry, repository: repo)
    }

    func testLifecycleWriteFailureKeepsVisibleRecordAndShowsError() async throws {
        let original = record(.pendingUser)
        let repo = UIStorageStub(seed: [original])
        let vm = try model(repo)
        vm.showAutomation(original)
        await repo.fail()
        await vm.toggleLocalPause()
        XCTAssertEqual(vm.selectedAutomation?.status, .active)
        XCTAssertNotNil(vm.lifecycleMessage)
        await vm.deleteSelectedLocalRecord()
        XCTAssertEqual(vm.selectedAutomation?.id, original.id)
        XCTAssertNotNil(vm.lifecycleMessage)
    }

    func testCorruptResumeDoesNotDismissDetailOrAdvance() async throws {
        let original = record(.pendingUser)
        let repo = UIStorageStub(seed: [original])
        let vm = try model(repo)
        vm.showAutomation(original)
        await repo.fail(.corrupt)
        await vm.resumeSelectedAutomation()
        XCTAssertEqual(vm.selectedAutomation?.id, original.id)
        XCTAssertNotNil(vm.persistenceMessage)
        guard case .idle = vm.step else { return XCTFail("corrupt checkpoint must not advance") }
    }

    func testRevisionSaveFailureDoesNotAlterOriginalOrShowSuccess() async throws {
        let original = record(.installed)
        let repo = UIStorageStub(seed: [original])
        let vm = try model(repo)
        vm.showAutomation(original)
        await vm.editSelectedAsNewSetup()
        vm.updateText("Arabadan inince Tesla Model Y Sentry Mode'u aç")
        await vm.submit()
        await vm.confirmUnderstanding()
        await repo.fail()
        await vm.createAutomation()
        guard case .previewConfirm = vm.step else { return XCTFail("failed revision cannot show success") }
        XCTAssertNotNil(vm.persistenceMessage)
        let items = await repo.list()
        XCTAssertEqual(items.count, 1)
        XCTAssertEqual(items.first?.installStatus, .installed)
    }
}
