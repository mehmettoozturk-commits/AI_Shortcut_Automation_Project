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
    func makeRegistry() throws -> CapabilityRegistry {
        try CapabilityRegistry.loadFromBundle()
    }

    func makeViewModel(registry: CapabilityRegistry) -> BuilderViewModel {
        let machine = BuilderMachine(
            registry: registry,
            planner: MockPlanner(registry: registry),
            permissions: MockPermissionService(granted: ["bluetooth", "tesla_account"]),
            setup: MockSetupService(),
            shortcutsHandoff: MockShortcutsHandoff(),
            repository: InMemoryAutomationRepository(),
            device: DeviceContext(osVersion: 26, hasCarPlay: false)
        )
        return BuilderViewModel(machine: machine, registry: registry)
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
}
