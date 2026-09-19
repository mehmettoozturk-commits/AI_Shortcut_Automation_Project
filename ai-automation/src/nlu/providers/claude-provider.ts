/**
 * Phase 4B — gerçek LLM sağlayıcısı (Claude).
 *
 * ⚠️ EN ÖNEMLİ KURAL: Bu dosya hiçbir capability id'si İÇERMEZ ve
 * LLM'e prompt olarak da VERMEZ — yalnızca `buildSemanticCatalog()`'un
 * ürettiği semantik isimleri (`vehicle_departure`, `vehicle_sentry_mode`
 * gibi) gösterir. `tests/nlu-contract.test.ts`'teki "AI katmanı kaynak
 * dosyalarında capability id hardcode etmez" testi bu dosyayı da tarar.
 *
 * LLM çıktısı SERBEST METİN değil, `client.messages.parse` +
 * `output_config.format: zodOutputFormat(...)` ile YAPILANDIRILMIŞ JSON
 * olarak alınır ve `LlmPlanOutputSchema`'ya karşı doğrulanır (claude-api
 * skill, typescript/claude-api/tool-use.md → "Structured Outputs").
 * Şema/prompt/eşleme artık `llm-schema.ts`'te PAYLAŞILIYOR (Phase 4D-2 —
 * Gemini/Groq/NVIDIA sağlayıcıları da aynısını kullanıyor).
 *
 * Hata ayrımı (kullanıcının istediği gibi):
 *   - LLM ağ hatası / geçersiz JSON  → `LlmProviderError` fırlatılır
 *     (`NluPipeline.planAsync` bunu `status: "provider_error"`e çevirir).
 *   - Geçerli semantik plan ama registry'de karşılığı yok → bu sınıfın
 *     İŞİ DEĞİL; `buildPlan()` zaten `unsupported` üretiyor, değişmedi.
 *
 * API anahtarı asla hardcode edilmez; `.env` zaten `.gitignore`'da.
 * Anahtar çözümü: `LLM_API_KEY` (sağlayıcı-bağımsız, kullanıcı tercihi)
 * → yoksa SDK'nın kendi `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`/OAuth
 * çözümüne bırakılır (bkz. `resolveApiKey`).
 */

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { NluProvider, RepairHint } from "../ports.js";
import type { ConversationContext, IntentResult } from "../types.js";
import { LlmPlanOutputSchema, systemPrompt, toIntentResult, userPrompt } from "./llm-schema.js";
import { LlmProviderError } from "./errors.js";

export { LlmProviderError };

/** `client.messages.parse` çağrısının bu dosyanın ihtiyacı kadarı — testte sahte bir istemci enjekte edilebilsin diye. */
export interface ClaudeMessagesClient {
  messages: {
    parse(params: Record<string, unknown>): Promise<{ parsed_output: unknown }>;
  };
}

function resolveApiKey(): string | undefined {
  // Sağlayıcı-bağımsız isim (kullanıcı tercihi) önce; yoksa SDK'nın
  // kendi ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN/OAuth çözümüne bırakılır.
  return process.env.LLM_API_KEY ?? undefined;
}

export class ClaudeIntentProvider implements NluProvider {
  private client: ClaudeMessagesClient;
  private model: string;

  constructor(options: { client?: ClaudeMessagesClient; apiKey?: string; model?: string } = {}) {
    this.model = options.model ?? "claude-opus-5";
    this.client = options.client ?? (new Anthropic({ apiKey: options.apiKey ?? resolveApiKey() }) as unknown as ClaudeMessagesClient);
  }

  async plan(input: string, context?: ConversationContext, repair?: RepairHint): Promise<IntentResult> {
    let response: { parsed_output: unknown };
    try {
      response = await this.client.messages.parse({
        model: this.model,
        max_tokens: 4096,
        system: repair ? `${systemPrompt()}\n\n${repair.instruction}` : systemPrompt(),
        messages: [{ role: "user", content: userPrompt(input, context) }],
        output_config: { format: zodOutputFormat(LlmPlanOutputSchema) },
      });
    } catch (err) {
      // Ağ/istek hatası — Phase 4E-3: RETRY EDİLMEZ (bkz. errors.ts).
      throw new LlmProviderError("LLM isteği başarısız oldu.", err, false);
    }

    const parsed = response.parsed_output;
    if (parsed === null || parsed === undefined) {
      // Model içerik ÜRETTİ (istek başarılıydı) ama boş/şemasız —
      // Phase 4E-3: RETRY EDİLEBİLİR.
      throw new LlmProviderError("LLM geçerli/şemaya uygun bir JSON üretemedi.", undefined, true);
    }

    const validated = LlmPlanOutputSchema.safeParse(parsed);
    if (!validated.success) {
      throw new LlmProviderError("LLM çıktısı beklenen şemaya uymuyor.", validated.error, true);
    }

    return toIntentResult(validated.data, input);
  }
}
