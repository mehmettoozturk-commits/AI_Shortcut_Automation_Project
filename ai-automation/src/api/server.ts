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
import { createServer as createHttpsServer } from "node:https";
import { TLSSocket } from "node:tls";
import { NluPipeline } from "../nlu/pipeline.js";
import { emptyContext, type ConversationContext } from "../nlu/types.js";
import { runValidationPipeline } from "../validators/pipeline.js";
import type { AutomationPlan } from "../dsl/schema.js";
import type { DraftAutomationPlan } from "../builder/types.js";
import { PlanRequestSchema, PlanResponseSchema, type PlanResponse } from "./contract.js";
import { AuthService } from "./auth/service.js";

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

const MAX_PLAN_BODY_BYTES = 64 * 1024;

type BodyReadResult =
  | { kind: "ok"; text: string }
  | { kind: "too_large" }
  | { kind: "aborted" };

async function readBody(
  req: IncomingMessage,
  maxBytes = MAX_PLAN_BODY_BYTES,
  signal?: AbortSignal,
): Promise<BodyReadResult> {
  const chunks: Buffer[] = [];
  let total = 0;
  let oversized = false;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    if (signal?.aborted || req.aborted) return { kind: "aborted" };
    total += chunk.length;
    if (total > maxBytes) {
      oversized = true;
      continue;
    }
    chunks.push(chunk);
  }
  return oversized
    ? { kind: "too_large" }
    : { kind: "ok", text: Buffer.concat(chunks).toString("utf8") };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(json),
    "Cache-Control": "no-store",
  });
  res.end(json);
}

type PlanRateLimitOptions = {
  windowMs?: number;
  maxPerPeer?: number;
  maxGlobal?: number;
};

function createPlanRateLimiter(options: PlanRateLimitOptions = {}) {
  const windowMs = options.windowMs ?? 60_000;
  const maxPerPeer = options.maxPerPeer ?? 120;
  const maxGlobal = options.maxGlobal ?? 300;
  type Bucket = { count: number; resetAt: number };
  const peers = new Map<string, Bucket>();
  let globalBucket: Bucket = { count: 0, resetAt: 0 };

  return (req: IncomingMessage): number | null => {
    const now = Date.now();
    const peer = req.socket.remoteAddress ?? "unknown";
    if (now >= globalBucket.resetAt) globalBucket = { count: 0, resetAt: now + windowMs };
    let bucket = peers.get(peer);
    if (!bucket && peers.size >= 2048) {
      for (const [key, value] of peers) if (now >= value.resetAt) peers.delete(key);
      if (peers.size >= 2048) return Math.max(1, Math.ceil(windowMs / 1000));
    }
    if (!bucket || now >= bucket.resetAt) bucket = { count: 0, resetAt: now + windowMs };
    const globalExceeded = globalBucket.count >= maxGlobal;
    const peerExceeded = bucket.count >= maxPerPeer;
    if (globalExceeded || peerExceeded) {
      const resetAt = Math.max(globalExceeded ? globalBucket.resetAt : 0, peerExceeded ? bucket.resetAt : 0);
      return Math.max(1, Math.ceil((resetAt - now) / 1000));
    }
    globalBucket.count++;
    bucket.count++;
    peers.set(peer, bucket);
    return null;
  };
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
  pipeline: NluPipeline = defaultPipeline,
  signal?: AbortSignal
): Promise<void> {
  let raw: unknown;
  try {
    const body = await readBody(req, MAX_PLAN_BODY_BYTES, signal);
    if (body.kind === "aborted" || signal?.aborted) return;
    if (body.kind === "too_large") {
      sendJson(res, 413, { error: "İstek boyutu izin verilen sınırı aşıyor." });
      return;
    }
    raw = body.text.length > 0 ? JSON.parse(body.text) : {};
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
    : await pipeline.planAsync(text, context, signal);
  if (signal?.aborted) return;

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

function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  const match = typeof header === "string" ? /^Bearer ([A-Za-z0-9_-]{20,256})$/.exec(header) : null;
  return match?.[1] ?? null;
}

function authTransportAllowed(req: IncomingMessage): boolean {
  if (req.socket instanceof TLSSocket && req.socket.encrypted) return true;
  const remote = req.socket.remoteAddress;
  return remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
}

async function readAuthBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  let total = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer>) {
    total += chunk.length;
    if (total > 20_000) return null;
    chunks.push(chunk);
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch { return null; }
}

export function createPlanServer(options: {
  pipeline?: NluPipeline;
  auth?: AuthService;
  tls?: { key: string | Buffer; cert: string | Buffer };
  rateLimit?: PlanRateLimitOptions;
  maxConcurrentPlans?: number;
} = {}) {
  const pipeline = options.pipeline ?? defaultPipeline;
  const checkPlanRateLimit = createPlanRateLimiter(options.rateLimit);
  const maxConcurrentPlans = options.maxConcurrentPlans ?? 8;
  let activePlans = 0;
  const handler = (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === "GET" && req.url === "/health") {
      sendJson(res, 200, { status: "ok" });
      return;
    }
    if (req.url?.startsWith("/auth/") && !authTransportAllowed(req)) {
      sendJson(res, 403, { error: "Güvenli bağlantı gerekli." });
      return;
    }
    if (options.auth && req.method === "POST" && req.url === "/auth/apple/challenge") {
      sendJson(res, 200, options.auth.challenge());
      return;
    }
    if (options.auth && req.method === "POST" && req.url === "/auth/apple") {
      readAuthBody(req).then(async (body) => {
        if (!body || typeof body.identityToken !== "string" || typeof body.challengeId !== "string" || typeof body.nonce !== "string") {
          sendJson(res, 400, { error: "Geçersiz istek." });
          return;
        }
        const result = await options.auth!.signIn(body.identityToken, body.challengeId, body.nonce);
        sendJson(res, result ? 200 : 401, result ?? { error: "Kimlik doğrulanamadı." });
      }).catch(() => sendJson(res, 401, { error: "Kimlik doğrulanamadı." }));
      return;
    }
    if (options.auth && req.method === "GET" && req.url === "/auth/session") {
      const result = options.auth.session(bearerToken(req) ?? "");
      sendJson(res, result ? 200 : 401, result ?? { error: "Oturum geçersiz." });
      return;
    }
    if (options.auth && req.method === "DELETE" && req.url === "/auth/session") {
      const revoked = options.auth.logout(bearerToken(req) ?? "");
      sendJson(res, revoked ? 200 : 401, revoked ? { status: "signed_out" } : { error: "Oturum geçersiz." });
      return;
    }
    if (req.method === "POST" && req.url === "/plan") {
      const retryAfter = checkPlanRateLimit(req);
      if (retryAfter !== null) {
        res.setHeader("Retry-After", String(retryAfter));
        sendJson(res, 429, { error: "Çok fazla istek gönderildi. Lütfen tekrar dene." });
        return;
      }
      if (activePlans >= maxConcurrentPlans) {
        res.setHeader("Retry-After", "5");
        sendJson(res, 503, { error: "Sunucu meşgul. Lütfen tekrar dene." });
        return;
      }
      activePlans++;
      const controller = new AbortController();
      let responseFinished = false;
      const onAborted = () => controller.abort();
      const onFinish = () => { responseFinished = true; };
      const onClose = () => { if (!responseFinished) controller.abort(); };
      req.once("aborted", onAborted);
      res.once("finish", onFinish);
      res.once("close", onClose);
      void handlePlanRequest(req, res, pipeline, controller.signal)
        .catch(() => {
          if (!res.headersSent && !res.destroyed) sendJson(res, 500, { error: "Beklenmeyen sunucu hatası." });
        })
        .finally(() => {
          activePlans--;
          req.off("aborted", onAborted);
          res.off("finish", onFinish);
          res.off("close", onClose);
        });
      return;
    }
    sendJson(res, 404, { error: "Bulunamadı." });
  };
  return options.tls ? createHttpsServer(options.tls, handler) : createServer(handler);
}
