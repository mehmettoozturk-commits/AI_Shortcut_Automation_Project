/**
 * Schema Validator — MASTER_SPEC.md §15, stage 1.
 * Checks only *shape*: is this valid Automation DSL JSON at all?
 * Knows nothing about capabilities, permissions, or platforms.
 */

import { AutomationPlanSchema, type AutomationPlan } from "../dsl/schema.js";
import type { ValidationIssue, ValidationResult } from "./types.js";

export interface SchemaValidationOutcome extends ValidationResult {
  /** Present only when ok === true */
  plan?: AutomationPlan;
}

export function validateSchema(raw: unknown): SchemaValidationOutcome {
  const parsed = AutomationPlanSchema.safeParse(raw);
  if (parsed.success) {
    return { ok: true, issues: [], plan: parsed.data };
  }
  const issues: ValidationIssue[] = parsed.error.issues.map((issue) => ({
    code: "schema_invalid",
    message: issue.message,
    path: issue.path.join("."),
    severity: "error",
  }));
  return { ok: false, issues };
}
