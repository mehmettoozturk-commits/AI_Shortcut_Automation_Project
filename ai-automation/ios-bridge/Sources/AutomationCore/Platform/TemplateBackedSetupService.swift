// Gerçek SetupService — Phase 3C-2.
//
// Semantik plan → Capability Registry → şablon → Apple/iCloud şablonu →
// user-assisted import zinciri (bkz. docs/phase3b-validation-plan.md
// Test 1b). Bu tür AI'nin çalışma zamanında `.shortcut` binary ÜRETMESİNE
// ÇALIŞMAZ — Test 1 bunun kesin olarak reddedildiğini kanıtladı. Bunun
// yerine, planın birincil eylemi için registry'de ÖNCEDEN kayıtlı
// (Shortcuts'ta elle hazırlanmış, Apple/iCloud imzalı) bir şablon arar.
//
// ⚠️ İÇERİK BOŞLUĞU (kod eksikliği DEĞİL): Phase 5A İş 0.5 (2026-09-19)
// itibarıyla registry'deki 15 capability'den yalnızca `ios.notification.show`
// gerçek bir `template`'e sahip (gerçek bir iPhone'da Shortcuts'ta elle
// oluşturulup "iCloud Bağlantısını Kopyala" ile paylaşılmış tek eylemli
// bir kestirme — bkz. docs/phase5a-e2e-validation-plan.md "İş 0.5").
// Geri kalan 14 capability için bu servis HÂLÂ `.noTemplateAvailable`
// döner — bu DOĞRU ve DÜRÜST davranıştır: sahte bir "hazır" durumu
// üretmek MASTER_SPEC §18'i ihlal eder.

import Foundation

public struct TemplateBackedSetupService: SetupService {
    private let registry: CapabilityRegistry

    public init(registry: CapabilityRegistry) {
        self.registry = registry
    }

    public func prepare(_ plan: DraftAutomationPlan) async -> PrepareResult {
        let actionIds = flattenSteps(plan.steps).compactMap { step -> String? in
            switch step {
            case .action(let type, _): return type
            case .askConfirmation, .conditional: return nil
            }
        }

        guard let primaryId = actionIds.first, let cap = registry.find(primaryId) else {
            return .noTemplateAvailable(reason: "Bu eylem registry'de bulunamadı.")
        }

        guard let template = cap.template, let url = URL(string: template.iCloudURL) else {
            return .noTemplateAvailable(
                reason: "\"\(cap.description)\" için henüz hazırlanmış bir şablon yok."
            )
        }

        return .ready(handoffURL: url, suggestedName: template.suggestedName)
    }
}
