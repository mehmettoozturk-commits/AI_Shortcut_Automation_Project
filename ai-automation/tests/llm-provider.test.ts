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
import { GeminiIntentProvider, type GeminiClient } from "../src/nlu/providers/gemini-provider.js";
import {
  OpenAICompatibleIntentProvider,
  type OpenAICompatibleChatClient,
} from "../src/nlu/providers/openai-compatible-provider.js";
import { createGroqProvider } from "../src/nlu/providers/groq-provider.js";
import { createNvidiaProvider } from "../src/nlu/providers/nvidia-provider.js";
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

/**
 * Phase 4D-2 — ücretsiz sağlayıcılar: Gemini (kendi SDK'sı) ve
 * OpenAI-uyumlu (Groq/NVIDIA NIM, tek implementasyonu paylaşır). Hiçbiri
 * gerçek ağ çağrısı yapmaz — sahte istemciler enjekte edilir. Amaç:
 * Claude ile AYNI şema/eşleme/hata sözleşmesine uyduklarını kanıtlamak.
 */
function fakeGeminiClient(text: string | undefined): GeminiClient {
  return { models: { generateContent: async () => ({ text }) } };
}

describe("GeminiIntentProvider — Claude ile AYNI şemayı/eşlemeyi kullanır", () => {
  const validJson = JSON.stringify({
    intent: "create_automation",
    trigger: { semantic: "vehicle_departure" },
    steps: [{ semantic: "vehicle_sentry_mode" }],
    entities: [{ name: "vehicle", value: "Tesla Model Y" }],
    missing: [],
  });

  it("geçerli bir JSON metnini semantik IntentResult'a dönüştürür", async () => {
    const provider = new GeminiIntentProvider({ client: fakeGeminiClient(validJson) });
    const intent = await provider.plan("Arabadan inince Tesla Model Y'nin Sentry Mode'unu aç", emptyContext());
    expect(intent.trigger?.type).toBe("vehicle_departure");
    expect(intent.steps[0]?.type).toBe("vehicle_sentry_mode");
    expect(intent.trigger?.type).not.toContain(".");
  });

  it("boş/undefined metin LlmProviderError fırlatır", async () => {
    const provider = new GeminiIntentProvider({ client: fakeGeminiClient(undefined) });
    await expect(provider.plan("x", emptyContext())).rejects.toBeInstanceOf(LlmProviderError);
  });

  it("geçersiz JSON metni LlmProviderError fırlatır", async () => {
    const provider = new GeminiIntentProvider({ client: fakeGeminiClient("{ bozuk") });
    await expect(provider.plan("x", emptyContext())).rejects.toBeInstanceOf(LlmProviderError);
  });

  it("şemaya uymayan bir JSON da LlmProviderError fırlatır", async () => {
    const provider = new GeminiIntentProvider({ client: fakeGeminiClient(JSON.stringify({ intent: "gecersiz" })) });
    await expect(provider.plan("x", emptyContext())).rejects.toBeInstanceOf(LlmProviderError);
  });
});

function fakeOpenAICompatibleClient(content: string | null | undefined): OpenAICompatibleChatClient {
  return { chat: { completions: { create: async () => ({ choices: [{ message: { content } }] }) } } };
}

describe("OpenAICompatibleIntentProvider — Groq/NVIDIA NIM'in paylaştığı ortak implementasyon", () => {
  const validJson = JSON.stringify({
    intent: "create_automation",
    trigger: { semantic: "vehicle_departure" },
    steps: [{ semantic: "vehicle_sentry_mode" }],
    entities: [],
    missing: [],
  });

  it("geçerli bir JSON içeriğini semantik IntentResult'a dönüştürür", async () => {
    const provider = new OpenAICompatibleIntentProvider({
      client: fakeOpenAICompatibleClient(validJson),
      baseURL: "https://example.invalid/v1",
      model: "test-model",
      providerLabel: "Test",
    });
    const intent = await provider.plan("Arabadan inince Tesla Model Y'nin Sentry Mode'unu aç", emptyContext());
    expect(intent.trigger?.type).toBe("vehicle_departure");
    expect(intent.steps[0]?.type).toBe("vehicle_sentry_mode");
  });

  it("boş içerik LlmProviderError fırlatır (sağlayıcı adı mesajda geçer)", async () => {
    const provider = new OpenAICompatibleIntentProvider({
      client: fakeOpenAICompatibleClient(null),
      baseURL: "https://example.invalid/v1",
      model: "test-model",
      providerLabel: "Test",
    });
    await expect(provider.plan("x", emptyContext())).rejects.toMatchObject({ message: expect.stringContaining("Test") });
  });

  it("şemaya uymayan bir JSON da LlmProviderError fırlatır", async () => {
    const provider = new OpenAICompatibleIntentProvider({
      client: fakeOpenAICompatibleClient(JSON.stringify({ intent: "gecersiz" })),
      baseURL: "https://example.invalid/v1",
      model: "test-model",
      providerLabel: "Test",
    });
    await expect(provider.plan("x", emptyContext())).rejects.toBeInstanceOf(LlmProviderError);
  });

  it("createGroqProvider ve createNvidiaProvider, aynı implementasyonu doğru sabit değerlerle kurar", async () => {
    const groq = createGroqProvider({ client: fakeOpenAICompatibleClient(validJson) });
    const nvidia = createNvidiaProvider({ client: fakeOpenAICompatibleClient(validJson) });
    expect((await groq.plan("x", emptyContext())).trigger?.type).toBe("vehicle_departure");
    expect((await nvidia.plan("x", emptyContext())).trigger?.type).toBe("vehicle_departure");
  });
});
