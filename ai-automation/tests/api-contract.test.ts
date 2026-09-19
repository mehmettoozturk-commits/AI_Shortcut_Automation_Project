import { describe, expect, it } from "vitest";
import { PlanRequestSchema, PlanResponseSchema, ConversationContextSchema } from "../src/api/contract.js";
import { emptyContext } from "../src/nlu/types.js";
import { NluPipeline } from "../src/nlu/pipeline.js";

describe("PlanRequestSchema", () => {
  it("yalnızca text ile geçerli bir istek kabul eder, platform/grantedPermissions varsayılanları uygular", () => {
    const result = PlanRequestSchema.safeParse({ text: "Arabadan inince Sentry Mode'u aç" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.platform).toBe("ios");
      expect(result.data.grantedPermissions).toEqual([]);
    }
  });

  it("boş text'i reddeder", () => {
    expect(PlanRequestSchema.safeParse({ text: "" }).success).toBe(false);
  });

  it("text alanı eksikse reddeder", () => {
    expect(PlanRequestSchema.safeParse({}).success).toBe(false);
  });

  it("geçerli bir ConversationContext'i kabul eder", () => {
    const ctx = emptyContext("merhaba");
    const result = PlanRequestSchema.safeParse({ text: "devam", conversation: ctx });
    expect(result.success).toBe(true);
  });
});

describe("ConversationContextSchema — gerçek pipeline çıktısıyla round-trip", () => {
  it("NluPipeline'ın ürettiği GERÇEK context'i doğrular (uydurma fixture değil)", () => {
    const pipeline = new NluPipeline();
    const ctx = emptyContext();
    pipeline.plan("Arabadan inince klimayı aç.", ctx);
    const result = ConversationContextSchema.safeParse(ctx);
    expect(result.success).toBe(true);
  });
});

describe("PlanResponseSchema — gerçek pipeline çıktılarıyla", () => {
  function buildResponse(text: string) {
    const pipeline = new NluPipeline();
    const ctx = emptyContext();
    return { outcome: pipeline.plan(text, ctx), ctx };
  }

  it("'plan' durumunu (validation alanı elle eklenerek) doğrular", () => {
    const { outcome, ctx } = buildResponse("Arabadan inince Tesla Model Y'nin Sentry Mode'unu aç");
    expect(outcome.status).toBe("plan");
    if (outcome.status !== "plan") return;
    const response = {
      status: "plan" as const,
      plan: outcome.plan,
      intent: outcome.intent,
      band: outcome.band,
      validation: { stage: "complete" as const, ok: true, issues: [] },
      conversation: ctx,
    };
    expect(PlanResponseSchema.safeParse(response).success).toBe(true);
  });

  it("'needs_clarification' durumunu doğrular", () => {
    const { outcome, ctx } = buildResponse("Arabadan inince Sentry Mode'u aç");
    expect(outcome.status).toBe("needs_clarification");
    if (outcome.status !== "needs_clarification") return;
    const response = {
      status: "needs_clarification" as const,
      question: outcome.question,
      intent: outcome.intent,
      conversation: ctx,
    };
    expect(PlanResponseSchema.safeParse(response).success).toBe(true);
  });

  it("'unsupported' durumunu doğrular", () => {
    const { outcome, ctx } = buildResponse("Arabadan inince Tesla'nın kamerasını aç");
    expect(outcome.status).toBe("unsupported");
    if (outcome.status !== "unsupported") return;
    const response = {
      status: "unsupported" as const,
      capability: outcome.capability,
      alternatives: outcome.alternatives,
      intent: outcome.intent,
      reason: outcome.reason,
      conversation: ctx,
    };
    expect(PlanResponseSchema.safeParse(response).success).toBe(true);
  });

  it("'not_understood' durumunu doğrular", () => {
    const { outcome, ctx } = buildResponse("zzz qqq");
    expect(outcome.status).toBe("not_understood");
    if (outcome.status !== "not_understood") return;
    const response = { status: "not_understood" as const, intent: outcome.intent, conversation: ctx };
    expect(PlanResponseSchema.safeParse(response).success).toBe(true);
  });

  it("bilinmeyen bir 'status' değerini reddeder (discriminated union)", () => {
    const result = PlanResponseSchema.safeParse({ status: "something_else" });
    expect(result.success).toBe(false);
  });
});
