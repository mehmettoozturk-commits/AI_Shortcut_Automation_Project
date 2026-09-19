/**
 * Phase 4D-3 — Temporal Ambiguity Hardening.
 *
 * Gerçek bir NVIDIA NIM smoke testinde (Phase 4D-2) gözlemlenen gerçek
 * bir hata: "9'da bana hatırlat." girdisi için model ne clarification
 * sordu ne bir saat uydurdu — şema açısından GEÇERLİ ama saat bilgisi
 * TAMAMEN EKSİK bir `time` tetikleyicisi ({"trigger":{"semantic":"time"}},
 * `entities`/`missing` boş) üretti. Bu, "LLM kafasına göre 09:00/21:00
 * seçer" senaryosundan bile daha sinsi: yapısal olarak tam görünüyor.
 *
 * `hardenTemporalAmbiguity` (Katman 2 — deterministik güvenlik ağı),
 * `NluPipeline.planAsync()` tarafından HANGİ `NluProvider` olursa olsun
 * (Claude, Gemini, Groq, NVIDIA, ileride yazılacak bir tanesi — hepsi)
 * çıktısına uygulanır; bu yüzden testler doğrudan bir provider'ı değil,
 * `pipeline.planAsync()`'i çağırır — asıl korunan invariant orada yaşıyor.
 */

import { describe, expect, it } from "vitest";
import { ClaudeIntentProvider, type ClaudeMessagesClient } from "../src/nlu/providers/claude-provider.js";
import { NluPipeline } from "../src/nlu/pipeline.js";
import type { NluProvider } from "../src/nlu/ports.js";
import { emptyContext } from "../src/nlu/types.js";

function fakeClaudeClient(parsed_output: unknown): ClaudeMessagesClient {
  return { messages: { parse: async () => ({ parsed_output }) } };
}

function pipelineWithClaudeFake(parsed_output: unknown): NluPipeline {
  return new NluPipeline(undefined, undefined, undefined, new ClaudeIntentProvider({ client: fakeClaudeClient(parsed_output) }));
}

describe("planAsync — LLM'in saat bilgisini TAMAMEN atladığı gerçek durum (Katman 2)", () => {
  it("'9'da bana hatırlat.' için LLM'in ürettiği (boş/eksik saatli) çıktı needs_clarification'a döner", async () => {
    // Gerçek smoke testte gözlemlenen TAM şekil: trigger var, ama saat
    // bilgisi (entities/details) hiç yok, missing de boş.
    const pipeline = pipelineWithClaudeFake({
      intent: "create_automation",
      trigger: { semantic: "time" },
      steps: [{ semantic: "notify" }],
      entities: [],
      missing: [],
    });
    const outcome = await pipeline.planAsync("9'da bana hatırlat.", emptyContext());
    expect(outcome.status).toBe("needs_clarification");
    if (outcome.status === "needs_clarification") {
      // "9'da" bir saat İÇERİR (yalnızca AM/PM belirsiz) — bu yüzden
      // soru "Saat kaçta olsun?" değil "Sabah 9 mu, akşam 9 mu?" olur.
      expect(outcome.question.question).toContain("Sabah 9 mu");
    }
  });

  it("sourceText'te HİÇ saat/sayı yoksa (normalizeTime null döner) genel 'Saat kaçta' sorusu üretir", async () => {
    const pipeline = pipelineWithClaudeFake({
      intent: "create_automation",
      trigger: { semantic: "time" },
      steps: [{ semantic: "notify" }],
      entities: [],
      missing: [],
    });
    const outcome = await pipeline.planAsync("Bana hatırlat.", emptyContext());
    expect(outcome.status).toBe("needs_clarification");
    if (outcome.status === "needs_clarification") {
      expect(outcome.question.question).toContain("Saat kaçta");
    }
  });

  it("modelin AYRICA bir saat DEĞERİ uydurduğu durumda da (entities.time dolu) sourceText'e göre yeniden değerlendirilir", async () => {
    // Model "9'da" için kendiliğinden 09:00 uydurmuş olsa BİLE,
    // sourceText hâlâ belirsiz — güvenlik ağı buna güvenmez.
    const pipeline = pipelineWithClaudeFake({
      intent: "create_automation",
      trigger: { semantic: "time" },
      steps: [{ semantic: "notify" }],
      entities: [{ name: "time", value: "09:00" }],
      missing: [],
    });
    const outcome = await pipeline.planAsync("9'da bana hatırlat.", emptyContext());
    expect(outcome.status).toBe("needs_clarification");
    if (outcome.status === "needs_clarification") {
      expect(outcome.question.question).toContain("Sabah 9 mu");
    }
  });

  it("model KENDİSİ zaten doğru şekilde clarification istemişse davranış aynı kalır (duplicate soru yok)", async () => {
    const pipeline = pipelineWithClaudeFake({
      intent: "create_automation",
      trigger: { semantic: "time" },
      steps: [{ semantic: "notify" }],
      entities: [],
      missing: [{ field: "time_of_day", reason: "am_pm_ambiguous" }],
    });
    const outcome = await pipeline.planAsync("9'da bana hatırlat.", emptyContext());
    expect(outcome.status).toBe("needs_clarification");
  });

  it("gün bölümü/24 saatlik format zaten AÇIKSA plan doğrudan kabul edilir", async () => {
    const pipeline = pipelineWithClaudeFake({
      intent: "create_automation",
      trigger: { semantic: "time" },
      steps: [{ semantic: "notify" }],
      entities: [{ name: "time", value: "21:00" }],
      missing: [],
    });
    const outcome = await pipeline.planAsync("Akşam 9'da bana hatırlat.", emptyContext());
    expect(outcome.status).toBe("plan");
  });

  it("time DIŞI bir tetikleyici için hiç devreye girmez", async () => {
    const pipeline = pipelineWithClaudeFake({
      intent: "create_automation",
      trigger: { semantic: "vehicle_departure" },
      steps: [{ semantic: "vehicle_sentry_mode" }],
      entities: [{ name: "vehicle", value: "Tesla Model Y" }],
      missing: [],
    });
    const outcome = await pipeline.planAsync("Arabadan inince Tesla Model Y'nin Sentry Mode'unu aç.", emptyContext());
    expect(outcome.status).toBe("plan");
  });
});

describe("Sağlayıcıdan bağımsızlık: hardening tek bir paylaşılan yardımcıya gömülü DEĞİL", () => {
  it("toIntentResult'ı hiç çağırmayan, elle yazılmış bir NluProvider için de aynı korumaya sahiptir", async () => {
    const rawProvider: NluProvider = {
      async plan() {
        return {
          intent: "create_automation",
          confidence: 0.9,
          trigger: { type: "time", details: {} },
          steps: [{ type: "notify" }],
          entities: {},
          missing: [],
          sourceText: "9'da bana hatırlat.",
        };
      },
    };
    const pipeline = new NluPipeline(undefined, undefined, undefined, rawProvider);
    const outcome = await pipeline.planAsync("9'da bana hatırlat.", emptyContext());
    expect(outcome.status).toBe("needs_clarification");
  });
});
