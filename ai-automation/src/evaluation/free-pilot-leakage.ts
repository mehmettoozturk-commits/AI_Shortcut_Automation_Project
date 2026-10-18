import type { PilotCase } from "./free-pilot-contract.js";

export const normalizePilotText = (text: string) => text.normalize("NFC").toLocaleLowerCase("tr")
  .replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
// Keep negation, direction and corrections. Numbers alone are never independence evidence.
export const maskPilotNumbers = (text: string) => normalizePilotText(text).replace(/\d+(?:[.:]\d+)?/g, "<number>");
const familyKeys = ["sourceId", "promptFamilyId", "expressionFamilyId", "numericFamilyId"] as const;
export interface LeakageFinding { a: string; b: string; reason: string; severity: "LEAKAGE" | "REVIEW_REQUIRED" }
export function auditPilotLeakage(cases: readonly PilotCase[]) {
  const sorted = [...cases].sort((a, b) => a.caseId.localeCompare(b.caseId, "en"));
  const parent = sorted.map((_, i) => i), findings: LeakageFinding[] = [];
  const root = (i: number): number => { while (parent[i] !== i) i = parent[i]!; return i; };
  const union = (a: number, b: number) => { parent[root(b)] = root(a); };
  const similar = (a: string, b: string) => {
    const words = (s: string) => new Set(s.split(/\s+/));
    const x = words(a), y = words(b), both = [...x].filter(w => y.has(w)).length;
    return both / new Set([...x, ...y]).size >= 0.65;
  };
  for (let i = 0; i < sorted.length; i++) for (let j = i + 1; j < sorted.length; j++) {
    const a = sorted[i]!, b = sorted[j]!;
    const common = familyKeys.filter(k => a[k] === b[k]);
    if (common.length) union(i, j);
    if (common.length && a.split !== b.split) findings.push({ a: a.caseId, b: b.caseId, reason: common.join(","), severity: "LEAKAGE" });
    const exact = normalizePilotText(a.input) === normalizePilotText(b.input);
    const numeric = maskPilotNumbers(a.input) === maskPilotNumbers(b.input);
    if (exact || numeric || similar(maskPilotNumbers(a.input), maskPilotNumbers(b.input))) {
      // Suspicion does not silently merge/assign splits; a custodian must review it.
      findings.push({ a: a.caseId, b: b.caseId, reason: exact ? "normalized_duplicate" : numeric ? "numeric_variant" : "lexical_similarity",
        severity: a.split !== b.split && exact ? "LEAKAGE" : "REVIEW_REQUIRED" });
    }
  }
  const groups = new Map<number, PilotCase[]>();
  sorted.forEach((c, i) => { const key = root(i); groups.set(key, [...(groups.get(key) ?? []), c]); });
  for (const group of groups.values()) if (new Set(group.map(c => c.split)).size > 1) {
    const first = group[0]!;
    for (const other of group.slice(1)) if (other.split !== first.split) findings.push({ a: first.caseId, b: other.caseId, reason: "transitive_component", severity: "LEAKAGE" });
  }
  return { status: findings.some(f => f.severity === "LEAKAGE") ? "LEAKAGE" as const
    : findings.length ? "REVIEW_REQUIRED" as const : "PASS" as const,
    components: [...groups.values()].map(group => group.map(c => c.caseId)), findings };
}
