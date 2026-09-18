/**
 * Full validation pipeline — MASTER_SPEC.md §15:
 *
 *   Schema Validator -> Capability Validator -> Permission Validator
 *   -> Safety Validator -> (Human Confirmation happens outside this code,
 *   in the UI) -> Compiler (out of scope for this package)
 *
 * Design choice: schema failure stops the pipeline immediately (nothing
 * downstream can run on unparseable input). Capability/permission/safety
 * stages all run and accumulate issues, even if an earlier one already
 * failed, so the caller can show the user everything wrong at once rather
 * than one error at a time.
 */

import type { AutomationPlan } from "../dsl/schema.js";
import type { Platform } from "../domain/types.js";
import { validateSchema } from "./schema-validator.js";
import { validateCapabilities } from "./capability-validator.js";
import { validatePermissions } from "./permission-validator.js";
import { validateSafety } from "./safety-validator.js";
import { mergeResults, type ValidationIssue, type ValidationResult } from "./types.js";

export interface PipelineContext {
  platform: Platform;
  grantedPermissions: string[];
}

export interface PipelineOutcome extends ValidationResult {
  stage: "schema" | "capability" | "permission" | "safety" | "complete";
  plan?: AutomationPlan;
}

export function runValidationPipeline(raw: unknown, ctx: PipelineContext): PipelineOutcome {
  const schemaResult = validateSchema(raw);
  if (!schemaResult.ok || !schemaResult.plan) {
    return { stage: "schema", ok: false, issues: schemaResult.issues };
  }
  const plan = schemaResult.plan;

  const capabilityResult = validateCapabilities(plan, { platform: ctx.platform });
  const permissionResult = validatePermissions(plan, { grantedPermissions: ctx.grantedPermissions });
  const safetyResult = validateSafety(plan);

  const combined: ValidationResult = mergeResults(capabilityResult, permissionResult, safetyResult);

  const issues: ValidationIssue[] = combined.issues;
  return {
    stage: combined.ok ? "complete" : "capability",
    ok: combined.ok,
    issues,
    plan,
  };
}
