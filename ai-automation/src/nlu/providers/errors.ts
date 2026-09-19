/**
 * Phase 4B — sağlayıcı hataları.
 *
 * `NluPipeline` (domain katmanı) somut bir LLM SDK'sına bağımlı OLMAMALI
 * (§13) — bu yüzden hata tipi, `claude-provider.ts`'ten değil, buradan
 * gelir. `ClaudeIntentProvider` bunu fırlatır; `NluPipeline.planAsync`
 * bunu yakalayıp `status: "provider_error"`e çevirir.
 */
export class LlmProviderError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "LlmProviderError";
  }
}
