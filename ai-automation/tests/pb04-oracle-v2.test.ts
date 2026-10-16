import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { lp1Corpus } from "../src/evaluation/lp1-corpus.js";
import { corpusHash, GOLDEN_CORPUS_HASH } from "../src/evaluation/lp1-manifest.js";
import { evaluateLP1 } from "../src/evaluation/lp1-evaluator.js";
import type { LP1Case, SemanticOracle } from "../src/evaluation/lp1-types.js";
import layer from "../src/evaluation/pb04-oracle-v2.json";
import families from "../docs/pb04-family-overlap.json";
import firstCodex from "../docs/pb04-first-pass-codex.json";
import firstChatGPT from "../docs/pb04-first-pass-chatgpt.json";

const read = (p: string) => readFileSync(new URL(p, import.meta.url));
const hash = (p: string) => createHash("sha256").update(read(p)).digest("hex");
const expectedIds = ["holdout-basit-2", "holdout-cok_adimli-1", "holdout-cok_adimli-3", "holdout-cok_adimli-4", "holdout-olumsuzlama_duzeltme-2"];
/** Explicit test-only V1+V2 application. No existing scorer or production importer is changed. */
function v2(): LP1Case[] {
  const v1 = lp1Corpus();
  if (corpusHash(v1) !== layer.baseCorpusHash || layer.version !== "pb04-oracle-v2") throw Error("base_version_mismatch");
  if (new Set(layer.changes.map(c => c.caseId)).size !== 5) throw Error("duplicate_changes");
  return v1.map(c => {
    const change = layer.changes.find(x => x.caseId === c.id);
    return change ? { ...c, oracle: { ...c.oracle, ...change.patch } as SemanticOracle } : c;
  });
}
const output = (c: LP1Case) => ({ ...c.oracle, plan: c.oracle.plan ? { ...c.oracle.plan, name: "Synthetic oracle comparison" } : null });
const score = (expected: LP1Case, answer: unknown) => evaluateLP1(expected, {
  caseId: expected.id, mode: "mock/simulated", modelLabel: "oracle-fixture-not-model", outputJson: JSON.stringify(answer),
});

describe("PB-04 versioned offline oracle correction", () => {
  it("preserves the original 131-case canonical golden, not a file hash", () => {
    expect(lp1Corpus()).toHaveLength(131); expect(corpusHash(lp1Corpus())).toBe(GOLDEN_CORPUS_HASH);
    expect(layer.baseCorpusHash).toBe(GOLDEN_CORPUS_HASH);
  });
  it("contains exactly five prescribed recurrence corrections", () => {
    expect(layer.changes.map(c => c.caseId)).toEqual(expectedIds);
    for (const change of layer.changes) {
      expect(Object.keys(change.patch).sort()).toEqual(["plan", "question", "status"]);
      expect(change.reason).toBe("recurrence_not_explicit");
    }
  });
  it.each(expectedIds)("%s preserves known semantics and asks recurrence without a plan", id => {
    const old = lp1Corpus().find(c => c.id === id)!; const next = v2().find(c => c.id === id)!;
    expect(next.oracle).toEqual({ ...old.oracle, status: "needs_clarification",
      question: { field: "recurrence", reasonCode: "missing_recurrence" }, plan: null });
    expect(next.input).toBe(old.input); expect(next.oracle.trigger).toEqual(old.oracle.trigger);
    expect(score(next, output(next)).passed).toBe(true);
    expect(score(next, output(old)).passed).toBe(false);
    expect(score(old, output(old)).passed).toBe(true); // Old scorer remains V1 unless explicitly given V2.
  });
  it("keeps the other 35 holdout and all 91 regression records byte-canonical equal", () => {
    const old = lp1Corpus(); const next = v2();
    const changed = next.filter((c, i) => JSON.stringify(c) !== JSON.stringify(old[i]));
    expect(changed.map(c => c.id)).toEqual(expectedIds);
    expect(next.filter(c => c.split === "regression")).toEqual(old.filter(c => c.split === "regression"));
    expect(next.filter(c => c.split === "holdout" && !expectedIds.includes(c.id))).toHaveLength(35);
  });
  it.each(["holdout-cok_adimli-0", "holdout-cok_adimli-2"])("explicit daily branch request %s remains unchanged", id => {
    expect(v2().find(c => c.id === id)).toEqual(lp1Corpus().find(c => c.id === id));
  });
  it("V1/V2 identical synthetic answers are scored separately, not inherited PASS", () => {
    const v1 = lp1Corpus().filter(c => expectedIds.includes(c.id)); const next = v2();
    expect(v1.filter(c => score(c, output(c)).passed)).toHaveLength(5);
    expect(v1.filter(c => score(next.find(n => n.id === c.id)!, output(c)).passed)).toHaveLength(0);
    // This is an oracle-comparator self-test, not a measurement of a model's quality.
  });
  it("records all 40 original holdout split members without claiming proved independence", () => {
    expect(families.cases).toHaveLength(40); expect(new Set(families.cases.map(c => c.caseId)).size).toBe(40);
    expect(families.cases.every(c => c.holdoutSplit)).toBe(true);
    expect(families.cases.every(c => ["overlap", "unresolved"].includes(c.semanticFamilyIndependence))).toBe(true);
    expect(families.cases.filter(c => c.semanticFamilyIndependence === "overlap")).toHaveLength(10);
    for (let i = 25; i < 35; i++) expect(families.cases[i]!.semanticFamilyIndependence).toBe("overlap");
  });
  it("documents PB04-12 threshold and direction uncertainty, without silently adding a sixth patch", () => {
    expect(families.extraAmbiguities[0]).toMatchObject({ reviewId: "PB04-12", fields: ["battery_level", "battery_condition"], status: "OPEN", oracleChanged: false });
    const c = v2().find(c => c.id === "holdout-eksik_bilgi-1")!;
    expect(c.oracle.plan).toBeNull(); expect(c).toEqual(lp1Corpus().find(x => x.id === c.id));
  });
  it("preserves first-pass content hashes and honest exposure/provenance", () => {
    expect(hash("../docs/pb04-first-pass-codex.json")).toBe("cc46f757ec7034d2ae67b855f9d928e5672f43a7af6f0591152440699e80f19f");
    expect(hash("../docs/pb04-first-pass-chatgpt.json")).toBe("15f3e5cf6d13a04288d03cbfa2aed0d354bd475ae4ba61151141b6ce0ffd80ef");
    expect(firstCodex.cases).toHaveLength(40); expect(firstCodex.priorCorpusExposure).toBe(true);
    expect(firstChatGPT.priorCorpusExposure).toBe(true); expect(firstChatGPT.independentHumanReview).toBe(false);
    expect(firstChatGPT.independentTrustedTimestamp).toBe(false);
    expect(firstChatGPT.sourceMessageId).toBe("aada0be8-1afe-41ca-b994-34c4f21d744e");
    expect(firstChatGPT.rawFirstPassText).toContain("PB04-38");
  });
  it("pins the V2 layer's own UTF-8 byte hash separately from canonical V1 corpus hash", () => {
    expect(hash("../src/evaluation/pb04-oracle-v2.json")).toBe("353b6f14d1f0cb5be6dda2d35fcbd5b68e6cf3d4c0a4e89197deace636af163d");
    expect(layer.realDispatchAllowed).toBe(false);
  });
  it("does not invoke any real provider transport", () => {
    const fetch = vi.spyOn(globalThis, "fetch"); try { v2(); expect(fetch).not.toHaveBeenCalled(); } finally { fetch.mockRestore(); }
  });
});
