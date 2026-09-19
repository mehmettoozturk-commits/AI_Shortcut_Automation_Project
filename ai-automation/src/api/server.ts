/**
 * Phase 4A — `POST /plan` sunucusu.
 *
 * Node'un yerleşik `http` modülü kullanılır — proje şu ana kadar tek bir
 * runtime bağımlılığı (zod) taşıyor; tek endpoint için Express gibi bir
 * çerçeve eklemek bu noktada gerekli değil (bkz. commit mesajı).
 *
 * Bu dosya "AI backend" değildir — mevcut `NluPipeline`'ı (şu an kural
 * tabanlı `RuleBasedIntentExtractor`, Phase 4B'de gerçek bir LLM
 * `IntentExtractor` ile DEĞİŞTİRİLECEK) HTTP sınırının arkasına koyar.
 * Sözleşme (`contract.ts`) ve doğrulama zinciri (`runValidationPipeline`)
 * şimdiden gerçek; değişecek olan yalnızca NİYET/ENTITY ÇIKARIMININ
 * kendisi. AI/LLM hiçbir zaman capability id üretmez — yalnızca semantik
 * (`vehicle_sentry_mode` gibi) üretir; registry eşlemesi
 * `src/nlu/plan-builder.ts`'te değişmeden kalır.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { NluPipeline } from "../nlu/pipeline.js";
import { emptyContext, type ConversationContext } from "../nlu/types.js";
import { runValidationPipeline } from "../validators/pipeline.js";
import type { AutomationPlan } from "../dsl/schema.js";
import type { DraftAutomationPlan } from "../builder/types.js";
import { PlanRequestSchema, PlanResponseSchema, type PlanResponse } from "./contract.js";

/** `DraftAutomationPlan` (eksik alanlar içerebilir) -> `AutomationPlan`
 * (validator zincirinin beklediği, doğrulanmamış ama TAM şekil). */
function toAutomationPlan(draft: DraftAutomationPlan): AutomationPlan {
  return {
    name: draft.name,
    trigger: {
      type: draft.trigger.type,
      device: draft.trigger.device ?? undefined,
      params: draft.trigger.params,
    },
    steps: draft.steps,
  };
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer>) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(json),
  });
  res.end(json);
}

/**
 * Her istek YENİ bir `NluPipeline` KULLANMAZ — pipeline durumsuzdur
 * (kendi içinde hiçbir konuşma verisi tutmaz, yalnızca kendisine
 * verilen `ConversationContext`'i okur/yazar). Bu yüzden tek bir
 * paylaşılan örnek güvenlidir ve her istek arasında veri sızdırmaz.
 *
 * Phase 4B: `serve.ts`, ortam değişkenine göre bu pipeline'ı kural
 * tabanlı VEYA gerçek bir LLM sağlayıcısıyla enjekte edebilir
 * (`createPlanServer({ pipeline })`) — testler de aynı yoldan sahte bir
 * sağlayıcı enjekte eder, gerçek ağ çağrısı hiçbir otomatik testte
 * yapılmaz (§14).
 */
const defaultPipeline = new NluPipeline();

export async function handlePlanRequest(
  req: IncomingMessage,
  res: ServerResponse,
  pipeline: NluPipeline = defaultPipeline
): Promise<void> {
  let raw: unknown;
  try {
    const bodyText = await readBody(req);
    raw = bodyText.length > 0 ? JSON.parse(bodyText) : {};
  } catch {
    sendJson(res, 400, { error: "Geçersiz JSON gövdesi." });
    return;
  }

  const parsedRequest = PlanRequestSchema.safeParse(raw);
  if (!parsedRequest.success) {
    sendJson(res, 400, {
      error: "İstek şeması geçersiz.",
      issues: parsedRequest.error.issues.map((i) => ({ path: i.path, message: i.message })),
    });
    return;
  }
  const { text, conversation, platform, grantedPermissions } = parsedRequest.data;

  // Sunucu DURUMSUZ: istemci bir önceki `conversation`'ı aynen geri
  // gönderir. İlk turda (conversation yok) boş bir bağlamla başlanır.
  //
  // Yönlendirme: bir önceki yanıt `needs_clarification` ise
  // `lastMissingField` doludur — bu turda gelen metin YENİ bir istek
  // değil, o soruya verilen CEVAPTIR (`pipeline.answerClarification`).
  // Aksi halde bu her zaman yeni bir `pipeline.plan()` çağrısıdır
  // (düzeltmeler dahil — NluPipeline "modify_automation" niyetini
  // kendisi ayırt eder, bkz. tests/nlu-contract.test.ts).
  const context: ConversationContext = conversation ?? emptyContext(text);
  const outcome = context.lastMissingField
    ? pipeline.answerClarification(text, context)
    : await pipeline.planAsync(text, context);

  // Phase 4B: sağlayıcı (LLM ağ hatası/geçersiz JSON) hiç çalışamadıysa
  // — bu bir "anlaşılamadı" veya "desteklenmiyor" değil, sunucunun ayrı
  // bir HTTP durumuyla (502) rapor etmesi gereken bir hata.
  if (outcome.status === "provider_error") {
    sendJson(res, 502, { status: "provider_error", message: outcome.message, conversation: context });
    return;
  }

  let response: PlanResponse;
  switch (outcome.status) {
    case "plan": {
      // Semantic Plan -> Schema -> Capability -> Permission -> Safety.
      // AI/NLU burada YALNIZCA semantik üretti (plan-builder.ts zaten
      // capability id'lerini registry'den çözdü); bu adım o çözümün
      // gerçekten geçerli/izinli/güvenli olduğunu doğrular.
      const validation = runValidationPipeline(toAutomationPlan(outcome.plan), {
        platform,
        grantedPermissions,
      });
      response = {
        status: "plan",
        plan: outcome.plan,
        intent: outcome.intent,
        band: outcome.band,
        validation,
        conversation: context,
      };
      break;
    }
    case "needs_clarification":
      response = {
        status: "needs_clarification",
        question: outcome.question,
        intent: outcome.intent,
        conversation: context,
      };
      break;
    case "unsupported":
      response = {
        status: "unsupported",
        capability: outcome.capability,
        alternatives: outcome.alternatives,
        intent: outcome.intent,
        reason: outcome.reason,
        trigger: outcome.trigger,
        conversation: context,
      };
      break;
    case "not_understood":
      response = { status: "not_understood", intent: outcome.intent, conversation: context };
      break;
  }

  // Yanıtı KENDİ sözleşmemize karşı da doğruluyoruz — istemciye şekli
  // garanti edilmemiş bir yanıt asla gönderilmez (bu bir implementasyon
  // hatasını gösterir, kullanıcı girdisiyle ilgili değildir).
  const validatedResponse = PlanResponseSchema.safeParse(response);
  if (!validatedResponse.success) {
    sendJson(res, 500, { error: "Sunucu yanıtı kendi sözleşmesini ihlal etti." });
    return;
  }

  // Phase 4C: iyi biçimli, semantik olarak eksiksiz bir plan ama
  // Schema/Capability/Permission/Safety zincirinden GEÇEMEDİ (örn. izin
  // eksik, riskli eylem onaysız). Bu, isteğin kendisi (400) veya
  // sağlayıcının çöküşü (502) değil — 422 Unprocessable Entity, "isteği
  // anladım ama sonucu işleyemem" için doğru HTTP karşılığı. Gövde
  // AYNI kalır (istemci `validation.issues`'ı okuyup nedeni gösterebilir);
  // yalnızca durum kodu ayrışır ki istemciler bunu genel bir "hata" ile
  // karıştırmadan ayrı bir dal olarak ele alabilsin (bkz. Swift
  // `HTTPBackedPlanner`, docs/ios-bridge.md Phase 4C).
  const status = validatedResponse.data.status === "plan" && !validatedResponse.data.validation.ok ? 422 : 200;
  sendJson(res, status, validatedResponse.data);
}

export function createPlanServer(options: { pipeline?: NluPipeline } = {}) {
  const pipeline = options.pipeline ?? defaultPipeline;
  return createServer((req, res) => {
    if (req.method === "POST" && req.url === "/plan") {
      handlePlanRequest(req, res, pipeline).catch(() => {
        sendJson(res, 500, { error: "Beklenmeyen sunucu hatası." });
      });
      return;
    }
    sendJson(res, 404, { error: "Bulunamadı." });
  });
}
