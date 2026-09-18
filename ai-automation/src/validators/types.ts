export type ValidationSeverity = "error" | "warning";

export interface ValidationIssue {
  code: string;
  message: string;
  /** e.g. "steps[1].then[0]" */
  path?: string;
  severity: ValidationSeverity;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

export function okResult(): ValidationResult {
  return { ok: true, issues: [] };
}

export function failResult(issues: ValidationIssue[]): ValidationResult {
  return { ok: issues.every((i) => i.severity !== "error"), issues };
}

export function mergeResults(...results: ValidationResult[]): ValidationResult {
  const issues = results.flatMap((r) => r.issues);
  return { ok: issues.every((i) => i.severity !== "error"), issues };
}
