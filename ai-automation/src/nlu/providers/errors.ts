/**
 * Phase 4B — sağlayıcı hataları.
 *
 * `NluPipeline` (domain katmanı) somut bir LLM SDK'sına bağımlı OLMAMALI
 * (§13) — bu yüzden hata tipi, `claude-provider.ts`'ten değil, buradan
 * gelir. Her LLM sağlayıcısı bunu fırlatır; `NluPipeline.planAsync`
 * bunu yakalayıp `status: "provider_error"`e çevirir (veya, Phase 4E-3:
 * `retryable` ise önce tek bir repair denemesi yapar).
 *
 * `retryable` — GÜVENLİ VARSAYILAN `false`'tur (ağ hatası/timeout/
 * beklenmeyen bir istisna gibi GERÇEK sistem hataları asla retry
 * edilmez). Yalnızca "model içerik ÜRETTİ ama içerik bozuk/boş/şemaya
 * uymuyor" türü, modelin BİR SONRAKİ denemede düzeltebileceği hatalar
 * `retryable: true` ile işaretlenir — her sağlayıcı bunu kendi throw
 * noktasında AÇIKÇA seçer.
 */
export class LlmProviderError extends Error {
  constructor(message: string, readonly cause?: unknown, readonly retryable: boolean = false) {
    super(message);
    this.name = "LlmProviderError";
  }
}
