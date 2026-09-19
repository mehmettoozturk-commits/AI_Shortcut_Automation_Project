// Phase 4D-1 — gerçek SwiftUI uygulama kabuğu.
//
// Bu dosya yalnızca ÜÇ şeyi bir araya getirir: gerçek `HTTPBackedPlanner`
// (Phase 4C), gerçek registry, ve `BuilderMachine`'in geri kalan
// port'ları için hâlâ mock'lar (Setup/ShortcutsHandoff/Repository) —
// bu fazın kasıtlı sınırı Shortcuts kurulumunu bağlamamak (bkz.
// docs/ios-bridge.md Phase 4D-1 bölümü).

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

        let machine = BuilderMachine(
            registry: registry,
            planner: planner,
            permissions: permissions,
            setup: MockSetupService(),
            shortcutsHandoff: MockShortcutsHandoff(),
            repository: InMemoryAutomationRepository(),
            device: DeviceContext(osVersion: 26, hasCarPlay: false)
        )
        return BuilderViewModel(machine: machine, registry: registry)
    }
}
