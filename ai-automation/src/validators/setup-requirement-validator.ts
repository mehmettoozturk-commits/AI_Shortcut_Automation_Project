/**
 * External Shortcuts/Tesla requirements are not app OS permissions. They
 * cannot be verified by `grantedPermissions`, so surface them as unresolved
 * setup guidance rather than either silently granting or hard-blocking the
 * plan before the user-assisted import/link flow.
 */

import type { AutomationPlan } from "../dsl/schema.js";
import { flattenSteps } from "../dsl/schema.js";
import { findCapability } from "../capability-registry/registry.js";
import type { ValidationResult } from "./types.js";

export function validateSetupRequirements(plan: AutomationPlan): ValidationResult {
  const ids = new Set([
    plan.trigger.type,
    ...flattenSteps(plan.steps)
      .filter((step) => step.type !== "ask_confirmation" && step.type !== "conditional")
      .map((step) => step.type),
  ]);
  const issues: ValidationResult["issues"] = [];
  for (const id of ids) {
    const cap = findCapability(id);
    if (!cap) continue;
    for (const requirement of cap.setupRequirements) {
      issues.push({
        code: "setup_requirement_unverified",
        message: `"${id}" için "${requirement}" kurulumu Kestirmeler veya ilgili uygulamada kullanıcı tarafından doğrulanmalı.`,
        path: id,
        severity: "warning",
      });
    }
  }
  return { ok: true, issues };
}
