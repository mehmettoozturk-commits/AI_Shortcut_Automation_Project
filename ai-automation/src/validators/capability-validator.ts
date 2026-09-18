/**
 * Capability Validator — MASTER_SPEC.md §15, stage 2.
 *
 * "Bir AI çıktısının güvenli olmasının ana koşullarından biri, yalnızca
 * registry'de gerçekten desteklenen capability'leri üretmesidir." (§8)
 *
 * This stage does NOT reject unsupported-but-known capabilities outright —
 * unsupported ones get routed to guided setup by the compiler later
 * (CLAUDE.md: "Unsupported işlemler için guided setup/fallback üret").
 * It DOES reject capability ids that don't exist in the registry at all,
 * since those would mean the AI invented/hallucinated a capability.
 */

import type { AutomationPlan, WorkflowStep } from "../dsl/schema.js";
import { flattenSteps } from "../dsl/schema.js";
import { findCapability } from "../capability-registry/registry.js";
import type { Platform } from "../domain/types.js";
import type { ValidationIssue, ValidationResult } from "./types.js";

export interface CapabilityCheckContext {
  platform: Platform;
}

import { isAskConfirmationStep, isConditionalStep } from "../dsl/schema.js";

function isCapabilityActionStep(step: WorkflowStep): boolean {
  return !isAskConfirmationStep(step) && !isConditionalStep(step);
}

export function validateCapabilities(
  plan: AutomationPlan,
  ctx: CapabilityCheckContext
): ValidationResult {
  const issues: ValidationIssue[] = [];

  // Trigger must reference a known trigger capability for this platform.
  const triggerCap = findCapability(plan.trigger.type);
  if (!triggerCap) {
    issues.push({
      code: "unknown_capability",
      message: `Tetikleyici "${plan.trigger.type}" capability registry'de bulunamadı. AI bilinmeyen bir capability üretmiş olabilir.`,
      path: "trigger.type",
      severity: "error",
    });
  } else {
    if (triggerCap.kind !== "trigger") {
      issues.push({
        code: "wrong_capability_kind",
        message: `"${plan.trigger.type}" bir trigger değil, bir ${triggerCap.kind}.`,
        path: "trigger.type",
        severity: "error",
      });
    }
    if (triggerCap.platform !== ctx.platform) {
      issues.push({
        code: "platform_mismatch",
        message: `"${plan.trigger.type}" ${triggerCap.platform} platformu için, hedef platform ${ctx.platform}.`,
        path: "trigger.type",
        severity: "error",
      });
    }
  }

  // Every action step (ask_confirmation is built-in and always allowed).
  const allSteps = flattenSteps(plan.steps);
  allSteps.forEach((step, i) => {
    if (!isCapabilityActionStep(step)) return;
    if (step.type === "ask_confirmation") return;
    const cap = findCapability(step.type);
    if (!cap) {
      issues.push({
        code: "unknown_capability",
        message: `"${step.type}" capability registry'de bulunamadı. Bilinmeyen/uydurma bir işlem üretilemez.`,
        path: `steps[${i}]`,
        severity: "error",
      });
      return;
    }
    if (cap.kind !== "action") {
      issues.push({
        code: "wrong_capability_kind",
        message: `"${step.type}" bir action değil, bir ${cap.kind}.`,
        path: `steps[${i}]`,
        severity: "error",
      });
    }
    if (cap.platform !== ctx.platform) {
      issues.push({
        code: "platform_mismatch",
        message: `"${step.type}" ${cap.platform} platformu için, hedef platform ${ctx.platform}.`,
        path: `steps[${i}]`,
        severity: "error",
      });
    }
    if (!cap.nativeSupport) {
      issues.push({
        code: "requires_guided_setup",
        message: `"${step.type}" native olarak otomatik kurulamıyor: ${cap.fallbackMethod ?? "guided setup gerekli"}`,
        path: `steps[${i}]`,
        severity: "warning",
      });
    }
  });

  return { ok: issues.every((i) => i.severity !== "error"), issues };
}
