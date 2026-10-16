// Phase 4D-1 — gerçek SwiftUI uygulama kabuğu.
// Phase 5A İş 0 (2026-09-19) — üç mock, gerçek implementasyonlarla
// değiştirildi: `TemplateBackedSetupService`, `UIKitShortcutsHandoff`,
// `FileBackedAutomationRepository`. Hiçbiri burada YENİDEN yazılmadı —
// Phase 3C'de zaten yazılmış, test edilmiş implementasyonlar dependency
// graph'a bağlandı (bkz. docs/phase5a-e2e-validation-plan.md "İş 0").
//
// P0-1: uygulamanın kendi OS runtime izni, Kestirmeler/Tesla kurulum
// gereksiniminden ayrıldı. Bu sürümde uygulama kendi başına Bluetooth,
// bildirim veya konum API'si kullanmadığından OS izni talep etmez;
// gelecekte böyle bir API eklenirse fail-closed servis gerçek adapter'la
// değiştirilmeden çalışma izni vermeyecektir.

import AutomationCore
import AutomationUI
import SwiftUI

@main
struct AutomationApp: App {
    var body: some Scene {
        WindowGroup {
            if let viewModel = Self.makeViewModel() {
                AutomationRootView(viewModel: viewModel)
            } else {
                VStack(spacing: 12) {
                    Text("Sunucu yapılandırması geçersiz").font(.headline)
                    Text("Uygulama güvenli sunucu adresini doğrulayamadığı için planlama başlatılamıyor.")
                        .multilineTextAlignment(.center)
                }
                .padding()
            }
        }
    }

    /// Backend adresi `PLAN_BACKEND_URL` ortam değişkeninden okunur
    /// (UI testlerinin ephemeral bir porta işaret edebilmesi için);
    /// yoksa `npm run serve`in varsayılanı (`localhost:3000`) kullanılır.
    /// iOS Simulator, host Mac'in loopback'ini paylaştığı için bu
    /// `localhost` gerçek bir backend'e doğrudan ulaşabilir.
    private static func makeViewModel() -> BuilderViewModel? {
        #if DEBUG
        let isDebug = true
        #else
        let isDebug = false
        #endif
        let buildURL = Bundle.main.object(forInfoDictionaryKey: "PlanBackendURL") as? String
        let debugOverride = ProcessInfo.processInfo.environment["PLAN_BACKEND_URL"]
        guard let backendURL = BackendURLConfiguration.resolve(buildValue: buildURL, debugOverride: debugOverride, isDebug: isDebug) else {
            return nil
        }
        let registry = try! CapabilityRegistry.loadFromBundle()
        let sessions = KeychainSessionStore(service: "com.aishortcut.AutomationApp.session")
        let authURLString = ProcessInfo.processInfo.environment["AUTH_BACKEND_URL"]
            ?? Bundle.main.object(forInfoDictionaryKey: "AuthBackendURL") as? String
        let authOrigin = authURLString.flatMap(URL.init(string:))
        let transport = URLSessionPlanTransport(url: backendURL, credentials: sessions, credentialOrigin: authOrigin)

        let permissions = NoAppRuntimePermissionService()
        let planner = HTTPBackedPlanner(transport: transport, permissions: permissions)
        let repository = FileBackedAutomationRepository(directory: applicationSupportDirectory())
        let activityStore = FileBackedAutomationActivityStore(directory: applicationSupportDirectory())
        // A durable Info.plist value works after an ordinary icon relaunch;
        // the environment override is for Xcode development runs only.
        let authBackend = authOrigin.flatMap {
            try? URLSessionAccountAuthBackend(baseURL: $0)
        }
        let accountAuthorizer: any AccountAuthorizer
        if let authBackend {
            accountAuthorizer = AppleAccountAuthorizer(
                credentials: NativeAppleCredentialProvider(),
                backend: authBackend,
                sessions: sessions
            )
        } else {
            accountAuthorizer = UnavailableAccountAuthorizer()
        }
        let accountService = AccountService(
            authorizer: accountAuthorizer,
            store: FileBackedAccountStateStore(directory: applicationSupportDirectory())
        )

        let machine = BuilderMachine(
            registry: registry,
            planner: planner,
            permissions: permissions,
            setup: TemplateBackedSetupService(registry: registry),
            shortcutsHandoff: UIKitShortcutsHandoff(),
            repository: repository,
            activityStore: activityStore,
            // App'ın kendi CarPlay sahnesi olmaması, kullanıcının araçta
            // CarPlay kullanmadığını kanıtlamaz. Bilinmiyor olarak bırak;
            // resolver doğrulanmamış CarPlay yerine Bluetooth'u sunar.
            device: DeviceContext(
                osVersion: ProcessInfo.processInfo.operatingSystemVersion.majorVersion,
                hasCarPlay: nil
            )
        )
        return BuilderViewModel(
            machine: machine,
            registry: registry,
            repository: repository,
            accountService: accountService,
            accountLinkAvailable: authBackend != nil,
            activityStore: activityStore
        )
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
