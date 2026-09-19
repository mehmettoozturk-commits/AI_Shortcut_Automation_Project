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

  it("izin verilmemişse doğrulama zinciri bunu yakalar (ok: false)", async () => {
    const res = await postPlan({
      text: "Arabadan inince Tesla Model Y'nin Sentry Mode'unu aç",
      grantedPermissions: [],
    });
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

  it("desteklenmeyen bir eylem alternatiflerle unsupported döner", async () => {
    const res = await postPlan({ text: "Arabadan inince Tesla'nın kamerasını aç" });
    const body = await res.json();
    expect(body.status).toBe("unsupported");
    expect(body.alternatives.some((a: { id: string }) => a.id === "tesla.sentry_mode.toggle")).toBe(true);
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
