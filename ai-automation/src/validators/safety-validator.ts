/**
 * Safety Validator — MASTER_SPEC.md §15, stage 4.
 *
 * CLAUDE.md: "Kullanıcı onayı gerektiren işlemleri otomatik onaysız
 * çalıştırma." This stage enforces that mechanically: any action step
 * whose capability has riskLevel "medium" or "high" is only allowed to run
 * in a branch of the plan that is reachable after an `ask_confirmation`
 * step earlier in the same execution path. A risky action sitting as an
 * unconditional top-level step (nothing gates it on user confirmation) is
 * rejected, regardless of what the AI intended.
 */

import type { AutomationPlan, WorkflowStep } from "../dsl/schema.js";
import { isAskConfirmationStep, isConditionalStep } from "../dsl/schema.js";
import { findCapability } from "../capability-registry/registry.js";
import type { ValidationIssue, ValidationResult } from "./types.js";

function walk(steps: WorkflowStep[], confirmed: boolean, pathPrefix: string, issues: ValidationIssue[]): void {
  let sawConfirmation = confirmed;
  steps.forEach((step, i) => {
    const path = `${pathPrefix}[${i}]`;
    if (isAskConfirmationStep(step)) {
      sawConfirmation = true;
      return;
    }
    if (isConditionalStep(step)) {
      // then/else only run after the branch condition is evaluated, so the
      // confirmation context accumulated so far carries into both branches.
      walk(step.then, sawConfirmation, `${path}.then`, issues);
      walk(step.else, sawConfirmation, `${path}.else`, issues);
      return;
    }
    // Capability action step.
    const cap = findCapability(step.type);
    const risky = cap ? cap.riskLevel !== "low" : true; // unknown capability treated as risky by default
    if (risky && !sawConfirmation) {
      issues.push({
        code: "unconfirmed_risky_action",
        message: `"${step.type}" riskli bir işlem ve önceden kullanıcı onayı (ask_confirmation) olmadan çalışacak şekilde tanımlanmış. CLAUDE.md: kullanıcı onayı gerektiren işlemler onaysız çalıştırılamaz.`,
        path,
        severity: "error",
      });
    }
  });
}

export function validateSafety(plan: AutomationPlan): ValidationResult {
  const issues: ValidationIssue[] = [];
  walk(plan.steps, false, "steps", issues);
  return { ok: issues.every((i) => i.severity !== "error"), issues };
}
