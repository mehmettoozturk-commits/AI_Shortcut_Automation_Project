// Mock'lar — src/builder/mocks.ts'in Swift karşılığı.
//
// ⚠️ BUNLAR MOCK'TUR. Gerçek NLU, gerçek izin sistemi veya gerçek
// Shortcuts kurulumu yapmazlar. Phase 3B'de bu implementasyonların
// yerini gerçek Apple API çağıran türler alacak; port'lar (Ports.swift)
// değişmeyeceği için BuilderMachine ve olası SwiftUI View'lar dokunulmadan
// kalır.

import Foundation

public actor InMemoryAutomationRepository: AutomationRepository {
    private var items: [Automation]

    public init(seed: [Automation] = []) {
        self.items = seed
    }

    public func list() async -> [Automation] { items }

    /// Phase 3C-3: gerçek bir UPSERT — aynı `id` ile tekrar save()
    /// çağrısı kaydı GÜNCELLER, çoğaltmaz. `BuilderMachine` artık
    /// `create()`'te erken bir kayıt oluşturup aynı id'yi akış boyunca
    /// güncellediği için bu düzeltme zorunlu hale geldi.
    public func save(_ automation: Automation) async {
        if let idx = items.firstIndex(where: { $0.id == automation.id }) {
            items[idx] = automation
        } else {
            items.insert(automation, at: 0)
        }
    }

    public func setActive(_ id: String, active: Bool) async {
        items = items.map { a in
            guard a.id == id else { return a }
            var copy = a
            copy.status = active ? .active : .paused
            return copy
        }
    }
}

public actor MockPermissionService: PermissionService {
    private var granted: Set<String>
    private let autoGrant: Bool

    public init(granted: [String] = [], autoGrant: Bool = true) {
        self.granted = Set(granted)
        self.autoGrant = autoGrant
    }

    public func grantedPermissions() async -> [String] { Array(granted) }

    public func request(_ permission: String) async -> Bool {
        guard autoGrant else { return false }
        granted.insert(permission)
        return true
    }
}

public actor MockSetupService: SetupService {
    private let result: PrepareResult
    public init(succeeds: Bool = true) {
        self.result = succeeds
            ? .ready(handoffURL: URL(string: "https://example.com/mock-shortcut-template")!, suggestedName: "Mock Kestirme")
            : .noTemplateAvailable(reason: "Mock: kasıtlı başarısızlık")
    }
    public func prepare(_ plan: DraftAutomationPlan) async -> PrepareResult { result }
}

/// MOCK planner — gerçek Intent/Entity Extraction (Phase 2, TS
/// tarafında zaten var) burada PORTLANMADI. Phase 3B'de ya bu NLU
/// backend'e bir ağ çağrısıyla bağlanır ya da (daha olası) Builder
/// akışı TS tarafında kalıp Swift yalnızca native adaptörü üstlenir —
/// bu açık bir mimari karardır, bkz. docs/ios-bridge.md "Açık işler" #2.
public actor MockPlanner: Planner {
    private let registry: CapabilityRegistry

    public init(registry: CapabilityRegistry) {
        self.registry = registry
    }

    public func plan(text: String, existingDraft: DraftAutomationPlan?) async -> PlannerResult {
        let t = text.lowercased()
        guard t.contains("sentry") || t.contains("kamera") else { return .notUnderstood }

        let isSentry = t.contains("sentry")
        let actionSemantic = isSentry ? "vehicle_sentry_mode" : "vehicle_camera"
        guard let actionCap = registry.bySemantic(actionSemantic, kind: .action).first,
              let triggerCap = registry.bySemantic("vehicle_departure", kind: .trigger).first
        else { return .notUnderstood }

        let question = isSentry ? "Sentry Mode'u açmak ister misin?" : "Kamerayı açmak ister misin?"
        let steps: [WorkflowStepDTO] = [
            .askConfirmation(message: question),
            .conditional(condition: "answer == yes", then: [.action(type: actionCap.id, params: nil)], else: []),
        ]

        let hasVehicle = t.contains("model y") || t.contains("model 3")
        let missing: [MissingInfoField] = hasVehicle ? [] : [
            MissingInfoField(
                id: "vehicle", kind: .deviceOrPerson,
                question: "Hangi Tesla'yı kullanalım?",
                options: ["Model Y", "Model 3", "Model S", "Model X"]
            ),
        ]

        let draft = DraftAutomationPlan(
            name: trimTrailingDotPublic(actionCap.description),
            trigger: TriggerDTO(type: triggerCap.id, device: hasVehicle ? "Tesla Model Y" : nil),
            steps: steps,
            missing: missing
        )
        return .plan(draft)
    }
}

private func trimTrailingDotPublic(_ s: String) -> String {
    s.hasSuffix(".") ? String(s.dropLast()) : s
}
