import { flattenSteps } from "../dsl/schema.js";
import { NluPipeline } from "../nlu/pipeline.js";
import { LocalFirstProvider } from "../nlu/local-first-provider.js";
import type { PlanningProvenance } from "../nlu/planning-provenance.js";
import { LlmPlanOutputSchema } from "../nlu/providers/llm-schema.js";
import { OpenAICompatibleIntentProvider, type OpenAICompatibleChatClient } from "../nlu/providers/openai-compatible-provider.js";
import { emptyContext } from "../nlu/types.js";
import { runValidationPipeline, type PipelineOutcome } from "../validators/pipeline.js";
import { CATEGORIES, type EvaluationCase, type EvalStatus } from "./types.js";
import { estimateCost, estimateTokens, SIMULATED_PRICES, type PriceAssumption } from "./cost.js";

export interface CaseResult {
  id: string;
  category: EvaluationCase["category"];
  layer: EvaluationCase["layer"];
  status: EvalStatus;
  passed: boolean;
  failures: string[];
  calls: number;
  schemaSamples: number;
  schemaValid: number;
  capabilityCorrect: boolean | null;
  clarificationCorrect: boolean;
  repairAttempted: boolean;
  repairSucceeded: boolean;
  /** Unsafe plan accepted, not expected unsafe fixtures safely rejected. */
  safetyViolations: number;
  durationMs: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  provenance: PlanningProvenance | null;
}

function classify(validation: PipelineOutcome): EvalStatus {
  if (validation.ok) return "plan";
  if (validation.stage === "schema") return "schema_error";
  if (validation.issues.some(i => i.code === "unconfirmed_risky_action")) return "safety_rejected";
  return "validation_error";
}

/** No provider injection, environment access, network transport or SDK construction.
 * The only client is the scripted in-memory boundary below. */
export async function evaluateCase(test: EvaluationCase, now: () => number = () => performance.now()): Promise<CaseResult> {
  const start = now();
  const controller = new AbortController();
  let calls = 0, schemaSamples = 0, schemaValid = 0, estimatedInputTokens = 0, estimatedOutputTokens = 0;
  let provenance: PlanningProvenance | null = null;
  let rawPlan: unknown = test.rawPlan;
  let question: string | undefined;
  let validation: PipelineOutcome | undefined;
  let status: EvalStatus;
  const client: OpenAICompatibleChatClient = { chat: { completions: { create: async (params, options) => {
    const reply = test.replies[calls++];
    estimatedInputTokens += estimateTokens(JSON.stringify(params));
    if (!reply) throw new Error("Mock script exhausted");
    if (options?.signal?.aborted || reply.kind === "abort") {
      controller.abort();
      throw Object.assign(new Error("Simulated abort"), { name: "AbortError" });
    }
    if (reply.kind === "timeout") throw Object.assign(new Error("Simulated timeout"), { name: "APIConnectionTimeoutError" });
    if (reply.kind === "error") throw Object.assign(new Error("Simulated failure"), { status: 503 });
    if (reply.kind !== "json") throw new Error("Invalid mock reply");
    estimatedOutputTokens += estimateTokens(reply.text);
    schemaSamples++;
    try { if (LlmPlanOutputSchema.safeParse(JSON.parse(reply.text)).success) schemaValid++; } catch { /* Count invalid JSON. */ }
    return { choices: [{ message: { content: reply.text } }] };
  } } } };
  if (test.layer === "nlu") {
    const provider = new OpenAICompatibleIntentProvider({ client, baseURL: "https://offline.invalid", model: "mock-only", providerLabel: "Mock" });
    const pipeline = new NluPipeline(undefined, undefined, undefined, new LocalFirstProvider(provider), undefined, p => { provenance = p; });
    const result = await pipeline.planAsync(test.input, emptyContext(), controller.signal);
    status = result.status;
    if (result.status === "needs_clarification") question = result.question.id;
    // Match the existing HTTP draft-to-DSL projection (nullable draft device).
    if (result.status === "plan") rawPlan = { name: result.plan.name, trigger: {
      ...result.plan.trigger, device: result.plan.trigger.device ?? undefined }, steps: result.plan.steps };
  } else status = "schema_error";
  if (rawPlan !== undefined) {
    validation = runValidationPipeline(rawPlan, { platform: "ios", grantedPermissions: [] });
    status = classify(validation);
  }
  const failures: string[] = [];
  if (status !== test.expected.status) failures.push(`status:${status}`);
  if (calls !== test.expected.calls) failures.push(`calls:${calls}`);
  if (test.expected.question && question !== test.expected.question) failures.push(`question:${question}`);
  if (test.expected.issue && !validation?.issues.some(i => i.code === test.expected.issue)) failures.push(`issue:${test.expected.issue}`);
  const output = validation?.plan;
  if (test.expected.trigger && output?.trigger.type !== test.expected.trigger) failures.push("trigger");
  for (const [key, value] of Object.entries(test.expected.params ?? {})) {
    if (output?.trigger.params?.[key] !== value) failures.push(`param:${key}`);
  }
  if (test.expected.stepTypes && JSON.stringify(output ? flattenSteps(output.steps).map(s => s.type) : []) !== JSON.stringify(test.expected.stepTypes)) failures.push("steps");
  const capabilityErrors = validation?.issues.some(i => ["unknown_capability", "wrong_capability_kind", "platform_mismatch", "invalid_parameter", "missing_parameter"].includes(i.code)) ?? false;
  const capabilityCorrect = status === "unsupported" ? test.expected.status === "unsupported"
    : output ? !capabilityErrors && !failures.some(f => /^(trigger|param:|steps)/.test(f)) : null;
  const repairAttempted = calls > 1;
  return { id: test.id, category: test.category, layer: test.layer, status, passed: failures.length === 0, failures, calls,
    schemaSamples: schemaSamples + (validation ? 1 : 0), schemaValid: schemaValid + (validation?.plan ? 1 : 0),
    capabilityCorrect, clarificationCorrect: test.expected.status === "needs_clarification"
      ? status === "needs_clarification" && question === test.expected.question : status !== "needs_clarification",
    repairAttempted, repairSucceeded: repairAttempted && status === "plan" && failures.length === 0,
    safetyViolations: test.expected.status === "safety_rejected" && validation?.ok ? 1 : 0,
    durationMs: Math.max(0, now() - start), estimatedInputTokens, estimatedOutputTokens, provenance };
}

const ratio = (n: number, d: number): number | null => d ? n / d : null;
export function summarize(results: readonly CaseResult[], prices: readonly PriceAssumption[] = SIMULATED_PRICES) {
  if (!results.length || new Set(results.map(r => r.id)).size !== results.length) throw new Error("Empty or duplicate evaluation cases");
  const sum = (select: (r: CaseResult) => number) => results.reduce((n, r) => n + select(r), 0);
  const capabilities = results.filter(r => r.capabilityCorrect !== null);
  const repairs = results.filter(r => r.repairAttempted);
  const durations = results.map(r => r.durationMs).sort((a, b) => a - b);
  const input = sum(r => r.estimatedInputTokens), output = sum(r => r.estimatedOutputTokens);
  return {
    mode: "mock/simulated" as const, realApiCalls: 0, realKeysUsed: 0, total: results.length,
    passed: sum(r => Number(r.passed)),
    categories: CATEGORIES.map(category => ({ category, total: results.filter(r => r.category === category).length,
      passed: results.filter(r => r.category === category && r.passed).length })),
    layers: { nlu: results.filter(r => r.layer === "nlu").length, validatorOnly: results.filter(r => r.layer === "dsl").length },
    schemaValidity: { valid: sum(r => r.schemaValid), total: sum(r => r.schemaSamples), rate: ratio(sum(r => r.schemaValid), sum(r => r.schemaSamples)) },
    capabilityCorrectness: { correct: capabilities.filter(r => r.capabilityCorrect).length, total: capabilities.length,
      rate: ratio(capabilities.filter(r => r.capabilityCorrect).length, capabilities.length) },
    clarificationAccuracy: { correct: sum(r => Number(r.clarificationCorrect)), total: results.length,
      rate: ratio(sum(r => Number(r.clarificationCorrect)), results.length) },
    repairSuccess: { successful: repairs.filter(r => r.repairSucceeded).length, attempted: repairs.length,
      rate: ratio(repairs.filter(r => r.repairSucceeded).length, repairs.length) },
    safetyViolationCount: sum(r => r.safetyViolations), mockProviderInvocationCount: sum(r => r.calls),
    latency: { kind: "local mock wall-clock, not model latency", averageMs: sum(r => r.durationMs) / results.length,
      p95Ms: durations[Math.ceil(durations.length * 0.95) - 1]! },
    cost: { kind: "estimated/simulated; chars/4; hidden reasoning excluded", inputTokens: input, outputTokens: output,
      estimates: prices.map(price => ({ ...price, estimatedUsd: estimateCost(input, output, price) })) },
  };
}

export async function runMockEvaluation(cases: readonly EvaluationCase[], prices: readonly PriceAssumption[] = SIMULATED_PRICES) {
  const results: CaseResult[] = [];
  for (const test of cases) results.push(await evaluateCase(test));
  return { summary: summarize(results, prices), results };
}
