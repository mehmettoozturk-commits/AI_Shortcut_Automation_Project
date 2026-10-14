// Phase 4E-2 — `BuilderViewModel`'in `displayDescription` çevirisi.
//
// KRİTİK KURAL: `triggerSummary`/`actionSummaries`, kullanıcıya SwiftUI'da
// gösterilen TEK metin kaynağı — bu testler üç şeyi kanıtlar:
//   1. Sonuç GERÇEKTEN `displayDescription`'dır (`description` DEĞİL).
//   2. Capability id (nokta içeren "ios."/"tesla." gibi) HİÇ görünmez.
//   3. Teknik/resmi `description` metni HİÇ görünmez.

import XCTest
@testable import AutomationCore
@testable import AutomationUI

@MainActor
final class BuilderViewModelTests: XCTestCase {
    func testUnknownHistoryTriggerDoesNotExposeRawID() throws {
        let viewModel = makeViewModel(registry: try makeRegistry())
        let summary = viewModel.triggerSummary(for: DraftAutomationPlan(name: "", trigger: TriggerDTO(type: "private.unknown.trigger", device: nil), steps: []))
        XCTAssertEqual(summary, "Bir tetikleyici")
        XCTAssertFalse(summary.contains("private.unknown.trigger"))
    }
    func makeRegistry() throws -> CapabilityRegistry {
        try CapabilityRegistry.loadFromBundle()
    }

    func makeViewModel(registry: CapabilityRegistry) -> BuilderViewModel {
        let repository = InMemoryAutomationRepository()
        let machine = BuilderMachine(
            registry: registry,
            planner: MockPlanner(registry: registry),
            permissions: MockPermissionService(granted: ["bluetooth", "tesla_account"]),
            setup: MockSetupService(),
            shortcutsHandoff: MockShortcutsHandoff(),
            repository: repository,
            device: DeviceContext(osVersion: 26, hasCarPlay: false)
        )
        return BuilderViewModel(machine: machine, registry: registry, repository: repository)
    }

    func testTriggerSummary_usesDisplayDescription_notDescription_notCapabilityId() throws {
        let registry = try makeRegistry()
        let viewModel = makeViewModel(registry: registry)
        let bluetooth = registry.find("ios.bluetooth.disconnected")!

        let draft = DraftAutomationPlan(
            name: "test",
            trigger: TriggerDTO(type: bluetooth.id, device: nil),
            steps: [.action(type: "tesla.sentry_mode.toggle", params: nil)]
        )

        let summary = viewModel.triggerSummary(for: draft)

        XCTAssertEqual(summary, bluetooth.displayDescription)
        XCTAssertFalse(summary.contains(bluetooth.id), "Özet capability id içeriyor: \(summary)")
        XCTAssertNotEqual(summary, bluetooth.description.hasSuffix(".") ? String(bluetooth.description.dropLast()) : bluetooth.description)
        XCTAssertFalse(summary.contains("tetiklenir"), "Özet, description'ın resmi/mekanizma dilini içeriyor: \(summary)")
    }

    func testActionSummaries_useDisplayDescription_forEachRealAction() throws {
        let registry = try makeRegistry()
        let viewModel = makeViewModel(registry: registry)
        let sentry = registry.find("tesla.sentry_mode.toggle")!

        let draft = DraftAutomationPlan(
            name: "test",
            trigger: TriggerDTO(type: "ios.bluetooth.disconnected", device: "Tesla Model Y"),
            steps: [
                .askConfirmation(message: "Yapmak ister misin?"),
                .conditional(condition: "answer == yes", then: [.action(type: sentry.id, params: nil)], else: []),
            ]
        )

        let summaries = viewModel.actionSummaries(for: draft)

        XCTAssertEqual(summaries, [sentry.displayDescription])
        for summary in summaries {
            XCTAssertFalse(summary.contains(sentry.id), "Özet capability id içeriyor: \(summary)")
            XCTAssertFalse(summary.contains("."), "Özet, capability id'ye benzeyen bir nokta içeriyor: \(summary)")
        }
    }

    /// Registry çapında: hiçbir `displayDescription`, kendi capability
    /// id'sini içermiyor (Phase 4E-2 sözleşmesi, TS tarafındaki
    /// `checkRegistryContract` ile aynı invariant — Swift tarafında da
    /// gerçek, decode edilmiş veri üzerinden ayrıca kilitlenir).
    func testNoCapabilityLeaksIntoAnyDisplayDescription() throws {
        let registry = try makeRegistry()
        for cap in registry.capabilities {
            XCTAssertFalse(cap.displayDescription.isEmpty, "\(cap.id): displayDescription boş")
            XCTAssertFalse(cap.displayDescription.contains(cap.id), "\(cap.id): displayDescription capability id içeriyor")
        }
    }

    /// Phase 5A İş 0 — `BuilderMachineTests.testFullInstallFlow_setupToInstalled`'ın
    /// AYNI zincirini, artık `BuilderViewModel`'in yeni geçiş metotları
    /// (createAutomation/prepareHandoff/handOffToShortcuts/
    /// confirmShortcutAdded/confirmTriggerLinked) ÜZERİNDEN sürer. Asıl
    /// kanıtlanan şey: `automations`/`refreshAutomations()` GERÇEKTEN
    /// `machine`'in yazdığı AYNI repository örneğinden okuyor — ikinci,
    /// senkron olmayan bir kopya DEĞİL (bkz. docs/phase5a-e2e-validation-plan.md
    /// Test 3'ün "tek kaynak" gereksinimi).
    func testViewModel_fullInstallFlow_automationsListReflectsSharedRepository() async throws {
        let registry = try makeRegistry()
        let repository = InMemoryAutomationRepository()
        let machine = BuilderMachine(
            registry: registry,
            planner: MockPlanner(registry: registry),
            permissions: MockPermissionService(granted: ["bluetooth", "tesla_account"]),
            setup: MockSetupService(),
            shortcutsHandoff: MockShortcutsHandoff(),
            repository: repository,
            device: DeviceContext(osVersion: 26, hasCarPlay: false)
        )
        let viewModel = BuilderViewModel(machine: machine, registry: registry, repository: repository)

        await viewModel.refreshAutomations()
        XCTAssertTrue(viewModel.automations.isEmpty, "başlangıçta hiçbir kayıt olmamalı")

        await viewModel.start()
        viewModel.updateText("Arabadan inince Tesla Model Y Sentry Mode'u aç")
        await viewModel.submit()
        await viewModel.confirmUnderstanding()
        await viewModel.createAutomation()
        await viewModel.prepareHandoff()
        await viewModel.handOffToShortcuts()
        await viewModel.confirmShortcutAdded()
        await viewModel.confirmTriggerLinked()

        guard case .installed(let automation) = viewModel.step else {
            return XCTFail("installed bekleniyordu, gerçek: \(viewModel.step)")
        }

        await viewModel.refreshAutomations()
        XCTAssertEqual(viewModel.automations.count, 1)
        XCTAssertEqual(viewModel.automations.first?.id, automation.id)
        XCTAssertEqual(viewModel.automations.first?.installStatus, .installed)

        viewModel.showSuccess()
        guard case .success = viewModel.step else { return XCTFail("success bekleniyordu") }
        await viewModel.close()
        guard case .idle = viewModel.step else { return XCTFail("idle bekleniyordu") }

        // Otomasyonlarım listesi, akıştan çıkıldıktan SONRA da kalıcı —
        // `close()` kaydı SİLMEZ (bkz. BuilderMachine.close() yorumu).
        await viewModel.refreshAutomations()
        XCTAssertEqual(viewModel.automations.count, 1)
    }

    func testUserTestLogDistinguishesRequestAndReportAndDoesNotInventSuccessOnCancel() async throws {
        let registry = try makeRegistry()
        let repository = InMemoryAutomationRepository()
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let activityStore = FileBackedAutomationActivityStore(directory: directory)
        let machine = BuilderMachine(
            registry: registry,
            planner: MockPlanner(registry: registry),
            permissions: MockPermissionService(granted: []),
            setup: MockSetupService(),
            shortcutsHandoff: MockShortcutsHandoff(),
            repository: repository,
            activityStore: activityStore,
            device: DeviceContext(osVersion: 26, hasCarPlay: false)
        )
        let viewModel = BuilderViewModel(
            machine: machine, registry: registry, repository: repository, activityStore: activityStore
        )
        let automation = Automation(
            id: "revision-2", userId: "local", name: "Test", platform: .ios,
            status: .active, trigger: TriggerDTO(type: "ios.battery.level_below", device: nil),
            workflow: [.action(type: "ios.notification.show", params: nil)], version: 2,
            createdAt: Date(), updatedAt: Date(), requiresGuidedSetup: false,
            installStatus: .installed, sourceAutomationId: "root-1"
        )
        await repository.save(automation)
        viewModel.showAutomation(automation)

        await viewModel.beginUserTest()
        await viewModel.beginUserTest() // a repeated tap must not create another request
        viewModel.cancelUserTest()
        var events = await activityStore.list()
        XCTAssertEqual(events.count, 1)
        XCTAssertEqual(events.first?.eventType, .testRequested)
        XCTAssertEqual(events.first?.source, .appObserved)

        await viewModel.beginUserTest()
        await viewModel.reportUserTest(worked: true)
        await viewModel.reportUserTest(worked: true) // duplicate report ignored
        events = await FileBackedAutomationActivityStore(directory: directory).list()
        XCTAssertEqual(events.count, 3)
        XCTAssertEqual(events.filter { $0.eventType == .testUserPassed }.count, 1)
        XCTAssertEqual(events.filter { $0.eventType == .testUserFailed }.count, 0)
        XCTAssertTrue(events.allSatisfy { $0.automationId == "root-1" && $0.revisionId == "revision-2" })
        XCTAssertEqual(events.first?.source, .userReported)
    }
}
