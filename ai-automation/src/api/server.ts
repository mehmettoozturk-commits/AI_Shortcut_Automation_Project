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
import { LocalFirstProvider } from "../nlu/local-first-provider.js";
import { bindAccessResolver, RequestProviderRouter, snapshotChannelBindings, type ChannelBinding, type ProviderRoutingOptions } from "../nlu/provider-router.js";
import { defaultAccessResolver, type RoutingSubject } from "../nlu/routing-access.js";
import { emptyContext, type ConversationContext } from "../nlu/types.js";
import { runValidationPipeline } from "../validators/pipeline.js";
import type { AutomationPlan } from "../dsl/schema.js";
import type { DraftAutomationPlan } from "../builder/types.js";
import { PlanRequestSchema, PlanResponseSchema, type PlanResponse, type PlanRequest } from "./contract.js";
import { RequestDispatchGuard, type AuthoritativeBudgetGuard } from "../quota/dispatch-guard.js";
import type { SqliteQuotaLedger } from "../quota/sqlite-ledger.js";
import { OpenAICompatibleIntentProvider } from "../nlu/providers/openai-compatible-provider.js";
import { AuthService } from "./auth/service.js";
import type { AnonymousIdentityService } from "./auth/anonymous-identity.js";
import { CreationTicketRejectedError } from "./auth/creation-tickets.js";
import { z } from "zod";

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
  signal?: AbortSignal,
  requestPipeline?: (input: { validated: PlanRequest; raw: unknown }) => NluPipeline,
  identity?: PlanIdentityBinding,
  getDispatchGuard?: () => RequestDispatchGuard | undefined,
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
  if (identity && !identity.current()) {
    sendPlanIdentityRejection(res, identity.rejection() ?? 401);
    return;
  }
  // Only after existing HTTP admission and body/schema checks. The new
  // request pipeline still performs semantic/registry/safety validation below.
  pipeline = requestPipeline?.({ validated: parsedRequest.data, raw }) ?? pipeline;

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
  const identityRejection = identity?.rejection();
  if (identityRejection) { sendPlanIdentityRejection(res, identityRejection); return; }
  const dispatchGuard = getDispatchGuard?.();
  try { dispatchGuard?.finish(outcome.status === "plan"); } catch { /* Guard retains safe rejection. */ }
  const dispatchRejection = dispatchGuard?.rejection();
  if (dispatchRejection) { sendJson(res, dispatchRejection.status, { error: dispatchRejection }); return; }

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

type PlanIdentityBinding = { subject: RoutingSubject; current: () => RoutingSubject | null; rejection: () => 401 | 503 | null };
type AnonymousService = Pick<AnonymousIdentityService, "issue" | "verify" | "revoke">;
const guestTokenHeader = "x-automation-guest-token";
function headerCount(req: IncomingMessage, name: string): number {
  return req.rawHeaders.filter((_, i) => i % 2 === 0 && req.rawHeaders[i]!.toLowerCase() === name).length;
}
function guestToken(req: IncomingMessage): string | null {
  const token = req.headers[guestTokenHeader];
  // Canonical base64url avoids alias encodings of a single secret.
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token) && Buffer.from(token, "base64url").toString("base64url") === token ? token : null;
}
function sendPlanIdentityRejection(res: ServerResponse, status: 401 | 403 | 503): void {
  sendJson(res, status, { error: status === 403 ? "Güvenli bağlantı gerekli."
    : status === 503 ? "Hesap doğrulaması şu anda kullanılamıyor." : "Geçerli hesap oturumu gerekli." });
}
/** Credential identity only, never entitlement. Missing and invalid are not interchangeable. */
function planIdentity(req: IncomingMessage, auth?: AuthService, anonymous?: AnonymousService):
  | PlanIdentityBinding
  | { rejected: 401 | 403 | 503 } {
  const count = headerCount(req, "authorization");
  const anonCount = headerCount(req, guestTokenHeader);
  if (anonCount || req.headers[guestTokenHeader] !== undefined) {
    if (count || req.headers.authorization !== undefined || anonCount !== 1) return { rejected: 401 };
    if (!authTransportAllowed(req)) return { rejected: 403 };
    const token = guestToken(req);
    if (!token || !anonymous) return { rejected: 401 };
    try {
      const verified = anonymous.verify(token);
      if (!verified || !/^[A-Za-z0-9_-]{32}$/.test(verified.subject)) return { rejected: 401 };
      const subject = Object.freeze({ kind: "anonymous" as const, subject: verified.subject });
      let denied: 401 | 503 | null = null;
      return { subject, current: () => {
        if (denied) return null;
        try { if (anonymous.verify(token)?.subject === subject.subject) return subject; denied = 401; return null; }
        catch { denied = 503; return null; }
      }, rejection: () => denied };
    } catch { return { rejected: 503 }; }
  }
  if (count === 0 && req.headers.authorization === undefined) {
    const subject = Object.freeze({ kind: "guest" as const });
    return { subject, current: () => subject, rejection: () => null };
  }
  if (count !== 1) return { rejected: 401 };
  if (!authTransportAllowed(req)) return { rejected: 403 };
  const token = bearerToken(req);
  if (!token || !auth) return { rejected: 401 };
  try {
    const session = auth.session(token);
    if (!session || typeof session.userId !== "string" || session.userId.length === 0) return { rejected: 401 };
    const subject = Object.freeze({ kind: "account" as const, userId: session.userId });
    let denied: 401 | 503 | null = null;
    return { subject, current: () => {
      if (denied) return null;
      try { if (auth.session(token)?.userId === subject.userId) return subject; denied = 401; return null; }
      catch { denied = 503; return null; } // Uncertain storage never becomes guest or grants entitlement.
    }, rejection: () => denied };
  } catch { return { rejected: 503 }; }
}

const authProofSchema = z.object({ identityToken: z.string().min(1).max(16_384), challengeId: z.string().min(1).max(128), nonce: z.string().min(1).max(256) });
const ticketSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const accountRequestSchema = authProofSchema.extend({ creationTicket: ticketSchema, confirmCreate: z.literal(true), requestId: z.string().min(1).max(128) }).strict();
const invalidCreationTicket = { error: { code: "creation_ticket_invalid_or_expired", message: "Hesap oluşturma işleminin süresi doldu. Lütfen yeniden giriş yapın." } };

async function handleAnonymousRequest(req: IncomingMessage, res: ServerResponse, service: AnonymousService, signal: AbortSignal): Promise<void> {
  if (req.method !== "POST") { sendJson(res, 404, { error: "Bulunamadı." }); return; }
  const issuance = req.url === "/auth/anonymous";
  if (headerCount(req, "authorization") || req.headers.authorization !== undefined ||
      (issuance && (headerCount(req, guestTokenHeader) || req.headers[guestTokenHeader] !== undefined))) {
    sendPlanIdentityRejection(res, 401); return;
  }
  if (!issuance && (headerCount(req, guestTokenHeader) !== 1 || !guestToken(req))) { sendPlanIdentityRejection(res, 401); return; }
  const raw = await readBody(req, MAX_PLAN_BODY_BYTES, signal);
  if (signal.aborted || raw.kind === "aborted") return;
  if (raw.kind === "too_large") { sendJson(res, 413, { error: "İstek boyutu sınırı aşıldı." }); return; }
  try {
    const body: unknown = raw.text.length ? JSON.parse(raw.text) : {};
    if (!z.object({}).strict().safeParse(body).success) { sendJson(res, 400, { error: "Geçersiz istek." }); return; }
  } catch { sendJson(res, 400, { error: "Geçersiz JSON." }); return; }
  try {
    if (issuance) { sendJson(res, 200, service.issue()); return; }
    const revoked = service.revoke(guestToken(req)!);
    sendJson(res, revoked ? 200 : 401, revoked ? { status: "revoked" } : { error: "Geçersiz anonim kimlik." });
  } catch { sendJson(res, 503, { error: "Anonim kimlik depolaması şu anda kullanılamıyor." }); }
}

async function handleAuthRequest(req: IncomingMessage, res: ServerResponse, auth: AuthService, signal: AbortSignal): Promise<void> {
  if (req.method === "GET" && req.url === "/auth/session") {
    const result = auth.session(bearerToken(req) ?? "");
    sendJson(res, result ? 200 : 401, result ?? { error: "Oturum geçersiz." }); return;
  }
  if (req.method === "DELETE" && req.url === "/auth/session") {
    const revoked = auth.logout(bearerToken(req) ?? "");
    sendJson(res, revoked ? 200 : 401, revoked ? { status: "signed_out" } : { error: "Oturum geçersiz." }); return;
  }
  if (req.method !== "POST" && !(req.method === "DELETE" && req.url === "/auth/account")) { sendJson(res, 404, { error: "Bulunamadı." }); return; }
  const raw = await readBody(req, MAX_PLAN_BODY_BYTES, signal);
  if (signal.aborted || raw.kind === "aborted") return;
  if (raw.kind === "too_large") { sendJson(res, 413, { error: "İstek boyutu sınırı aşıldı." }); return; }
  if (req.url === "/auth/apple/challenge") { sendJson(res, 200, auth.challenge()); return; }
  let body: unknown;
  try { body = JSON.parse(raw.text); } catch { sendJson(res, 400, { error: "Geçersiz JSON." }); return; }
  if (req.url === "/auth/deletion-challenges" && req.method === "POST") {
    const parsed = z.object({ requestId: z.string().uuid() }).strict().safeParse(body);
    if (!parsed.success) { sendJson(res, 400, { error: "Geçersiz istek." }); return; }
    const result = auth.deletionChallenge(bearerToken(req) ?? "", parsed.data.requestId);
    sendJson(res, result ? 200 : 401, result ?? { error: "Oturum geçersiz." }); return;
  }
  if (req.url === "/auth/account" && req.method === "DELETE") {
    const parsed = authProofSchema.extend({ confirmDelete: z.literal(true), requestId: z.string().uuid() }).strict().safeParse(body);
    if (!parsed.success) { sendJson(res, 400, { error: "Geçersiz istek." }); return; }
    const result = await auth.deleteAccount(bearerToken(req) ?? "", parsed.data.requestId, parsed.data, signal);
    if (signal.aborted) return;
    sendJson(res, !result ? 401 : result.status === "account_deleted" ? 200 : result.status === "retry_required" ? 503 : 500,
      result ?? { error: { code: "identity_verification_failed", message: "Silme yetkisi doğrulanamadı." } }); return;
  }
  if (req.url === "/auth/apple") {
    const parsed = authProofSchema.extend({ accountCreationSupported: z.boolean().optional() }).strict().safeParse(body);
    if (!parsed.success) { sendJson(res, 400, { error: "Geçersiz istek." }); return; }
    const result = await auth.prepareAccountCreation(parsed.data, signal);
    if (signal.aborted) return;
    if (!result) { sendJson(res, 401, { error: "Kimlik doğrulanamadı." }); return; }
    if (result.status === "account_creation_required" && !parsed.data.accountCreationSupported) {
      sendJson(res, 426, { status: "client_update_required", message: "Devam etmek için uygulamayı güncelleyin." }); return;
    }
    sendJson(res, 200, result); return;
  }
  if (req.url === "/auth/accounts/challenge") {
    const parsed = z.object({ creationTicket: ticketSchema }).strict().safeParse(body);
    if (!parsed.success) { sendJson(res, 400, { error: "Geçersiz istek." }); return; }
    try { sendJson(res, 200, auth.creationChallenge(parsed.data.creationTicket)); }
    catch (error) { if (!(error instanceof CreationTicketRejectedError)) throw error; sendJson(res, 410, invalidCreationTicket); }
    return;
  }
  if (req.url === "/auth/accounts") {
    const parsed = accountRequestSchema.safeParse(body);
    if (!parsed.success) { sendJson(res, 400, { error: "Geçersiz istek." }); return; }
    try {
      auth.assertCreationTicket(parsed.data.creationTicket);
      const result = await auth.completeAccountCreation(parsed.data.creationTicket, parsed.data.requestId, parsed.data, signal);
      if (signal.aborted) return;
      // Expiry/deletion during asynchronous verification uses the same safe response.
      if (!result) auth.assertCreationTicket(parsed.data.creationTicket);
      sendJson(res, !result ? 401 : result.status === "account_exists" ? 409 : result.status === "created" ? 200 : 503, result ?? { status: "creation_rejected" });
    } catch (error) {
      if (!(error instanceof CreationTicketRejectedError)) throw error;
      sendJson(res, 410, invalidCreationTicket);
    }
    return;
  }
  sendJson(res, 404, { error: "Bulunamadı." });
}

export function createPlanServer(options: {
  pipeline?: NluPipeline;
  auth?: AuthService;
  anonymous?: AnonymousService;
  tls?: { key: string | Buffer; cert: string | Buffer };
  rateLimit?: PlanRateLimitOptions;
  maxConcurrentPlans?: number;
  authRateLimit?: PlanRateLimitOptions;
  maxConcurrentAuth?: number;
  authRequestTimeoutMs?: number;
  routing?: ProviderRoutingOptions;
  /** Explicit local opt-in only. serve.ts does not activate this mode. */
  quota?: { enabled?: boolean; ledger?: SqliteQuotaLedger; budget?: AuthoritativeBudgetGuard; budgetTimeoutMs?: number };
} = {}) {
  const pipeline = options.pipeline ?? defaultPipeline;
  const routing = options.routing?.enabled === true ? Object.freeze({
    channels: snapshotChannelBindings(options.routing.channels),
    resolveAccess: options.routing.resolveAccess ?? defaultAccessResolver,
    resolverTimeoutMs: options.routing.resolverTimeoutMs,
    onPlanningComplete: options.routing.onPlanningComplete,
  }) : undefined;
  const checkPlanRateLimit = createPlanRateLimiter(options.rateLimit);
  const maxConcurrentPlans = options.maxConcurrentPlans ?? 8;
  let activePlans = 0;
  let activeAuth = 0;
  const checkAuthRateLimit = createPlanRateLimiter(options.authRateLimit);
  const handler = (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === "GET" && req.url === "/health") {
      sendJson(res, 200, { status: "ok" });
      return;
    }
    if (req.url?.startsWith("/auth/") && !authTransportAllowed(req)) {
      sendJson(res, 403, { error: "Güvenli bağlantı gerekli." });
      return;
    }
    const anonymousEndpoint = req.url === "/auth/anonymous" || req.url === "/auth/anonymous/revoke";
    if ((options.auth && req.url?.startsWith("/auth/")) || (options.anonymous && anonymousEndpoint)) {
      const retryAfter = checkAuthRateLimit(req);
      if (retryAfter !== null) { res.setHeader("Retry-After", String(retryAfter)); sendJson(res, 429, { error: "Çok fazla istek." }); return; }
      if (activeAuth >= (options.maxConcurrentAuth ?? 8)) { res.setHeader("Retry-After", "5"); sendJson(res, 503, { error: "Sunucu meşgul." }); return; }
      activeAuth++;
      const controller = new AbortController();
      let finished = false;
      const onFinish = () => { finished = true; };
      const onAbort = () => controller.abort();
      const onClose = () => { if (!finished) controller.abort(); };
      req.once("aborted", onAbort); res.once("finish", onFinish); res.once("close", onClose);
      // Includes slow/chunked body reads, not just Apple verification.
      const deadline = setTimeout(() => {
        controller.abort();
        req.destroy();
      }, options.authRequestTimeoutMs ?? 30_000);
      deadline.unref();
      const work = anonymousEndpoint
        ? options.anonymous ? handleAnonymousRequest(req, res, options.anonymous, controller.signal) : Promise.resolve(sendJson(res, 404, { error: "Bulunamadı." }))
        : handleAuthRequest(req, res, options.auth!, controller.signal);
      void work.catch(() => {
        if (!controller.signal.aborted && !res.headersSent && !res.destroyed) sendJson(res, 500, { error: { code: "internal_error", message: "İşlem tamamlanamadı." } });
      }).finally(() => {
        clearTimeout(deadline);
        activeAuth--; req.off("aborted", onAbort); res.off("finish", onFinish); res.off("close", onClose);
      });
      return;
    }
    if (req.method === "POST" && req.url === "/plan") {
      const retryAfter = checkPlanRateLimit(req);
      if (retryAfter !== null) {
        res.setHeader("Retry-After", String(retryAfter));
        sendJson(res, 429, { error: "Çok fazla istek gönderildi. Lütfen tekrar dene." });
        return;
      }
      const identity = planIdentity(req, options.auth, options.anonymous);
      if ("rejected" in identity) {
        sendPlanIdentityRejection(res, identity.rejected);
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
      const quotaMode = options.quota?.enabled === true;
      let dispatchGuard: RequestDispatchGuard | undefined;
      const requestPipeline = routing || quotaMode ? (input: { validated: PlanRequest; raw: unknown }) => {
        if (quotaMode) {
          const value = req.headers["x-automation-operation-id"];
          dispatchGuard = new RequestDispatchGuard({ ledger: options.quota!.ledger, budget: options.quota!.budget,
            operationId: headerCount(req, "x-automation-operation-id") === 1 && typeof value === "string" ? value : null,
            input: { ...input, validated: { ...input.validated, conversation: input.validated.conversation ?? emptyContext(input.validated.text) } },
            identity: () => {
              const current = identity.current();
              return current?.kind === "account" ? { kind: "account", subject: current.userId }
                : current?.kind === "anonymous" ? { kind: "anonymous", subject: current.subject } : null;
            }, signal: controller.signal, budgetTimeoutMs: options.quota!.budgetTimeoutMs });
        }
        const guarded = (binding: ChannelBinding | undefined): ChannelBinding | undefined => {
          if (!binding) return undefined;
          let clone: OpenAICompatibleIntentProvider | undefined;
          return { ...binding, provider: { plan: (...args) => {
            if (!identity.current()) throw new Error("Kimlik doğrulaması şu anda kullanılamıyor.");
            if (!dispatchGuard) return binding.provider.plan(...args);
            if (Object.getPrototypeOf(binding.provider) !== OpenAICompatibleIntentProvider.prototype) dispatchGuard.block(503, "adapter_not_guardable");
            clone ??= (binding.provider as OpenAICompatibleIntentProvider).withDispatchGuard(dispatchGuard, binding.configuration);
            return clone.plan(...args);
          } } };
        };
        const fallback = routing ? new RequestProviderRouter({ free: guarded(routing.channels.free), premium: guarded(routing.channels.premium) },
          bindAccessResolver(identity.current, routing.resolveAccess), routing.resolverTimeoutMs)
          : { plan: async () => dispatchGuard!.block(503, "guarded_router_required") };
        return new NluPipeline(undefined, undefined, undefined, new LocalFirstProvider(fallback), undefined, routing?.onPlanningComplete);
      } : undefined;
      void handlePlanRequest(req, res, pipeline, controller.signal, requestPipeline, identity, () => dispatchGuard)
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
  const server = options.tls ? createHttpsServer(options.tls, handler) : createServer(handler);
  if (options.auth) {
    const janitor = setInterval(() => {
      try { options.auth!.pruneDeletionReceipts(); } catch { /* Retry next interval; never expose stored data. */ }
    }, 60_000);
    janitor.unref();
    server.once("close", () => clearInterval(janitor));
  }
  return server;
}
