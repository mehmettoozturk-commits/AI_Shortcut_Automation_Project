// Phase 4D-1 — gerçek SwiftUI uygulama kabuğu.
// Phase 5A İş 0 (2026-09-19) — üç mock, gerçek implementasyonlarla
// değiştirildi: `TemplateBackedSetupService`, `UIKitShortcutsHandoff`,
// `FileBackedAutomationRepository`. Hiçbiri burada YENİDEN yazılmadı —
// Phase 3C'de zaten yazılmış, test edilmiş implementasyonlar dependency
// graph'a bağlandı (bkz. docs/phase5a-e2e-validation-plan.md "İş 0").
//
// Kalan tek mock: `MockPermissionService` — gerçek bir izin isteme UI'ı
// henüz yok, bu Phase 5A'nın kasıtlı sınırı dışında (ayrı bir round'un
// konusu, bkz. altta).

import AutomationCore
import AutomationUI
import SwiftUI

@main
struct AutomationApp: App {
    var body: some Scene {
        WindowGroup {
            AutomationRootView(viewModel: Self.makeViewModel())
        }
    }

    /// Backend adresi `PLAN_BACKEND_URL` ortam değişkeninden okunur
    /// (UI testlerinin ephemeral bir porta işaret edebilmesi için);
    /// yoksa `npm run serve`in varsayılanı (`localhost:3000`) kullanılır.
    /// iOS Simulator, host Mac'in loopback'ini paylaştığı için bu
    /// `localhost` gerçek bir backend'e doğrudan ulaşabilir.
    private static func makeViewModel() -> BuilderViewModel {
        let registry = try! CapabilityRegistry.loadFromBundle()
        let backendURLString = ProcessInfo.processInfo.environment["PLAN_BACKEND_URL"] ?? "http://localhost:3000/plan"
        let transport = URLSessionPlanTransport(url: URL(string: backendURLString)!)

        // Phase 4D-1: gerçek bir izin isteme UI'ı henüz yok — Permission
        // Validator'ın (backend, HTTP 422) önizlemeyi engellememesi için
        // geniş bir izin kümesiyle başlıyoruz. Bu, kasıtlı bir GEÇİCİ
        // yer tutucu; gerçek izin akışı sonraki bir round'un konusu.
        let permissions = MockPermissionService(
            granted: ["bluetooth", "tesla_account", "notifications", "location_always"]
        )
        let planner = HTTPBackedPlanner(transport: transport, permissions: permissions)
        let repository = FileBackedAutomationRepository(directory: applicationSupportDirectory())

        let machine = BuilderMachine(
            registry: registry,
            planner: planner,
            permissions: permissions,
            setup: TemplateBackedSetupService(registry: registry),
            shortcutsHandoff: UIKitShortcutsHandoff(),
            repository: repository,
            device: DeviceContext(osVersion: 26, hasCarPlay: false)
        )
        return BuilderViewModel(machine: machine, registry: registry, repository: repository)
    }

    /// `~/Library/Application Support/<bundleId>/automations.json` —
    /// `FileBackedAutomationRepository`'nin kendi doc yorumunda önerdiği
    /// konum (bkz. Platform/FileBackedAutomationRepository.swift).
    private static func applicationSupportDirectory() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let bundleId = Bundle.main.bundleIdentifier ?? "com.aiautomation.app"
        return base.appendingPathComponent(bundleId, isDirectory: true)
    }
}
