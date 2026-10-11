import { describe, expect, it } from "vitest";
import { NluPipeline } from "../src/nlu/pipeline.js";
import type { NluProvider } from "../src/nlu/ports.js";
import { emptyContext, type IntentResult } from "../src/nlu/types.js";

function providerSayingNotUnderstood(): { provider: NluProvider; calls: () => number } {
  let count = 0;
  return {
    calls: () => count,
    provider: {
      async plan(input: string): Promise<IntentResult> {
        count++;
        return {
          intent: "not_understood",
          confidence: 0.2,
          steps: [],
          entities: {},
          missing: [],
          sourceText: input,
        };
      },
    },
  };
}

describe("narrow deterministic fallback for a missed time reminder", () => {
  it("asks morning or evening when the model says not_understood", async () => {
    const fake = providerSayingNotUnderstood();
    const pipeline = new NluPipeline(undefined, undefined, undefined, fake.provider);

    const outcome = await pipeline.planAsync("9'da bana hatırlat.", emptyContext());

    expect(outcome.status).toBe("needs_clarification");
    if (outcome.status !== "needs_clarification") return;
    expect(outcome.question.id).toBe("time_of_day");
    expect(fake.calls()).toBe(1);
    expect(pipeline.retryMetrics).toEqual({
      firstPassSuccess: 0,
      repairSuccess: 0,
      deterministicFallback: 1,
      providerError: 0,
    });
  });

  it("does not turn an unrelated request into an automation", async () => {
    const fake = providerSayingNotUnderstood();
    const pipeline = new NluPipeline(undefined, undefined, undefined, fake.provider);

    const outcome = await pipeline.planAsync("Bana bir şiir yaz.", emptyContext());

    expect(outcome.status).toBe("not_understood");
    expect(pipeline.retryMetrics.deterministicFallback).toBe(0);
  });

  it("does not override an existing attempt's conversation with a new fallback", async () => {
    const context = emptyContext();
    new NluPipeline().plan("Arabadan inince Tesla Model Y Sentry Mode'unu aç.", context);
    const fake = providerSayingNotUnderstood();
    const pipeline = new NluPipeline(undefined, undefined, undefined, fake.provider);

    const outcome = await pipeline.planAsync("9'da bana hatırlat.", context);

    expect(outcome.status).toBe("not_understood");
    expect(pipeline.retryMetrics.deterministicFallback).toBe(0);
  });
});
