import type { WorkflowStep } from "../dsl/schema.js";

export const LP1_CATEGORIES = ["basit", "parametreli", "eksik_bilgi", "desteklenmeyen", "cok_adimli", "guvenlik", "belirsiz", "olumsuzlama_duzeltme"] as const;
export type LP1Category = typeof LP1_CATEGORIES[number];
export type LP1Status = "plan" | "needs_clarification" | "unsupported" | "safety_rejected";
/** Benchmark-normalized record, NOT a new production API contract. */
export interface SemanticOracle {
  intent: "create_automation";
  status: LP1Status;
  trigger: { semantic: string; params: Record<string, unknown> } | null;
  actionSemantics: string[];
  question: { field: string; reasonCode: string } | null;
  approval: "not_required" | "required" | "reject_unconfirmed";
  runtimePermissions: string[];
  externalSetup: string[];
  /** null explicitly forbids any executable plan, including on clarification. */
  plan: { trigger: { type: string; params: Record<string, unknown> }; steps: WorkflowStep[] } | null;
  unsupportedReason: string | null;
}
export interface LP1Case {
  id: string;
  input: string;
  category: LP1Category;
  split: "regression" | "holdout";
  familyId: string;
  risk: "low" | "high";
  oracle: SemanticOracle;
}

/** In-memory JSON fixture only; no callback/provider/client injection. */
export interface LP1Fixture {
  mode: "mock/simulated";
  caseId: string;
  modelLabel: string;
  outputJson: string;
}
export interface LP1Score {
  caseId: string;
  modelLabel: string;
  category: LP1Category;
  split: LP1Case["split"];
  familyId: string;
  expectsClarification: boolean;
  passed: boolean;
  schemaValid: boolean;
  semanticCorrect: boolean;
  capabilityCorrect: boolean;
  clarificationCorrect: boolean;
  permissionsCorrect: boolean;
  approvalAndBranchesCorrect: boolean;
  safetyViolation: boolean;
  failures: string[];
  issueCodes: string[];
}
