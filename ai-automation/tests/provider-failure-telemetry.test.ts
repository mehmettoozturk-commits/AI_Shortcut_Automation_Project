import { describe, expect, it } from "vitest";
import { NluPipeline, type ProviderFailureTelemetry } from "../src/nlu/pipeline.js";
import { LlmProviderError } from "../src/nlu/providers/errors.js";
import { classifyOpenAICompatibleError, OpenAICompatibleIntentProvider } from "../src/nlu/providers/openai-compatible-provider.js";
import type { NluProvider } from "../src/nlu/ports.js";
import { emptyContext } from "../src/nlu/types.js";

describe("provider failure telemetry", () => {
  it.each([
    [{ status: 401 }, "auth", 401],
    [{ status: 403 }, "auth", 403],
    [{ status: 429 }, "rate_limit", 429],
    [{ status: 500 }, "server", 500],
    [{ status: 503 }, "server", 503],
    [{ status: 400 }, "http", 400],
    [{ name: "APIConnectionTimeoutError" }, "timeout", null],
    [{ name: "AbortError" }, "timeout", null],
    [{ code: "ETIMEDOUT" }, "timeout", null],
    [{ name: "APIConnectionError" }, "network", null],
    [{ code: "ECONNRESET" }, "network", null],
    [{ message: "unknown details" }, "unknown", null],
  ] as const)("classifies %j as %s", (error, errorCategory, httpStatus) => {
    expect(classifyOpenAICompatibleError(error)).toEqual({ errorCategory, httpStatus });
  });

  it("reduces raw SDK errors to safe metadata and never exposes secrets or raw content to the observer", async () => {
    const sentinel = "SECRET_API_KEY_PROMPT_HEADER_BODY_MODEL_OUTPUT";
    const client = {
      chat: { completions: { create: async () => {
        throw { status: 403, message: sentinel, headers: { authorization: sentinel }, body: sentinel };
      } } },
    };
    const provider = new OpenAICompatibleIntentProvider({
      client, apiKey: sentinel, baseURL: "https://example.invalid", model: "test", providerLabel: "Test",
    });
    const diagnostics: ProviderFailureTelemetry[] = [];
    const pipeline = new NluPipeline(undefined, undefined, undefined, provider, (diagnostic) => diagnostics.push(diagnostic));

    const outcome = await pipeline.planAsync(sentinel, emptyContext());

    expect(outcome.status).toBe("provider_error");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ stage: "first", errorCategory: "auth", httpStatus: 403,
      retryable: false, attemptCount: 1 });
    expect(diagnostics[0]!.durationMs).toBeGreaterThanOrEqual(0);
    expect(diagnostics[0]!.totalLatencyMs).toBeGreaterThanOrEqual(diagnostics[0]!.durationMs);
    expect(JSON.stringify({ outcome, diagnostics })).not.toContain(sentinel);
    expect(Object.keys(diagnostics[0]!)).toEqual([
      "stage", "errorCategory", "httpStatus", "retryable", "attemptCount", "durationMs", "totalLatencyMs",
    ]);
  });

  it("reports only the final repair failure, not a recovered first failure", async () => {
    let calls = 0;
    const provider: NluProvider = { async plan() {
      calls++;
      if (calls === 1) throw new LlmProviderError("malformed", undefined, true);
      throw new LlmProviderError("server", { body: "SECRET_BODY" }, false,
        { errorCategory: "server", httpStatus: 503 });
    } };
    const diagnostics: ProviderFailureTelemetry[] = [];
    const pipeline = new NluPipeline(undefined, undefined, undefined, provider, (diagnostic) => diagnostics.push(diagnostic));

    expect((await pipeline.planAsync("SECRET_PROMPT", emptyContext())).status).toBe("provider_error");
    expect(calls).toBe(2);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ stage: "repair", errorCategory: "server", httpStatus: 503,
      retryable: false, attemptCount: 2 });
    expect(JSON.stringify(diagnostics)).not.toMatch(/SECRET_PROMPT|SECRET_BODY/);
  });

  it("does not change provider_error behavior when a telemetry observer fails", async () => {
    const provider: NluProvider = { async plan() { throw new LlmProviderError("failure"); } };
    const pipeline = new NluPipeline(undefined, undefined, undefined, provider, () => { throw new Error("observer failed"); });
    const outcome = await pipeline.planAsync("x", emptyContext());
    expect(outcome).toEqual({ status: "provider_error", message: "failure" });
    expect(pipeline.retryMetrics.providerError).toBe(1);
  });
});
