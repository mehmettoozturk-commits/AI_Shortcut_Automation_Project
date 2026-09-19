/**
 * Phase 4D-2 — ücretsiz LLM sağlayıcısı (Google Gemini).
 *
 * ⚠️ EN ÖNEMLİ KURAL (Claude sağlayıcısıyla birebir aynı): bu dosya
 * hiçbir capability id'si İÇERMEZ; yalnızca `buildSemanticCatalog()`'un
 * ürettiği semantik isimleri gösterir. Şema/prompt/eşleme
 * `llm-schema.ts`'ten PAYLAŞILIR — bu dosya kendi şeklini icat ETMEZ.
 *
 * Gemini'nin yapılandırılmış çıktı mekanizması Anthropic'ten farklı:
 * `output_config.format` yerine `config.responseMimeType: "application/json"`
 * + `config.responseJsonSchema` (ham JSON Schema — Zod v4'ün
 * `toJSONSchema`'sı ile üretilir, bkz. llm-schema.ts). Yine de dönen
 * metin AYRICA `LlmPlanOutputSchema.safeParse` ile doğrulanır — SDK'nın
 * şema uyumunu garanti ettiğine körü körüne güvenilmez (Claude
 * sağlayıcısındaki "defense in depth" ile aynı disiplin).
 *
 * API anahtarı: `LLM_API_KEY` (sağlayıcı-bağımsız) → yoksa `GEMINI_API_KEY`.
 * Ücretsiz katman: aistudio.google.com üzerinden kartsız alınabilir.
 */

import { GoogleGenAI } from "@google/genai";
import type { NluProvider, RepairHint } from "../ports.js";
import type { ConversationContext, IntentResult } from "../types.js";
import { LlmPlanOutputJsonSchema, LlmPlanOutputSchema, systemPrompt, toIntentResult, userPrompt } from "./llm-schema.js";
import { LlmProviderError } from "./errors.js";

/** `ai.models.generateContent`'in bu dosyanın ihtiyacı kadarı — testte sahte bir istemci enjekte edilebilsin diye. */
export interface GeminiClient {
  models: {
    generateContent(params: Record<string, unknown>): Promise<{ text?: string }>;
  };
}

function resolveApiKey(): string | undefined {
  return process.env.LLM_API_KEY ?? process.env.GEMINI_API_KEY ?? undefined;
}

export class GeminiIntentProvider implements NluProvider {
  private client: GeminiClient;
  private model: string;

  constructor(options: { client?: GeminiClient; apiKey?: string; model?: string } = {}) {
    this.model = options.model ?? "gemini-flash-latest";
    this.client = options.client ?? (new GoogleGenAI({ apiKey: options.apiKey ?? resolveApiKey() }) as unknown as GeminiClient);
  }

  async plan(input: string, context?: ConversationContext, repair?: RepairHint): Promise<IntentResult> {
    let response: { text?: string };
    try {
      response = await this.client.models.generateContent({
        model: this.model,
        contents: userPrompt(input, context),
        config: {
          systemInstruction: repair ? `${systemPrompt()}\n\n${repair.instruction}` : systemPrompt(),
          responseMimeType: "application/json",
          responseJsonSchema: LlmPlanOutputJsonSchema,
        },
      });
    } catch (err) {
      // Ağ/istek hatası — Phase 4E-3: RETRY EDİLMEZ.
      throw new LlmProviderError("LLM isteği başarısız oldu.", err, false);
    }

    const text = response.text;
    if (!text) {
      // Model içerik ÜRETTİ ama boş — Phase 4E-3: RETRY EDİLEBİLİR.
      throw new LlmProviderError("LLM geçerli/şemaya uygun bir JSON üretemedi.", undefined, true);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new LlmProviderError("LLM çıktısı geçerli JSON değil.", err, true);
    }

    const validated = LlmPlanOutputSchema.safeParse(parsed);
    if (!validated.success) {
      throw new LlmProviderError("LLM çıktısı beklenen şemaya uymuyor.", validated.error, true);
    }

    return toIntentResult(validated.data, input);
  }
}
