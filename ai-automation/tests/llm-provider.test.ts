/**
 * Phase 4B — `ClaudeIntentProvider` testleri.
 *
 * Hiçbir test gerçek Anthropic API'sine bağlanmaz (§14, tıpkı kural
 * tabanlı sağlayıcının harici API'ye bağımlı olmaması gibi) — sahte bir
 * `ClaudeMessagesClient` enjekte edilir (`messages.parse` stub'lanır).
 *
 * ⚠️ En kritik test: `buildSemanticCatalog()`/sistem promptu HİÇBİR
 * capability id İÇERMEZ — yalnızca semantik isim. Bu, projenin en
 * önemli değişmezinin (LLM capability id görmez/üretmez) LLM sınırında
 * da koruma altında olduğunu kanıtlar.
 */

import { describe, expect, it } from "vitest";
import { CAPABILITIES } from "../src/capability-registry/registry.js";
import { buildSemanticCatalog, toEntities } from "../src/nlu/providers/llm-schema.js";
import { ClaudeIntentProvider, type ClaudeMessagesClient } from "../src/nlu/providers/claude-provider.js";
import { LlmProviderError } from "../src/nlu/providers/errors.js";
import { emptyContext } from "../src/nlu/types.js";

describe("buildSemanticCatalog — LLM'e ASLA capability id göstermez", () => {
  it("katalogdaki hiçbir giriş bir capability id'si değildir", () => {
    const ids = new Set(CAPABILITIES.map((c) => c.id));
    for (const entry of buildSemanticCatalog()) {
      expect(ids.has(entry.semantic)).toBe(false);
      expect(entry.semantic).not.toContain(".");
    }
  });

  // Kaynak dosyada hardcode capability id taraması artık tek bir yerde
  // (tests/nlu-contract.test.ts) yapılıyor — provider dosyaları da o
  // listeye eklendi; burada tekrarlanmıyor.

  it("registry'deki her semantik en az bir katalog girişine karşılık gelir", () => {
    const semantics = new Set(buildSemanticCatalog().map((c) => c.semantic));
    expect(semantics.has("vehicle_sentry_mode")).toBe(true);
    expect(semantics.has("vehicle_departure")).toBe(true);
  });
});

describe("toEntities — LLM'in düz {name,value}[] çıktısını tipli Entities'e çevirir", () => {
  it("bilinen alanları doğru tipe eşler", () => {
    const e = toEntities([
      { name: "vehicle", value: "Tesla Model Y" },
      { name: "batteryLevel", value: "20" },
      { name: "condition", value: "below" },
    ]);
    expect(e.vehicle?.value).toBe("Tesla Model Y");
    expect(e.batteryLevel?.value).toBe(20);
    expect(e.condition?.value).toBe("below");
  });

  it("bilinmeyen bir alanı sessizce yok sayar (uydurma alan eklemez)", () => {
    const e = toEntities([{ name: "totally_unknown_field", value: "x" }]);
    expect(Object.keys(e)).toEqual([]);
  });
});

function fakeClient(parsed_output: unknown): ClaudeMessagesClient {
  return { messages: { parse: async () => ({ parsed_output }) } };
}

describe("ClaudeIntentProvider — yapılandırılmış çıktıyı IntentResult'a çevirir", () => {
  it("geçerli bir çıktıyı semantik IntentResult'a dönüştürür (capability id ÜRETMEZ)", async () => {
    const provider = new ClaudeIntentProvider({
      client: fakeClient({
        intent: "create_automation",
        confidence: 0.9,
        trigger: { semantic: "vehicle_departure" },
        steps: [{ semantic: "vehicle_sentry_mode" }],
        entities: [{ name: "vehicle", value: "Tesla Model Y" }],
        missing: [],
      }),
    });

    const intent = await provider.plan("Arabadan inince Tesla Model Y'nin Sentry Mode'unu aç", emptyContext());
    expect(intent.intent).toBe("create_automation");
    expect(intent.trigger?.type).toBe("vehicle_departure");
    expect(intent.steps[0]?.type).toBe("vehicle_sentry_mode");
    expect(intent.entities.vehicle?.value).toBe("Tesla Model Y");
    // Semantik isimler nokta içermez — capability id gibi görünmez.
    expect(intent.trigger?.type).not.toContain(".");
    expect(intent.steps[0]?.type).not.toContain(".");
  });

  it("eksik araç senaryosunda 'missing' alanını taşır", async () => {
    const provider = new ClaudeIntentProvider({
      client: fakeClient({
        intent: "create_automation",
        trigger: { semantic: "vehicle_departure" },
        steps: [{ semantic: "vehicle_climate" }],
        entities: [],
        missing: [{ field: "vehicle", reason: "required_for_vehicle_action" }],
      }),
    });
    const intent = await provider.plan("Arabadan inince klimayı aç.", emptyContext());
    expect(intent.missing).toEqual([{ field: "vehicle", reason: "required_for_vehicle_action" }]);
  });

  it("parsed_output null ise LlmProviderError fırlatır (JSON hatası retry/clarification ile karıştırılmaz)", async () => {
    const provider = new ClaudeIntentProvider({ client: fakeClient(null) });
    await expect(provider.plan("x", emptyContext())).rejects.toBeInstanceOf(LlmProviderError);
  });

  it("şemaya uymayan bir çıktı da LlmProviderError fırlatır", async () => {
    const provider = new ClaudeIntentProvider({ client: fakeClient({ intent: "not_a_real_intent" }) });
    await expect(provider.plan("x", emptyContext())).rejects.toBeInstanceOf(LlmProviderError);
  });

  it("istemci ağ hatası fırlatırsa LlmProviderError'a sarılır", async () => {
    const client: ClaudeMessagesClient = {
      messages: {
        parse: async () => {
          throw new Error("ECONNRESET");
        },
      },
    };
    const provider = new ClaudeIntentProvider({ client });
    await expect(provider.plan("x", emptyContext())).rejects.toBeInstanceOf(LlmProviderError);
  });
});
