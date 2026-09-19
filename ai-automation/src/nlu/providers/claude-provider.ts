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
// NOT: Projenin geri kalanı zod v3 API'sini (`import { z } from "zod"`)
// kullanır — bu DEĞİŞMEDİ. `zodOutputFormat` yalnızca zod v4 şemalarını
// kabul ediyor (bkz. @anthropic-ai/sdk/helpers/zod.d.ts), bu yüzden
// SADECE bu dosyada, LLM'in yapılandırılmış çıktı şemasını tanımlamak
// için `zod/v4` kullanılıyor — bilinçli, dar kapsamlı bir istisna.
import { z } from "zod/v4";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { NluProvider } from "../ports.js";
import type { ConversationContext, IntentResult, IntentType } from "../types.js";
import { buildSemanticCatalog, toEntities } from "./llm-schema.js";
import { LlmProviderError } from "./errors.js";

export { LlmProviderError };

const INTENT_TYPES: [IntentType, ...IntentType[]] = [
  "create_automation",
  "modify_automation",
  "explain_automation",
  "disable_automation",
  "enable_automation",
  "delete_automation",
  "not_understood",
];

/** LLM'in üretmek ZORUNDA olduğu yapı — capability id İÇERMEZ. */
const LlmPlanOutputSchema = z.object({
  intent: z.enum(INTENT_TYPES),
  confidence: z.number().min(0).max(1).optional(),
  trigger: z
    .object({
      semantic: z.string(),
      details: z.record(z.string(), z.unknown()).optional(),
    })
    .nullable(),
  steps: z.array(
    z.object({
      semantic: z.string(),
      message: z.string().nullable().optional(),
      details: z.record(z.string(), z.unknown()).optional(),
    })
  ),
  entities: z.array(z.object({ name: z.string(), value: z.string() })),
  missing: z.array(z.object({ field: z.string(), reason: z.string() })),
});

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

function systemPrompt(): string {
  const catalog = buildSemanticCatalog();
  const lines = catalog
    .map((c) => `- [${c.kind}] ${c.semantic}: ${c.description}`)
    .join("\n");
  return [
    "Sen bir otomasyon uygulamasının niyet/varlık (intent/entity) çıkarım katmanısın.",
    "Kullanıcının Türkçe cümlesini SEMANTİK bir plana çevirirsin.",
    "",
    "KESİN KURAL: Yalnızca aşağıdaki semantik isimleri üretebilirsin.",
    "Bunlar dışında hiçbir platform/sistem id'si (nokta içeren, 'ios.'/'tesla.' gibi",
    "başlayan herhangi bir şey) ÜRETME — böyle bir şey görmüyorsun, bilmiyorsun.",
    "",
    "Bilinen semantik tetikleyiciler/eylemler:",
    lines,
    "",
    "Bir istek bu listedeki hiçbir semantiğe uymuyorsa `steps` boş kalabilir;",
    "asla uydurma bir semantik isim üretme.",
    "`missing` alanına, eylemi çalıştırmak için netleşmemiş ama gerekli olan",
    "alanları ekle (örn. bir araç eylemi için araç belirtilmemişse",
    "{field: \"vehicle\", reason: \"required_for_vehicle_action\"}).",
  ].join("\n");
}

function userPrompt(input: string, context?: ConversationContext): string {
  const parts: string[] = [];
  if (context?.conversationTurns.length) {
    parts.push("Önceki konuşma turları:");
    for (const t of context.conversationTurns) parts.push(`${t.role}: ${t.text}`);
  }
  if (context?.lastIntent) {
    // Yalnızca SEMANTİK bir ipucu — context.lastIntent.trigger/steps zaten
    // capability id değil, semantik isim taşır (bkz. types.ts).
    parts.push(
      `Önceki tur için üretilmiş semantik plan (yalnızca ipucu, aynen tekrar etme gerekmez): ${JSON.stringify({
        trigger: context.lastIntent.trigger,
        steps: context.lastIntent.steps,
      })}`
    );
  }
  parts.push(`Kullanıcının şimdiki cümlesi: "${input}"`);
  return parts.join("\n");
}

export class ClaudeIntentProvider implements NluProvider {
  private client: ClaudeMessagesClient;
  private model: string;

  constructor(options: { client?: ClaudeMessagesClient; apiKey?: string; model?: string } = {}) {
    this.model = options.model ?? "claude-opus-5";
    this.client = options.client ?? (new Anthropic({ apiKey: options.apiKey ?? resolveApiKey() }) as unknown as ClaudeMessagesClient);
  }

  async plan(input: string, context?: ConversationContext): Promise<IntentResult> {
    let response: { parsed_output: unknown };
    try {
      response = await this.client.messages.parse({
        model: this.model,
        max_tokens: 4096,
        system: systemPrompt(),
        messages: [{ role: "user", content: userPrompt(input, context) }],
        output_config: { format: zodOutputFormat(LlmPlanOutputSchema) },
      });
    } catch (err) {
      throw new LlmProviderError("LLM isteği başarısız oldu.", err);
    }

    const parsed = response.parsed_output;
    if (parsed === null || parsed === undefined) {
      throw new LlmProviderError("LLM geçerli/şemaya uygun bir JSON üretemedi.");
    }

    const validated = LlmPlanOutputSchema.safeParse(parsed);
    if (!validated.success) {
      throw new LlmProviderError("LLM çıktısı beklenen şemaya uymuyor.", validated.error);
    }

    const out = validated.data;
    return {
      intent: out.intent,
      confidence: out.confidence ?? 0.75,
      trigger: out.trigger ? { type: out.trigger.semantic, details: out.trigger.details } : undefined,
      steps: out.steps.map((s) => ({ type: s.semantic, message: s.message, details: s.details })),
      entities: toEntities(out.entities),
      missing: out.missing,
      sourceText: input,
    };
  }
}
