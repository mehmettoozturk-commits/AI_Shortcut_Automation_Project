/**
 * Permission Validator — MASTER_SPEC.md §15, stage 3.
 *
 * Checks only permissions owned by THIS app. The registry's legacy
 * `permissions` field denotes Shortcuts/Tesla setup requirements; app OS
 * authorization never proves those external steps complete. This does NOT request permissions itself
 * (MASTER_SPEC §20: "İzinler ihtiyaç anında istenmeli") — it only reports
 * which are missing so the caller can prompt the user for exactly those,
 * at the point they're needed.
 */

import type { AutomationPlan, WorkflowStep } from "../dsl/schema.js";
import { flattenSteps } from "../dsl/schema.js";
import { findCapability } from "../capability-registry/registry.js";
import type { Capability } from "../capability-registry/types.js";
import type { ValidationIssue, ValidationResult } from "./types.js";

export interface PermissionCheckContext {
  /** OS permissions granted to this app, not Shortcuts/Tesla setup. */
  grantedPermissions: string[];
  /** Test seam for future app-owned permissions not present in today's registry. */
  lookupCapability?: (id: string) => Capability | undefined;
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
  const lookup = ctx.lookupCapability ?? findCapability;

  const requiredByCapability = new Map<string, string[]>();
  const triggerCap = lookup(plan.trigger.type);
  if (triggerCap) requiredByCapability.set(plan.trigger.type, triggerCap.runtimePermissions ?? []);
  for (const type of collectStepTypes(plan.steps)) {
    const cap = lookup(type);
    if (cap) requiredByCapability.set(type, cap.runtimePermissions ?? []);
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
