import { z } from "zod";
import { evaluateLP1, summarizeLP1 } from "./lp1-evaluator.js";
import { runValidationPipeline } from "../validators/pipeline.js";
import { findCapability } from "../capability-registry/registry.js";
import { LP2Journal } from "./lp2-journal.js";
import { runLP2Offline } from "./lp2-offline-runner.js";
import { sum } from "./lp2-types.js";
import type { LP2Usage } from "./lp2-types.js";
import type { LP1Case, LP1Score } from "./lp1-types.js";
import type { B2CRun, B2CScript, B2CAttempt, B2CScheduled } from "./b2c-types.js";

const counter = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const usageSchema = z.object({ inputTokens: counter, outputTokens: counter, reasoningTokens: counter,
  totalTokens: counter, reasoningIncludedInOutput: z.boolean() }).strict();
const responseSchema = z.object({ version: z.literal("synthetic-v1"), outputJson: z.string(), usage: z.unknown() }).strict();
/** Synthetic contract: reasoning has the same simulated rate as output.
 * Included=true: output already contains reasoning; false: output excludes it. */
export function normalizeB2CUsage(value: unknown): LP2Usage | null {
  const parsed = usageSchema.safeParse(value); if (!parsed.success) return null;
  const u = parsed.data;
  try {
    if (u.reasoningIncludedInOutput && u.reasoningTokens > u.outputTokens) return null;
    const billableOutput = u.reasoningIncludedInOutput ? u.outputTokens : sum(u.outputTokens, u.reasoningTokens);
    if (u.totalTokens !== sum(u.inputTokens, billableOutput)) return null;
    return { input: u.inputTokens, output: billableOutput, reasoning: u.reasoningTokens, total: u.totalTokens, reasoningIncludedInOutput: true };
  } catch { return null; }
}
const repairCodes = new Set(["missing_required_parameter", "invalid_parameter_value"]);
const fatalCodes = new Set(["unknown_capability", "missing_permission", "unconfirmed_risky_action"]);
function suspiciousPlan(plan: unknown): boolean {
  const pending: unknown[] = [plan];
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== "object") continue;
    if (Array.isArray(value)) { pending.push(...value); continue; }
    const object = value as Record<string, unknown>;
    if (typeof object.type === "string" && object.type !== "ask_confirmation" && object.type !== "conditional") {
      const capability = findCapability(object.type);
      if (!capability || capability.riskLevel !== "low") return true;
    }
    pending.push(...Object.values(object));
  }
  return false;
}
function preflight(test: LP1Case, modelLabel: string, outputJson: string): { score: LP1Score; decision: B2CAttempt["repairDecision"] } {
  const score = evaluateLP1(test, { mode: "mock/simulated", caseId: test.id, modelLabel, outputJson });
  let raw: unknown;
  try { raw = JSON.parse(outputJson); } catch { return { score, decision: "repairable" }; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { score, decision: "repairable" };
  const plan = (raw as { plan?: unknown }).plan;
  if (plan !== null && plan !== undefined) {
    const validation = runValidationPipeline(plan, { platform: "ios", grantedPermissions: [] });
    if (test.oracle.status === "unsupported" || test.oracle.status === "safety_rejected" || score.safetyViolation
      || (!score.passed && suspiciousPlan(plan))
      || validation.issues.some(i => fatalCodes.has(i.code))
      || (test.oracle.approval === "required" && !score.approvalAndBranchesCorrect)
      || (test.oracle.runtimePermissions.length > 0 && !score.permissionsCorrect)) return { score, decision: "safety_stop" };
  }
  if (score.passed) return { score, decision: "none" };
  if (!score.schemaValid || (score.issueCodes.length > 0 && score.issueCodes.every(c => repairCodes.has(c)))) return { score, decision: "repairable" };
  return { score, decision: "none" }; // Semantic mismatch is measured, not automatically retried.
}
function base(test: LP1Case, modelLabel: string, runId: string): B2CRun {
  if (!/^[a-zA-Z0-9_.-]{1,48}$/.test(modelLabel)) throw new Error("invalid_model_label");
  return { mode: "mock/simulated", runId, modelLabel, test: { id: test.id, category: test.category, split: test.split, familyId: test.familyId },
    accountingStatus: "not_attempted", qualityStatus: "not_scheduled_yet", attempted: false, accountingSettled: false,
    qualityPublished: false, attempts: [] };
}
/** No replay dispatch. Output/quality receipt is intentionally not persisted. */
export function recoveredB2CRun(journal: LP2Journal, test: LP1Case, modelLabel: string, runId: string): B2CRun {
  const result = base(test, modelLabel, runId), calls = journal.snapshot().filter(c => c.reservation.runId === runId);
  result.attempted = calls.some(c => c.state !== "reserved");
  result.accountingSettled = calls.length > 0 && calls.every(c => c.state === "settled") && !journal.isStopped;
  result.accountingStatus = result.accountingSettled ? "settled" : journal.isStopped ? "stopped" : "not_attempted";
  result.qualityStatus = journal.isStopped ? "not_evaluated_accounting_stop" : calls.length ? "unavailable_after_restart" : "not_scheduled_yet";
  result.attempts = calls.map(c => ({ callId: c.reservation.id, attempt: c.reservation.attempt, preflightValid: null,
    accountingSettled: c.state === "settled", qualityPublished: false, repairDecision: "none", provisionalScore: null }));
  return result;
}
export async function runB2COffline(journal: LP2Journal, test: LP1Case, modelLabel: string, runId: string,
  script: B2CScript, maxima: Readonly<{ input: number; output: number }>, signal?: AbortSignal, deadline?: number): Promise<B2CRun> {
  // Reusing an existing run is reporting-only, never an instruction to replay it.
  if (journal.snapshot().some(c => c.reservation.runId === runId)) return recoveredB2CRun(journal, test, modelLabel, runId);
  const result = base(test, modelLabel, runId);
  const invoke = script.call.bind(script);
  let fatal = false, accepting = true;
  const provider = {
    get mode() { return script.mode; }, get configurationId() { return script.configurationId; }, get modelId() { return script.modelId; },
    async call(callSignal: AbortSignal, attempt: 0 | 1) {
      result.attempted = true;
      const row: B2CAttempt = { callId: `${runId}_${attempt}`, attempt, preflightValid: null, accountingSettled: false,
        qualityPublished: false, repairDecision: "none", provisionalScore: null };
      result.attempts.push(row);
      const raw = await invoke(callSignal, attempt);
      if (!accepting || callSignal.aborted) throw new Error("late_result");
      const parsed = responseSchema.safeParse(raw);
      if (!parsed.success) return { usage: null, repairNeeded: false };
      const usage = normalizeB2CUsage(parsed.data.usage);
      if (!usage) return { usage: null, repairNeeded: false };
      if (Buffer.byteLength(parsed.data.outputJson, "utf8") > 64 * 1024) {
        fatal = true; row.repairDecision = "safety_stop"; return { usage, repairNeeded: false };
      }
      // Explicitly provisional: no rate publication before durable settlement/run completion.
      try {
        const checked = preflight(test, modelLabel, parsed.data.outputJson);
        row.provisionalScore = checked.score; row.preflightValid = checked.score.passed; row.repairDecision = checked.decision;
        fatal ||= checked.decision === "safety_stop";
      } catch { fatal = true; row.repairDecision = "safety_stop"; }
      return { usage, repairNeeded: row.repairDecision === "repairable" };
    },
  };
  try { await runLP2Offline(journal, provider, runId, maxima, signal, deadline); }
  catch { if (!journal.isStopped) journal.stop(); }
  accepting = false;
  if (fatal && !journal.isStopped) journal.stop();
  const calls = journal.snapshot().filter(c => c.reservation.runId === runId);
  for (const row of result.attempts) row.accountingSettled = calls.find(c => c.reservation.id === row.callId)?.state === "settled";
  result.accountingSettled = calls.length > 0 && calls.every(c => c.state === "settled") && !journal.isStopped;
  result.accountingStatus = journal.isStopped ? "stopped" : result.accountingSettled ? "settled" : "not_attempted";
  const complete = result.accountingSettled && result.attempts.length > 0 && result.attempts.every(a => a.provisionalScore !== null);
  result.qualityStatus = fatal ? "safety_stop" : complete ? "published" : "not_evaluated_accounting_stop";
  result.qualityPublished = complete && !fatal;
  for (const row of result.attempts) row.qualityPublished = result.qualityPublished && row.accountingSettled;
  return result;
}
/** Explicit schedule is the denominator; missing result rows are never omitted. */
export function summarizeB2C(schedule: readonly B2CScheduled[], results: readonly B2CRun[]) {
  const key = (r: { modelLabel: string; test: { id: string } }) => `${r.modelLabel}:${r.test.id}`;
  if (new Set(results.map(key)).size !== results.length || new Set(schedule.map(key)).size !== schedule.length
    || new Set(schedule.map(s => s.runId)).size !== schedule.length) throw new Error("duplicate_model_case_or_run");
  for (const r of results) {
    const planned = schedule.find(s => key(s) === key(r));
    if (!planned || planned.runId !== r.runId || planned.test.category !== r.test.category || planned.test.split !== r.test.split
      || planned.test.familyId !== r.test.familyId) throw new Error("unplanned_or_mismatched_result");
  }
  const runs = schedule.map(s => results.find(r => key(r) === key(s)) ?? base(s.test, s.modelLabel, s.runId));
  const metrics = (rows: readonly B2CRun[]) => {
    const first: LP1Score[] = [], final: LP1Score[] = [];
    for (const r of rows) if (r.qualityPublished) {
      if (r.attempts[0]?.qualityPublished && r.attempts[0].provisionalScore) first.push(r.attempts[0].provisionalScore);
      const last = r.attempts.at(-1); if (last?.qualityPublished && last.provisionalScore) final.push(last.provisionalScore);
    }
    return { scheduled: rows.length, attempted: rows.filter(r => r.attempted).length,
      accountingSettled: rows.filter(r => r.accountingSettled).length, qualityEvaluated: final.length,
      skippedUnavailable: rows.length - final.length, coverage: rows.length ? final.length / rows.length : null,
      diagnosticSafetyStops: rows.filter(r => r.qualityStatus === "safety_stop").length,
      firstPass: summarizeLP1(first), final: summarizeLP1(final) };
  };
  const group = (key: "modelLabel" | "category" | "split" | "familyId") => {
    const value = (r: B2CRun) => key === "modelLabel" ? r.modelLabel : r.test[key];
    return [...new Set(runs.map(value))].sort().map(v => ({ value: v, ...metrics(runs.filter(r => value(r) === v)) }));
  };
  return { mode: "mock/simulated", realModelQualityMeasured: false, ...metrics(runs),
    byModel: group("modelLabel"), byCategory: group("category"), bySplit: group("split"), byFamily: group("familyId") };
}
