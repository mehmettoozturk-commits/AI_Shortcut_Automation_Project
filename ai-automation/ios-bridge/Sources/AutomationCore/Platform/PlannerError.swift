// Phase 4C — `HTTPBackedPlanner`'ın domain-level hata durumları.
//
// `Planner` protokolü (Ports.swift) yalnızca `.plan`/`.notUnderstood`
// biliyor — bu, Phase 1'den beri değişmedi ve değişmeyecek (§7.2).
// Ama backend'in HTTP hata sözleşmesi (docs/api.md §8, Phase 4C eki)
// dört farklı durumu ayırt ediyor: istek hatası, doğrulama hatası,
// sağlayıcı (LLM) hatası, ve tamamen ulaşılamama. Bunları tek bir
// "Bir sorun oluştu" mesajına EZMEMEK için `HTTPBackedPlanner`, bu
// zengin tipi `lastError` üzerinden AYRICA raporlar — ileride gerçek
// bir SwiftUI katmanı bunu switch'leyip kullanıcıya doğru mesajı
// gösterebilir.
public enum PlannerError: Sendable, Equatable, Error {
    /// HTTP 400 — istek gövdesi/şeması geçersiz (istemci hatası).
    case invalidRequest(message: String)
    /// HTTP 422 — semantik olarak eksiksiz bir plan ama Schema/
    /// Capability/Permission/Safety zincirinden geçemedi.
    case validationFailed(issues: [String])
    /// HTTP 502 — LLM sağlayıcısı ağ/JSON hatasıyla başarısız oldu
    /// (bkz. src/nlu/types.ts "provider_error" — `not_understood` ile
    /// KARIŞTIRILMAZ, sağlayıcı hiç çalışamadı).
    case providerUnavailable(message: String)
    /// Ağ zaman aşımı, beklenmeyen bir HTTP durumu, ya da sunucuya hiç
    /// ulaşılamaması.
    case plannerUnreachable(message: String)
}
