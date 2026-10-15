import { describe, expect, it } from "vitest";
import { lp1Corpus, lp1FaultCases } from "../src/evaluation/lp1-corpus.js";
import { auditCorpus, canonicalJson, caseHash, corpusHash, GOLDEN_CASE_HASHES, GOLDEN_CORPUS_HASH, normalizedInput, numericFamily } from "../src/evaluation/lp1-manifest.js";
import { LP1_CATEGORIES } from "../src/evaluation/lp1-types.js";
import { turkishEvaluationCases } from "../src/evaluation/turkish-cases.js";
import { runValidationPipeline } from "../src/validators/pipeline.js";

describe("LP1 reviewed corpus manifest", () => {
  const cases = lp1Corpus();
  it("freezes 91 adapted inputs plus 40 holdout and excludes 13 faults", () => {
    expect(auditCorpus(cases)).toEqual([]);
    expect(cases).toHaveLength(131);
    expect(cases.filter(c => c.split === "regression").map(c => [c.id, c.input])).toEqual(
      turkishEvaluationCases().filter(c => c.category !== "bozuk_cikti").map(c => [c.id, c.input]));
    expect(lp1FaultCases()).toHaveLength(13);
    expect(lp1FaultCases().every(f => !cases.some(c => c.id === f.id))).toBe(true);
    for (const category of LP1_CATEGORIES) expect(cases.filter(c => c.split === "holdout" && c.category === category)).toHaveLength(5);
    expect(Object.keys(GOLDEN_CASE_HASHES)).toHaveLength(131);
    expect(corpusHash(cases)).toBe(GOLDEN_CORPUS_HASH);
    expect(corpusHash([...cases].reverse())).toBe(GOLDEN_CORPUS_HASH);
  });
  it.each(cases)("$id has a complete reviewed oracle and fixed hash", test => {
    expect(caseHash(test)).toBe(GOLDEN_CASE_HASHES[test.id]);
    expect(test.oracle.intent).toBe("create_automation");
    expect(test.oracle.approval).toBeTruthy();
    expect(Array.isArray(test.oracle.runtimePermissions)).toBe(true);
    expect(Array.isArray(test.oracle.externalSetup)).toBe(true);
    if (test.oracle.status === "plan") {
      expect(test.oracle.plan).not.toBeNull();
      expect(test.oracle.trigger).not.toBeNull();
    } else expect(test.oracle.plan).toBeNull();
    if (test.oracle.status === "needs_clarification") expect(test.oracle.question?.reasonCode).toBeTruthy();
    if (test.category === "cok_adimli") {
      expect(test.oracle.approval).toBe("required");
      const step = test.oracle.plan!.steps[1]!;
      expect(step).toMatchObject({ type: "conditional", condition: "answer == yes",
        then: [{ type: "tesla.doors.lock" }], else: [{ type: "ios.notification.show" }] });
    }
  });
  it.each(["input", "category", "split", "familyId", "risk", "oracle", "id"] as const)("detects %s mutation", field => {
    const changed = structuredClone(cases);
    const record = changed[0]! as unknown as Record<string, unknown>;
    record[field] = field === "oracle" ? { ...changed[0]!.oracle, approval: "required" } : "tampered";
    expect(auditCorpus(changed).length).toBeGreaterThan(0);
    expect(corpusHash(changed)).not.toBe(GOLDEN_CORPUS_HASH);
  });
  it("detects duplicate input, ID, split-family and numeric-construction leakage", () => {
    const changed = structuredClone(cases);
    const holdout = changed.find(c => c.split === "holdout")!;
    holdout.input = changed[0]!.input.replace("%1 ", "%2 ");
    expect(auditCorpus(changed)).toContain(`cross_split_overlap:${holdout.id}`);
    holdout.input = changed[0]!.input;
    expect(auditCorpus(changed)).toContain(`duplicate_text:${holdout.id}`);
    holdout.familyId = changed[0]!.familyId;
    expect(auditCorpus(changed)).toContain(`cross_split_overlap:${holdout.id}`);
    changed[1]!.id = changed[0]!.id;
    expect(auditCorpus(changed)).toContain(`duplicate_id:${changed[0]!.id}`);
  });
  it("uses documented deterministic JSON, not locale-dependent key ordering", () => {
    expect(canonicalJson({ b: [2, 1], a: "İ" })).toBe('{"a":"İ","b":[2,1]}');
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
    expect(() => canonicalJson(undefined)).toThrow();
    expect(() => canonicalJson(NaN)).toThrow();
    expect(() => canonicalJson(new Date())).toThrow();
    expect(normalizedInput("  PİL %20! ")).toBe("pil 20");
    expect(numericFamily("Pil %20!")).toBe(numericFamily("Pil %30."));
  });
  it("all executable oracles independently pass the unchanged validator chain", () => {
    for (const test of cases.filter(c => c.oracle.plan !== null)) {
      const result = runValidationPipeline({ name: "Oracle validation", ...test.oracle.plan }, { platform: "ios", grantedPermissions: [] });
      expect(result.ok, test.id).toBe(true);
      expect(result.issues.some(i => i.severity === "error"), test.id).toBe(false);
    }
  });
});
