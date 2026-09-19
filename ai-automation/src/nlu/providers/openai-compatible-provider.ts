/**
 * Phase 4D-2 — OpenAI-uyumlu (chat/completions) uç noktalara karşı
 * GENEL sağlayıcı. Groq ve NVIDIA NIM'in ikisi de aynı OpenAI-uyumlu
 * API şeklini (`/v1/chat/completions`) sunuyor — bu yüzden TEK bir
 * implementasyon, yalnızca `baseURL`/`model` farklılaştırılarak ikisine
 * de hizmet eder (bkz. groq-provider.ts, nvidia-provider.ts).
 *
 * ⚠️ EN ÖNEMLİ KURAL (diğer tüm sağlayıcılarla birebir aynı): bu dosya
 * hiçbir capability id'si İÇERMEZ. Şema/prompt/eşleme `llm-schema.ts`'ten
 * PAYLAŞILIR.
 *
 * Not: bu uç noktaların hepsi Anthropic/Gemini'deki kadar SIKI bir şema
 * zorlaması (`json_schema` modu) garanti etmiyor — bu yüzden yalnızca
 * genel `response_format: {type: "json_object"}` ("JSON üret" modu)
 * istenir; asıl doğruluk garantisi, HER sağlayıcıda olduğu gibi, dönen
 * metnin `LlmPlanOutputSchema.safeParse` ile AYRICA doğrulanmasından
 * gelir (defense in depth) — bir model şemaya uymazsa bu bir
 * `LlmProviderError` olarak dürüstçe raporlanır, uydurulmaz.
 */

import OpenAI from "openai";
import type { NluProvider, RepairHint } from "../ports.js";
import type { ConversationContext, IntentResult } from "../types.js";
import { LlmPlanOutputJsonSchema, LlmPlanOutputSchema, systemPrompt, toIntentResult, userPrompt } from "./llm-schema.js";
import { LlmProviderError } from "./errors.js";

/**
 * Phase 4D-2 — gerçek NVIDIA NIM smoke testinde keşfedildi: Claude/Gemini'nin
 * aksine, bu uç noktalar `response_format: json_schema` modunu TAM
 * desteklemiyor (bazı modeller şemadaki `propertyNames` gibi anahtarları
 * reddediyor) ve salt `{type: "json_object"}` şeklin NE olacağını
 * GARANTİ ETMEZ — model, alan adlarını kendi başına "tahmin etmeye"
 * çalışıp (bazı "reasoning" modelleri tüm token bütçesini bu tahmine
 * harcayıp asıl içeriği hiç üretemeyebiliyor). Bu yüzden JSON Schema'nın
 * kendisi promptun İÇİNE, okunabilir biçimde gömülüyor — API seviyesinde
 * zorlanmasa da model artık alan adlarını TAHMİN ETMEK zorunda kalmıyor.
 * Nihai doğruluk garantisi yine `LlmPlanOutputSchema.safeParse`'tan gelir.
 */
function schemaInstruction(): string {
  return [
    "Yanıtın YALNIZCA aşağıdaki JSON Schema'ya uyan, geçerli bir JSON nesnesi olmalı —",
    "başka hiçbir metin, açıklama, markdown veya kod bloğu işareti EKLEME:",
    "",
    JSON.stringify(LlmPlanOutputJsonSchema),
  ].join("\n");
}

/** `client.chat.completions.create`'in bu dosyanın ihtiyacı kadarı — testte sahte bir istemci enjekte edilebilsin diye. */
export interface OpenAICompatibleChatClient {
  chat: {
    completions: {
      create(params: Record<string, unknown>): Promise<{ choices: Array<{ message: { content?: string | null } }> }>;
    };
  };
}

export interface OpenAICompatibleProviderOptions {
  client?: OpenAICompatibleChatClient;
  apiKey?: string;
  baseURL: string;
  model: string;
  /** Hata mesajlarında hangi sağlayıcının başarısız olduğunu ayırt etmek için (örn. "Groq", "NVIDIA NIM"). */
  providerLabel: string;
}

export class OpenAICompatibleIntentProvider implements NluProvider {
  private client: OpenAICompatibleChatClient;
  private model: string;
  private providerLabel: string;

  constructor(options: OpenAICompatibleProviderOptions) {
    this.model = options.model;
    this.providerLabel = options.providerLabel;
    this.client =
      options.client ?? (new OpenAI({ apiKey: options.apiKey, baseURL: options.baseURL }) as unknown as OpenAICompatibleChatClient);
  }

  async plan(input: string, context?: ConversationContext, repair?: RepairHint): Promise<IntentResult> {
    let response: { choices: Array<{ message: { content?: string | null } }> };
    let system = `${systemPrompt()}\n\n${schemaInstruction()}`;
    if (repair) system = `${system}\n\n${repair.instruction}`;
    try {
      response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userPrompt(input, context) },
        ],
        response_format: { type: "json_object" },
        // Bazı hesap/model kombinasyonları "reasoning" içerikli, verbose
        // modeller (bkz. yorum yukarıda) — düşük bir sınır, asıl JSON
        // hiç üretilmeden kesilmesine (`content: null`) yol açabiliyor.
        max_tokens: 2000,
      });
    } catch (err) {
      // Ağ/istek hatası — Phase 4E-3: RETRY EDİLMEZ.
      throw new LlmProviderError(`${this.providerLabel} isteği başarısız oldu.`, err, false);
    }

    const content = response.choices[0]?.message.content;
    if (!content) {
      // Model içerik ÜRETTİ ama boş — Phase 4E-3: RETRY EDİLEBİLİR.
      throw new LlmProviderError(`${this.providerLabel} geçerli/şemaya uygun bir JSON üretemedi.`, undefined, true);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      throw new LlmProviderError(`${this.providerLabel} çıktısı geçerli JSON değil.`, err, true);
    }

    const validated = LlmPlanOutputSchema.safeParse(parsed);
    if (!validated.success) {
      throw new LlmProviderError(`${this.providerLabel} çıktısı beklenen şemaya uymuyor.`, validated.error, true);
    }

    return toIntentResult(validated.data, input);
  }
}
