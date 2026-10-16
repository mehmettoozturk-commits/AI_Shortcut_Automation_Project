# PB-03: offline global budget and recovery protocol

Status: offline implementation, not real pilot authorization. Working tree based on
`2a10a37a8149d008865c5793968541c2f6613d4b`, 2026-10-16.
Audience: technical reviewers deciding whether the accounting protocol is testable;
not operators configuring a live provider.

## Scope and trust boundary

The new `pb03-*` modules model one pre-provisioned budget authority shared by all runs
and local journals. They never call a provider, fetch, SDK, filesystem, billing service,
or credential source. Existing LP2 and production code are unchanged.

`PB03MockWitness` is a deterministic in-memory authority. Its synchronous transaction
is the simulated atomic CAS boundary. This is **not** durable CAS, physical fsync,
an independent external service, a cryptographic attestation, or proof against rollback.
Its constructor is a test-provisioning seam, not a runtime create-budget operation.
All journals in one test must share the same witness instance. Creating a second
witness instance is creating a different mock authority, not a safe recovery strategy.

Real integration requires an independently provisioned identity/epoch, durable CAS,
anti-rollback evidence outside the witness's restore domain, and a bound provider/price
configuration. None exists in this implementation. A local hash chain, two files,
two SQLite databases, or a same-backup HMAC cannot provide that evidence.

Every snapshot explicitly reports `mode=offline_mock`, `realDispatchAllowed=false`,
and `physicalDurabilityVerified=false`. A simulated dispatch grant is only an integer
test counter. It contains no executable permit and invokes no callback or transport.

## Contract and accounting

Identity is `budgetId + epoch + configurationId`, with fixed integer calls/tokens/microUSD
limits and a 64-hex `pricingAssumptionHash` binding the synthetic price assumptions.
The complete configuration hash anchors the first checkpoint; the mock does not verify
the truth or provenance of the supplied price hash. Prices and token ceilings
are synthetic inputs; PB-02 must independently verify real billable categories and limits.
This work does not prove a real USD hard cap.

Every operation has a unique `operationId`. An identical ID/content replay is a no-op,
even after STOP, and never grants another simulated dispatch. The same ID with changed
content latches STOP. Distinct reserve/dispatch/settlement operations have distinct IDs.
An internal STOP ID cannot collide with an earlier supplied operation ID.

The witness separates reserved upper bounds from settled spend. Admission compares their
sum against all three global ceilings, with safe-integer overflow checks. Every reserve
charges one call and its full upper bound. Confirmed usage replaces that reservation;
unknown usage retains it in full and latches STOP. Actual usage exceeding the reservation
is recorded without clamping, then STOP is latched. Overflow cannot be accurately recorded
as a JS integer, so the reservation remains charged and the authority stops.

There is only one unresolved attempt globally. Each run permits one initial attempt and
at most one repair after a settled result explicitly requesting it. Configuration is fixed
for the entire authority, so repair cannot select a different model/price configuration.
New runs, empty journals, and deleted local caches cannot reduce witness totals.

## Operation sequence and crash windows

The local cache is a memory-only simulation of a last acknowledged journal checkpoint.
Fault points `after_witness`, `before_local_ack`, and `after_local_ack` model process failure
ordering; they do not execute disk writes or power-loss tests.

| Last acknowledged boundary | Recovery behavior | Additional simulated grants |
|---|---|---|
| Witness reserve | Preserve orphan reservation; STOP | 0 |
| Local reserve acknowledgement | Pending reservation; STOP on restart | 0 |
| Witness dispatch-intent | May have been sent; preserve charge; STOP | 0 |
| Local dispatch acknowledgement, before grant | Uncertain pending attempt; STOP | 0 |
| Simulated grant issued | Never issue again after restart | 0 |
| Witness settlement, missing local acknowledgement | Rebuild accounting checkpoint only | 0 |
| Local settlement acknowledgement | Compare checkpoints; same operation is idempotent | 0 |

Normal ledger operation is witness reserve CAS → simulated local acknowledgement →
witness dispatch-intent CAS → simulated local acknowledgement → one simulated grant →
witness settlement CAS → simulated local settlement acknowledgement.

The witness transaction result is authoritative. Local acknowledgement failure after reserve
or dispatch cannot be retried into a transport grant; the handle fails closed and requests
terminal global STOP. Reserved/dispatching records remain charged as uncertain pending work.
An explicit unknown settlement records `state=unknown` and also retains the full charge.

After a settlement commit followed by local failure, a valid older checkpoint whose entire
missing tail contains only settlements may be advanced for accounting reconciliation.
That recovery handle stays stopped: reconciliation never resumes the old run or calls AI.
A fresh handle may subsequently use a consistent, fully settled cache if the witness is not
terminally stopped. The settled attempt still cannot be dispatched again. An overrun settlement
keeps terminal STOP even when its local accounting is reconstructed.

Other local checkpoint mismatches are STOP, including a valid old backup missing reserve or
dispatch records. Malformed/wrong epoch checkpoints also cannot open the authority.
Matching checkpoints do not override an unresolved attempt or terminal STOP.

## STOP, unavailable authority, and stale locks

When the witness is reachable and its test proof is available, STOP is an irreversible latch
in that authority. No clear, refund, limit-increase, or new-budget recovery method exists.

When the witness is unavailable or rollback evidence is absent, the ledger fails closed
locally. It does **not** claim that a durable global STOP was written. Reconnection never
revives the failed handle. A new handle must revalidate independent evidence and all pending
records. Missing or uncertain dispatch/reserve state prevents continuation.

`simulateRollbackForTest` explicitly withdraws the mock's proof and causes reads/grants to
fail. This tests refusal when proof is unavailable. It cannot detect an unannounced rollback
of an actual service, nor can it detect restoring both a real witness and every high-water mark.
Actual rollback prevention remains OPEN.

The stale-lock input only classifies STOP; the implementation never deletes a lock or performs
OS process inspection. A real operator procedure must establish all writers are stopped,
retain audit evidence, reconcile authority identity/high-water mark and pending reservations,
and preserve terminal STOP. Removing a stale lock must not grant dispatch or create a new budget.
Such an operator tool and a durable witness are outside this offline scope.

## Tests and evidence boundaries

`tests/pb03-budget.test.ts` covers global multi-run spend, independent token/USD ceilings,
CAS conflict, same-ID idempotency/conflict, orphan reserve, dispatch crash windows, settlement
reconciliation, unknown/overrun, one repair, config/epoch mismatch, unreachable authority,
local rollback, missing independent rollback proof, terminal STOP, stale lock, numeric bounds,
detached snapshots, and simulated dispatch counts. A fetch spy confirms zero fetch calls.

Every crash test checks grant counts. The rollback-proof test rejects all access after the
explicit fault seam rather than pretending to verify physical anti-rollback protection.
Existing adapter mock tests in the full suite may use localhost; PB-03 itself uses no network.

Files: four new offline source modules (`pb03-types`, `pb03-witness`, `pb03-recovery`,
`pb03-ledger`), one test file, this document. No production import or activation is added.

## Remaining blockers

- PB-03 real independent durable/anti-rollback authority, security and power-loss evidence: OPEN.
- PB-02 real token/reasoning/price upper-bound verification: OPEN.
- PB-01 real provider compatibility and unsupported downstream representations: OPEN.
- PB-04 independent holdout review and PB-05 explicit API/key/cost authority: OPEN.
- Production, real SDK/provider, credentials, paid services, Render configuration/deploy: NO-GO.

Offline protocol tests may support closing only this implementation's mock scope. They do not
authorize pilot spend, deployment, or a claim that the overall budget blocker is closed.
