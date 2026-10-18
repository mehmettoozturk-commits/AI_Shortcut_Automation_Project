# P4-FREE-03B — Offline evaluation foundation

Only contract/leakage/scoring code and synthetic development fixtures. No real pilot corpus, grammar changes, true-blind evaluation, provider call, network, key or production configuration. Custodian operations remain HOLD.

## Contract and provenance

Schema v1 records case/source/author/generator/prompt/expression/numeric family IDs, capability snapshot hash, oracle version, category, polarity, direction, typed spans, slot state, split and review state. `sourceId` means one concrete creation session, not a generic vendor. Missing provenance, invalid enums, fabricated capability, contradictory plan oracle and bad spans reject. Unsupported means null capability plus requested concept and unknown outcome. Plan/clarification/unknown/validation failure have distinct strict oracles. Registry identity checks are not natural-language oracle review or capability runtime support proof. Span offsets use JavaScript UTF-16 units, not UTF-8 byte offsets. Snapshot hash is SHA256 of the current ordered registry JSON; it must match the trusted frozen evaluator snapshot.

## Leakage

Shared source session, prompt, expression or numeric family creates a connected component that must stay in one split, including transitive links. Generator version alone does not merge all cases. Normalized exact duplicates across splits are LEAKAGE. Numeric masking or lexical token Jaccard >=0.65 yields REVIEW_REQUIRED, not silent independence; uncertainty must be adjudicated by the custodian. NFC/Turkish case/whitespace normalization preserves negation, direction and correction. String heuristics miss some semantic paraphrases and may overflag others; human review remains mandatory. Auditor is O(n²), designed for a small pilot, not unlimited ingestion. The case schema's 10k bound is not a performance guarantee.

## Scoring

Only the root plan name is presentation-only. Trigger/action IDs, params, device, message, arrays, order and conditional branches survive canonical comparison. Approval, permissions and safety requirements compare separately and conservatively (array order included). A wrong plan rejected by validation is semantic failure plus execution blocked, not safe unknown. Unsupported positive plans, unsafe assumptions, polarity/direction/slot errors, validation bypass and unexpected execution are separate counters. Actual execution can be unknown; backend admission is not iPhone execution evidence.

Precision denominator is generated plans (including rejected ones); recall denominator is oracle-plan cases; clarification denominator is clarification-required cases; abstention and unsafe denominators are all cases. Zero denominators remain explicit pairs, never fabricated 100%. Macro correctness averages expression-family case correctness equally. Aggregate categories and counts do not establish representative population rates. `NO_UNSAFE_OBSERVED` is not publication GO: supported exact-match and clarification thresholds must be frozen before any real benchmark. Wrong generated plans fail the gate even when execution was blocked.

## Blind governance

Development/regression are visible. Previously read LP1 and 104-case data are not new blind evidence. New blind cases require an independently authorized custodian and separate oracle review; no such person or corpus exists in this package. Freeze source-family assignment, code SHA, schema/oracle/snapshot/dependency hashes and acceptance thresholds before evaluation. Never split number-only variations randomly. Custodian-only input/oracle storage must be access controlled; input hashes are not secrecy. No plaintext blind corpus belongs in the developer repo.

`scorePilotCase` and leakage findings are custodian-only diagnostics. Developer blind output must use aggregate reporting, no case/family IDs, input, plan or individual result. Mixed blind/nonblind runs reject; blind aggregate requires >=5 cases. This small-cell rule is NOT differential privacy or an access-control system. Repeated queries can still leak; custodian must permit only a frozen one-shot report. The tooling cannot by itself keep data blind or enforce human separation.

If ANY blind category has fewer than five records, ALL category breakdowns are suppressed, so totals minus published categories cannot reconstruct a suppressed cell. Family scores are always null in blind reports, including singleton families. The global one-shot aggregate still is not privacy against arbitrary external auxiliary knowledge. Access control and custodian policy remain mandatory.

Observation consistency is mandatory: unknown/clarification cannot contain a plan or admission; plan/validation failure require a generated plan and requirements; clarification requires a question; validation failure cannot claim validation success or admission; execution requires admission. Individual scoring rejects inconsistent records. Aggregate scoring throws a redacted `PilotEvaluationError` with gate `EVALUATION_ERROR`, never a partial or passing report. Callers must surface this as evaluation failure, not catch it and label the run successful. Wrong generated plans rejected by validators remain distinct from safe unknown.

Any inspected failed blind case retires into regression. Aggregate-guided tuning also consumes independence: do not reuse that bank for the next final claim. Infrastructure-only reruns require a precommitted no-tuning policy and unchanged artifact, with no developer access to cases. Final report needs run ID, code SHA, dependency/config hashes, corpus/oracle hash and custodian signature outside this library; this package does not fabricate those credentials.

## Remaining HOLD

No 500-case generation (planned 200 positive/100 negative-direction/100 ambiguous/100 unsupported), no blind bank, no new grammar, no model activation, no Git or deployment authority. A synthetic fixture's passing score proves evaluator behavior, not language coverage, independence, model quality or production safety. Current modules return deterministic in-memory data only; they do not execute automation or write files.
