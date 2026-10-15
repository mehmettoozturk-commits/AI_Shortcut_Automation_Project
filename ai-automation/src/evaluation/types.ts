export const CATEGORIES = ["basit", "parametreli", "eksik_bilgi", "desteklenmeyen", "cok_adimli", "guvenlik", "belirsiz", "bozuk_cikti"] as const;
export type Category = typeof CATEGORIES[number];
export type EvalStatus = "plan" | "needs_clarification" | "unsupported" | "not_understood" | "provider_error" | "schema_error" | "validation_error" | "safety_rejected";
export type MockReply = { kind: "json"; text: string } | { kind: "timeout" | "error" | "abort" };
export interface EvaluationCase {
  id: string;
  category: Category;
  input: string;
  /** NLU cases cross the unchanged adapter, Local-First and pipeline.
   * DSL cases exercise validators only; never claimed as language understanding. */
  layer: "nlu" | "dsl";
  replies: readonly MockReply[];
  rawPlan?: unknown;
  expected: {
    status: EvalStatus;
    calls: number;
    issue?: string;
    question?: string;
    trigger?: string;
    params?: Record<string, unknown>;
    stepTypes?: string[];
  };
}
