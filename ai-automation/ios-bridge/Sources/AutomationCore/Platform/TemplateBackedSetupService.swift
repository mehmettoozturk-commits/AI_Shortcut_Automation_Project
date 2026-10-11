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
// Bu tek şablon sabit, tek eylemli bir kestirmedir. Plan başka bir eylem,
// parametre veya onay/koşul içeriyorsa onu temsil EDEMEZ; yalnızca ilk
// eylemin şablonunu seçip "hazır" demek MASTER_SPEC §18'i ihlal eder.

import Foundation

public struct TemplateBackedSetupService: SetupService {
    private let registry: CapabilityRegistry

    public init(registry: CapabilityRegistry) {
        self.registry = registry
    }

    public func prepare(_ plan: DraftAutomationPlan) async -> PrepareResult {
        // Registry'de şu an yalnızca tek, statik eylem şablonları var.
        // Ordered steps/confirmation branches/params şablona derlenmiyor;
        // bunları sessizce atıp kurulum hazırlamak yanlış başarı olur.
        guard plan.steps.count == 1,
              case .action(let primaryId, let params) = plan.steps[0],
              params == nil || params?.isEmpty == true
        else {
            return .noTemplateAvailable(
                reason: "Bu planın tüm adımlarını karşılayan doğrulanmış bir Kestirmeler şablonu henüz yok."
            )
        }
        guard let cap = registry.find(primaryId) else {
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
