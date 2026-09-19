/**
 * Phase 4A — gerçek HTTP entegrasyon testleri.
 *
 * Sunucu ephemeral bir portta (port 0 -> OS boş bir port atar) gerçekten
 * başlatılır ve gerçek `fetch` istekleriyle konuşulur — `handlePlanRequest`
 * fonksiyonunu doğrudan çağırmak yerine, `createPlanServer()`'ın
 * ürettiği GERÇEK sunucuya karşı test edilir.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { createPlanServer } from "../src/api/server.js";
import { NluPipeline } from "../src/nlu/pipeline.js";
import type { NluProvider } from "../src/nlu/ports.js";
import { LlmProviderError } from "../src/nlu/providers/errors.js";
import type { IntentResult } from "../src/nlu/types.js";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createPlanServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("beklenmeyen adres");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});

function postPlan(body: unknown) {
  return fetch(`${baseUrl}/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /plan — gerçek HTTP sunucusu", () => {
  it("net bir cümle için tam bir plan + doğrulama sonucu döner", async () => {
    const res = await postPlan({
      text: "Arabadan inince Tesla Model Y'nin Sentry Mode'unu aç",
      grantedPermissions: ["bluetooth", "tesla_account"],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("plan");
    expect(body.plan.trigger.type).toBe("ios.bluetooth.disconnected");
    expect(JSON.stringify(body.plan.steps)).toContain("tesla.sentry_mode.toggle");
    // AI/NLU capability id ÜRETMEDİ, yalnızca semantik üretti; id
    // registry eşlemesinden geldi — bu, plan-builder.ts'in gerçekten
    // çalıştığının kanıtı.
    expect(body.intent.steps[0].type).toBe("vehicle_sentry_mode");
    expect(body.validation.ok).toBe(true);
    expect(body.validation.stage).toBe("complete");
  });

  it("izin verilmemişse doğrulama zinciri bunu yakalar (ok: false, HTTP 422)", async () => {
    const res = await postPlan({
      text: "Arabadan inince Tesla Model Y'nin Sentry Mode'unu aç",
      grantedPermissions: [],
    });
    // Phase 4C: iyi biçimli/semantik olarak eksiksiz ama zincirden
    // geçemeyen bir plan artık 200 değil 422 döner (bkz. server.ts) —
    // istemcinin bunu genel bir hatayla karıştırmadan ayırt edebilmesi
    // için.
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.status).toBe("plan");
    expect(body.validation.ok).toBe(false);
    expect(body.validation.issues.some((i: { code: string }) => i.code === "missing_permission")).toBe(true);
  });

  it("araç belirtilmezse needs_clarification döner", async () => {
    const res = await postPlan({ text: "Arabadan inince Sentry Mode'u aç" });
    const body = await res.json();
    expect(body.status).toBe("needs_clarification");
    expect(body.question.id).toBe("vehicle");
    expect(body.conversation.lastMissingField).toBe("vehicle");
  });

  it("desteklenmeyen bir eylem alternatiflerle unsupported döner (HTTP 200)", async () => {
    const res = await postPlan({ text: "Arabadan inince Tesla'nın kamerasını aç" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("unsupported");
    expect(body.alternatives.some((a: { id: string }) => a.id === "tesla.sentry_mode.toggle")).toBe(true);
    // Phase 4C: tetikleyici çözüldü (Swift HTTPBackedPlanner registry'yi
    // hiç bilmeden bunu kullanabilsin diye) — capability id İÇERİĞİNİ
    // Swift YORUMLAMAZ, yalnızca taşır.
    expect(body.trigger).toBe("ios.bluetooth.disconnected");
  });

  it("anlaşılamayan girdi için not_understood döner", async () => {
    const res = await postPlan({ text: "zzz qqq" });
    const body = await res.json();
    expect(body.status).toBe("not_understood");
  });

  it("çok turlu konuşma: clarification sonrası conversation'ı geri göndermek cevabı doğru işler", async () => {
    const first = await postPlan({ text: "Arabadan inince klimayı aç." });
    const firstBody = await first.json();
    expect(firstBody.status).toBe("needs_clarification");

    const second = await postPlan({ text: "Tesla Model Y.", conversation: firstBody.conversation });
    const secondBody = await second.json();
    expect(secondBody.status).toBe("plan");
    expect(secondBody.plan.trigger.device).toBe("Tesla Model Y");
    expect(JSON.stringify(secondBody.plan.steps)).toContain("tesla.climate.start");
  });

  it("geçersiz istek gövdesi (text eksik) 400 döner", async () => {
    const res = await postPlan({});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("bozuk JSON 400 döner", async () => {
    const res = await fetch(`${baseUrl}/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ bozuk json",
    });
    expect(res.status).toBe(400);
  });

  it("bilinmeyen bir yol 404 döner", async () => {
    const res = await fetch(`${baseUrl}/unknown`);
    expect(res.status).toBe(404);
  });

  it("GET /plan 404 döner (yalnızca POST destekleniyor)", async () => {
    const res = await fetch(`${baseUrl}/plan`);
    expect(res.status).toBe(404);
  });
});

/**
 * Phase 4B — sağlayıcı hatası (LLM ağ/JSON hatası) HTTP'de ayrı bir
 * durum ve durum kodu (502) olarak raporlanır; `not_understood`/
 * `unsupported` (200) ile KARIŞTIRILMAZ. Sahte bir `NluProvider`
 * enjekte edilir — gerçek ağ çağrısı yapılmaz (§14).
 */
describe("POST /plan — sağlayıcı hatası (provider_error)", () => {
  class FailingProvider implements NluProvider {
    async plan(): Promise<IntentResult> {
      throw new LlmProviderError("LLM isteği başarısız oldu (test).");
    }
  }

  let failingServer: Server;
  let failingBaseUrl: string;

  beforeAll(async () => {
    failingServer = createPlanServer({ pipeline: new NluPipeline(undefined, undefined, undefined, new FailingProvider()) });
    await new Promise<void>((resolve) => failingServer.listen(0, resolve));
    const address = failingServer.address();
    if (address === null || typeof address === "string") throw new Error("beklenmeyen adres");
    failingBaseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => failingServer.close((err) => (err ? reject(err) : resolve())));
  });

  it("502 döner ve durumu 'provider_error' olarak raporlar", async () => {
    const res = await fetch(`${failingBaseUrl}/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Arabadan inince Sentry Mode'u aç" }),
    });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.status).toBe("provider_error");
    expect(body.message).toContain("test");
  });
});
