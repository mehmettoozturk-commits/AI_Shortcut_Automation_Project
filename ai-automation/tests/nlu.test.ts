/**
 * Phase 2 testleri — §15'teki 12 senaryonun tamamı.
 * Deterministik sağlayıcı kullanıldığı için harici API/LLM'e bağımlı değil (§14).
 */

import { describe, expect, it } from "vitest";
import { NluPipeline, NluPlannerAdapter, DefaultPlanRevisionEngine } from "../src/nlu/pipeline.js";
import { RuleBasedIntentExtractor } from "../src/nlu/rule-based.js";
import { emptyContext, bandFor, type PlanningOutcome } from "../src/nlu/types.js";
import { normalizeTime, normalizeRecurrence, parseTurkishNumber } from "../src/nlu/turkish.js";
import { runValidationPipeline } from "../src/validators/pipeline.js";

function plan(input: string, ctx = emptyContext()): PlanningOutcome {
  return new NluPipeline().plan(input, ctx);
}

const intentOf = (input: string) => new RuleBasedIntentExtractor().extract(input);

describe("§15.1 — 'Her akşam saat dokuzda bana ilacımı hatırlat.'", () => {
  const input = "Her akşam saat dokuzda bana ilacımı hatırlat.";

  it("saat 21:00 olarak normalize edilir (akşam bağlamı)", () => {
    expect(intentOf(input).entities.time?.value).toBe("21:00");
  });

  it("tekrar günlük olarak çıkarılır", () => {
    expect(intentOf(input).entities.recurrence?.value.kind).toBe("daily");
  });

  it("ilaç adı eksik olarak işaretlenir ve uydurulmaz", () => {
    const i = intentOf(input);
    expect(i.missing.map((m) => m.field)).toContain("ilaç_name");
    expect(i.missing.find((m) => m.field === "ilaç_name")?.reason).toBe("required_for_reminder");
    expect(i.entities.message).toBeUndefined();
  });

  it("boru hattı eksik bilgiyi tek soru olarak sorar", () => {
    const outcome = plan(input);
    expect(outcome.status).toBe("needs_clarification");
    if (outcome.status === "needs_clarification") {
      expect(outcome.question.question).toContain("Hangi ilaç");
    }
  });

  it("niyet create_automation ve güven yüksek", () => {
    const i = intentOf(input);
    expect(i.intent).toBe("create_automation");
    expect(bandFor(i.confidence)).toBe("high");
  });
});

describe("§15.2 — 'Arabadan inince Tesla Sentry Mode'u aç.'", () => {
  const input = "Arabadan inince Tesla Model Y Sentry Mode'u aç.";

  it("araç, tetikleyici ve eylem doğru eşlenir", () => {
    const outcome = plan(input);
    expect(outcome.status).toBe("plan");
    if (outcome.status === "plan") {
      expect(outcome.plan.trigger.type).toBe("ios.bluetooth.disconnected");
      expect(outcome.plan.trigger.device).toContain("Tesla");
      expect(JSON.stringify(outcome.plan.steps)).toContain("tesla.sentry_mode.toggle");
    }
  });

  it("riskli eylem otomatik olarak onay adımının arkasına alınır", () => {
    const outcome = plan(input);
    if (outcome.status === "plan") {
      expect(JSON.stringify(outcome.plan.steps)).toContain("ask_confirmation");
    }
  });

  it("üretilen plan mevcut validation zincirinden geçer", () => {
    const outcome = plan(input);
    if (outcome.status !== "plan") throw new Error("plan beklenirdi");
    const result = runValidationPipeline(
      {
        name: outcome.plan.name,
        trigger: { type: outcome.plan.trigger.type, device: outcome.plan.trigger.device ?? undefined },
        steps: outcome.plan.steps,
      },
      { platform: "ios", grantedPermissions: ["bluetooth", "tesla_account"] }
    );
    expect(result.ok).toBe(true);
  });

  it("araç belirtilmezse tek soru sorulur", () => {
    const outcome = plan("Arabadan inince Sentry Mode'u aç.");
    expect(outcome.status).toBe("needs_clarification");
    if (outcome.status === "needs_clarification") {
      expect(outcome.question.id).toBe("vehicle");
      expect(outcome.question.question).toContain("Hangi aracı");
    }
  });
});

describe("§15.3 — 'Arabadan inince Tesla kamerayı aç.'", () => {
  const input = "Arabadan inince Tesla Model Y kamerayı aç.";

  it("unsupported döner ve capability adı registry'den gelir", () => {
    const outcome = plan(input);
    expect(outcome.status).toBe("unsupported");
    if (outcome.status === "unsupported") {
      expect(outcome.capability).toBe("tesla.camera_action");
    }
  });

  it("alternatifler registry'den türetilir, AI katmanında hardcode değil", () => {
    const outcome = plan(input);
    if (outcome.status === "unsupported") {
      const ids = outcome.alternatives.map((a) => a.id);
      expect(ids).toContain("tesla.sentry_mode.toggle");
      expect(ids).toContain("tesla.climate.start");
      expect(ids).not.toContain("tesla.camera_action");
    }
  });

  it("desteklenmeyen capability için gereksiz ek soru sorulmaz (§6)", () => {
    const outcome = plan("Arabadan inince kamerayı aç.");
    // Araç sorulmadan doğrudan unsupported dönmeli
    expect(outcome.status).toBe("unsupported");
  });
});

describe("§15.4 — 'Eve gelince ışıkları aç.'", () => {
  const input = "Eve gelince ışıkları aç.";

  it("konum entity'si home olarak çıkarılır", () => {
    expect(intentOf(input).entities.location?.value.semantic).toBe("home");
  });

  it("eylem registry'de olmadığı için unsupported döner — uydurulmaz", () => {
    const outcome = plan(input);
    expect(outcome.status).toBe("unsupported");
  });
});

describe("§15.5 — 'Pil yüzde yirmiye düşünce bana haber ver.'", () => {
  const input = "Pil yüzde yirmiye düşünce bana haber ver.";

  it("pil seviyesi 20 ve koşul 'below' olarak çıkarılır", () => {
    const i = intentOf(input);
    expect(i.entities.batteryLevel?.value).toBe(20);
    expect(i.entities.condition?.value).toBe("below");
  });

  it("bildirim eylemine ve pil tetikleyicisine eşlenir", () => {
    const outcome = plan(input);
    expect(outcome.status).toBe("plan");
    if (outcome.status === "plan") {
      expect(outcome.plan.trigger.type).toBe("ios.battery.falls_below");
      expect(JSON.stringify(outcome.plan.steps)).toContain("ios.notification.show");
    }
  });
});

describe("§15.6 — 'Annem WhatsApp'tan yazınca bana bildir.'", () => {
  const input = "Annem WhatsApp'tan yazınca bana bildir.";

  it("kişi ve uygulama entity'leri çıkarılır", () => {
    const i = intentOf(input);
    expect(i.entities.person?.value).toBe("annem");
    expect(i.entities.application?.value).toBe("WhatsApp");
  });

  it("mesaj tetikleyicisi semantik olarak yakalanır", () => {
    expect(intentOf(input).trigger?.type).toBe("incoming_message");
  });

  it("WhatsApp doğrulanmadığı için unsupported döner (registry kısıtı)", () => {
    const outcome = plan(input);
    expect(outcome.status).toBe("unsupported");
    if (outcome.status === "unsupported") {
      expect(outcome.reason).toContain("WhatsApp");
    }
  });

  it("aynı cümle Mesajlar uygulaması için desteklenir", () => {
    const outcome = plan("Annem Mesajlar'dan yazınca bana bildir.");
    expect(outcome.status).toBe("plan");
  });
});

describe("§15.7 — 'Hayır, 9 değil 10.' (mevcut planı değiştirir)", () => {
  it("yeni otomasyon üretmez, saati revize eder", () => {
    const ctx = emptyContext();
    const pipeline = new NluPipeline();
    pipeline.plan("Her akşam saat dokuzda bana ilacımı hatırlat.", ctx);
    const before = ctx.currentPlan!;
    const outcome = pipeline.plan("Hayır, 9 değil 10.", ctx);

    expect(outcome.intent.intent).toBe("modify_automation");
    const after = ctx.currentPlan!;
    // Akşam bağlamı korunur: 21:00 -> 22:00
    expect((after.trigger.params as { time?: string }).time).toBe("22:00");
    // Tetikleyici ve eylem aynı kalır
    expect(after.trigger.type).toBe(before.trigger.type);
    expect(JSON.stringify(after.steps)).toBe(JSON.stringify(before.steps));
  });
});

describe("§15.8 — 'Kamera değil Sentry Mode.' (mevcut planı revize eder)", () => {
  it("eylem değişir, araç ve tetikleyici korunur", () => {
    const revision = new DefaultPlanRevisionEngine();
    const current = {
      name: "Tesla kamera",
      trigger: { type: "ios.bluetooth.disconnected", device: "Tesla Model Y", params: {} },
      steps: [
        { type: "ask_confirmation" as const, message: "?" },
        { type: "conditional" as const, condition: "answer == yes", then: [{ type: "tesla.camera_action" }], else: [] },
      ],
      missing: [],
      answers: {},
    };
    const revised = revision.revise(current, "Kamera değil Sentry Mode.", emptyContext());

    expect(JSON.stringify(revised.steps)).toContain("tesla.sentry_mode.toggle");
    expect(JSON.stringify(revised.steps)).not.toContain("tesla.camera_action");
    expect(revised.trigger.device).toBe("Tesla Model Y");
    expect(revised.trigger.type).toBe("ios.bluetooth.disconnected");
  });

  it("'Hayır, klimayı aç.' düzeltmesi de aynı planı revize eder", () => {
    const revision = new DefaultPlanRevisionEngine();
    const current = {
      name: "Tesla kamera",
      trigger: { type: "ios.bluetooth.disconnected", device: "Tesla Model Y", params: {} },
      steps: [{ type: "tesla.camera_action" }],
      missing: [],
      answers: {},
    };
    const revised = revision.revise(current, "Hayır, klimayı aç.", emptyContext());
    expect(JSON.stringify(revised.steps)).toContain("tesla.climate.start");
    expect(revised.trigger.device).toBe("Tesla Model Y");
  });

  it("düzeltme desteklenmeyen bir eyleme geri dönemez", () => {
    const revision = new DefaultPlanRevisionEngine();
    const current = {
      name: "Sentry",
      trigger: { type: "ios.bluetooth.disconnected", device: "Tesla Model Y", params: {} },
      steps: [{ type: "tesla.sentry_mode.toggle" }],
      missing: [],
      answers: {},
    };
    const revised = revision.revise(current, "Sentry değil kamera olsun.", emptyContext());
    expect(JSON.stringify(revised.steps)).not.toContain("tesla.camera_action");
  });
});

describe("§15.9 — 'Yarın sabah 9.'", () => {
  it("tarih yarın, saat 09:00 olarak normalize edilir", () => {
    const i = intentOf("Yarın sabah 9'da bana haber ver.");
    expect(i.entities.date?.value).toBe("tomorrow");
    expect(i.entities.time?.value).toBe("09:00");
    expect(i.entities.time?.ambiguous).toBeUndefined();
  });
});

describe("§15.10 — \"9'da hatırlat.\" (AM/PM belirsiz)", () => {
  it("belirsizlik işaretlenir, sessizce tahmin edilmez", () => {
    const t = normalizeTime("9'da hatırlat");
    expect(t?.ambiguous).toBe(true);
  });

  it("clarification sorusu 'Sabah 9 mu, akşam 9 mu?' olur", () => {
    const outcome = plan("9'da ilacımı hatırlat.");
    expect(outcome.status).toBe("needs_clarification");
    if (outcome.status === "needs_clarification") {
      const questions = [outcome.question.question];
      expect(questions.some((q) => q.includes("Sabah 9 mu"))).toBe(true);
    }
  });

  it("bağlam verildiğinde belirsizlik kalmaz", () => {
    expect(normalizeTime("akşam 9'da")?.ambiguous).toBeUndefined();
    expect(normalizeTime("sabah 9'da")?.ambiguous).toBeUndefined();
    expect(normalizeTime("21:00")?.ambiguous).toBeUndefined();
  });

  // Phase 4D-3 — gerçek Claude/NVIDIA smoke testinde çıkan test matrisi
  // (docs/api.md Phase 4D-3 eki). "gece 12'de"/"öğlen 12'de" öncesinde
  // GERÇEK bir hataydı: "gece" ve "akşam" aynı kovaya konuyordu, bu da
  // "gece 12" için 00:00 yerine 12:00 üretiyordu.
  it("belirsiz durumda değer güvenilir DEĞİLDİR (ambiguous:true çağıranı uyarır)", () => {
    expect(normalizeTime("9'da hatırlat")?.ambiguous).toBe(true);
  });

  it.each([
    ["sabah 9'da", "09:00"],
    ["akşam 9'da", "21:00"],
    ["21'de", "21:00"],
    ["öğlen 12'de", "12:00"],
    ["gece 12'de", "00:00"],
  ] as const)('"%s" → %s, belirsiz DEĞİL', (input, expectedValue) => {
    const result = normalizeTime(input);
    expect(result?.value).toBe(expectedValue);
    expect(result?.ambiguous).toBeUndefined();
  });
});

describe("§15.11 — anlaşılmayan niyet", () => {
  it("not_understood döner ve uydurma plan üretilmez", () => {
    const outcome = plan("zxcv qwer asdf");
    expect(outcome.status).toBe("not_understood");
    expect(outcome.intent.intent).toBe("not_understood");
    expect(bandFor(outcome.intent.confidence)).toBe("low");
  });
});

describe("§15.12 — bilinmeyen capability", () => {
  it("registry'de karşılığı olmayan eylem unsupported döner", () => {
    const outcome = plan("Arabadan inince perdeleri kapat.");
    expect(outcome.status).toBe("unsupported");
  });
});

describe("Türkçe normalizasyon (§5, §12)", () => {
  it("doğal Türkçe tetikleyici varyasyonları tanınır", () => {
    for (const s of ["arabadan inince", "arabadan çıktığımda", "araçtan ayrıldığımda", "arabadan uzaklaşınca"]) {
      const i = intentOf(`${s} Tesla Model Y Sentry Mode'u aç`);
      expect(i.trigger?.type).toBe("vehicle_departure");
    }
  });

  it("tekrar ifadeleri normalize edilir", () => {
    expect(normalizeRecurrence("her pazartesi")?.value).toEqual({ kind: "weekly", weekdays: [1] });
    expect(normalizeRecurrence("hafta içi")?.value.kind).toBe("weekday");
    expect(normalizeRecurrence("haftada üç gün")?.value).toEqual({ kind: "times_per_week", count: 3 });
    expect(normalizeRecurrence("her akşam")?.value.kind).toBe("daily");
  });

  it("Türkçe sayı sözcükleri okunur", () => {
    expect(parseTurkishNumber("dokuz")).toBe(9);
    expect(parseTurkishNumber("yirmi")).toBe(20);
    expect(parseTurkishNumber("20")).toBe(20);
  });

  it("orijinal ifade normalize değerle birlikte saklanır", () => {
    const t = normalizeTime("akşam dokuzda");
    expect(t?.value).toBe("21:00");
    expect(t?.raw).toContain("dokuz");
  });
});

describe("Niyet türleri (§3)", () => {
  it("silme/kapatma/açıklama niyetleri ayrılır", () => {
    expect(intentOf("Bu otomasyonu sil").intent).toBe("delete_automation");
    expect(intentOf("Tesla otomasyonunu kapat").intent).toBe("disable_automation");
    expect(intentOf("Bu nasıl çalışıyor?").intent).toBe("explain_automation");
  });
});

describe("Konuşma bağlamı (§9)", () => {
  it("turlar, plan ve seçilen entity'ler bağlamda tutulur", () => {
    const ctx = emptyContext();
    const pipeline = new NluPipeline();
    pipeline.plan("Arabadan inince Tesla Model Y Sentry Mode'u aç.", ctx);
    expect(ctx.conversationTurns).toHaveLength(1);
    expect(ctx.currentPlan).not.toBeNull();
    expect(ctx.selectedEntities.vehicle?.value).toContain("Tesla");
    expect(ctx.originalInput).toContain("Arabadan");
  });

  it("son sorulan soru ve eksik alan bağlamda saklanır", () => {
    const ctx = emptyContext();
    new NluPipeline().plan("Arabadan inince Sentry Mode'u aç.", ctx);
    expect(ctx.lastMissingField).toBe("vehicle");
    expect(ctx.lastQuestion).toContain("Hangi aracı");
  });
});

describe("Phase 1 uyum katmanı (regresyon güvenliği)", () => {
  it("NluPlannerAdapter, Phase 1 Planner portunu karşılar", async () => {
    const adapter = new NluPlannerAdapter();
    const result = await adapter.plan("Arabadan inince Tesla Model Y Sentry Mode'u aç.");
    expect(result.kind).toBe("plan");
  });

  it("anlaşılmayan girdi Phase 1 sözleşmesine uygun döner", async () => {
    const adapter = new NluPlannerAdapter();
    const result = await adapter.plan("qqq zzz");
    expect(result.kind).toBe("not_understood");
  });

  it("desteklenmeyen kamera isteği, state machine'in unsupported akışını tetikleyecek planı üretir", async () => {
    const adapter = new NluPlannerAdapter();
    const result = await adapter.plan("Arabadan inince Tesla Model Y kamerayı aç.");
    expect(result.kind).toBe("plan");
    if (result.kind === "plan") {
      expect(JSON.stringify(result.plan.steps)).toContain("tesla.camera_action");
    }
  });
});
