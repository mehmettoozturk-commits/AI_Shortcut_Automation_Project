/**
 * Permission Validator — MASTER_SPEC.md §15, stage 3.
 *
 * Checks that every capability used by the plan has its required
 * permission(s) granted. This does NOT request permissions itself
 * (MASTER_SPEC §20: "İzinler ihtiyaç anında istenmeli") — it only reports
 * which are missing so the caller can prompt the user for exactly those,
 * at the point they're needed.
 */

import type { AutomationPlan, WorkflowStep } from "../dsl/schema.js";
import { flattenSteps } from "../dsl/schema.js";
import { findCapability } from "../capability-registry/registry.js";
import type { ValidationIssue, ValidationResult } from "./types.js";

export interface PermissionCheckContext {
  /** Permission ids the user has already granted, e.g. ["bluetooth"]. */
  grantedPermissions: string[];
}

function collectStepTypes(steps: WorkflowStep[]): string[] {
  return flattenSteps(steps)
    .map((s) => s.type)
    .filter((t) => t !== "ask_confirmation" && t !== "conditional");
}

export function validatePermissions(
  plan: AutomationPlan,
  ctx: PermissionCheckContext
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const granted = new Set(ctx.grantedPermissions);

  const requiredByCapability = new Map<string, string[]>();
  const triggerCap = findCapability(plan.trigger.type);
  if (triggerCap) requiredByCapability.set(plan.trigger.type, triggerCap.permissions);
  for (const type of collectStepTypes(plan.steps)) {
    const cap = findCapability(type);
    if (cap) requiredByCapability.set(type, cap.permissions);
  }

  for (const [capId, perms] of requiredByCapability) {
    for (const perm of perms) {
      if (!granted.has(perm)) {
        issues.push({
          code: "missing_permission",
          message: `"${capId}" için "${perm}" izni verilmemiş.`,
          path: capId,
          severity: "error",
        });
      }
    }
  }

  return { ok: issues.every((i) => i.severity !== "error"), issues };
}
