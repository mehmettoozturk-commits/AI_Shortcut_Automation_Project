import { PrivateSqlite, type SqliteConnection as DatabaseSync } from "../persistence/private-sqlite.js";

export type QuotaIdentity = Readonly<{ kind: "anonymous" | "account"; subject: string }>;
export type QuotaRequest = Readonly<{ identity: QuotaIdentity; operationId: string; semanticHash: string }>;
export type QuotaState = "RESERVED" | "RELEASED" | "DISPATCH_AUTHORIZED" | "COMPLETED" | "FAILED_AFTER_DISPATCH" | "OUTCOME_UNKNOWN";
export interface QuotaOperation {
  readonly kind: string; readonly subject: string; readonly operationId: string;
  readonly semanticHash: string; readonly utcDay: string; readonly state: QuotaState;
  readonly resultReference: string | null;
}
export class QuotaLedgerError extends Error {
  constructor(readonly code: "disabled" | "unavailable" | "invalid_request" | "conflict" | "limit" | "invalid_transition") {
    super(`Quota ledger: ${code}`); this.name = "QuotaLedgerError";
  }
}
type Row = Record<string, unknown>;
const schema = [
  ["table", "quota_meta", "CREATE TABLE quota_meta (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL CHECK(version=1)) STRICT"],
  ["table", "quota_operations", `CREATE TABLE quota_operations (
    kind TEXT NOT NULL CHECK(kind IN ('anonymous','account')), subject TEXT NOT NULL,
    operation_id TEXT NOT NULL, semantic_hash TEXT NOT NULL, utc_day TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('RESERVED','RELEASED','DISPATCH_AUTHORIZED','COMPLETED','FAILED_AFTER_DISPATCH','OUTCOME_UNKNOWN')),
    result_reference TEXT, PRIMARY KEY(kind,subject,operation_id)
  ) STRICT`],
  ["index", "quota_daily", "CREATE INDEX quota_daily ON quota_operations(kind,subject,utc_day,state)"],
] as const;
// Controlled V1 fingerprint: ignore casing/whitespace OUTSIDE literals only.
// Equivalent migration/reordered definitions are deliberately not auto-accepted.
function canonicalSql(sql: string): string {
  return (sql.match(/'(?:''|[^'])*'|[^']+/g) ?? []).map(part => part.startsWith("'") ? part : part.replace(/\s+/g, "").toLowerCase()).join("");
}
/** Local, single-host authority only. Not wired into HTTP, providers or production.
 * Callers must supply SERVER-VERIFIED identity and a canonical request hash.
 * No retention deletion, inferred refunds, network waits or automatic dispatch retry.
 */
export class SqliteQuotaLedger {
  private storage: PrivateSqlite;
  constructor(path: string, options: { enabled?: boolean; busyTimeoutMs?: number; clock?: () => Date } = {}) {
    this.clock = options.clock ?? (() => new Date());
    if (options.enabled !== true) throw new QuotaLedgerError("disabled");
    try {
      this.storage = new PrivateSqlite(path, db => {
        const objects = db.prepare("SELECT name FROM sqlite_schema WHERE sql IS NOT NULL").all();
        if (objects.length === 0) {
          for (const [, , ddl] of schema) db.exec(ddl);
          db.exec("INSERT INTO quota_meta VALUES(1,1)");
        }
        this.verifySchema(db);
      }, options.busyTimeoutMs);
    } catch {
      throw new QuotaLedgerError("unavailable");
    }
  }
  private readonly clock: () => Date;
  private verifySchema(db: DatabaseSync): void {
    const actual = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL").all();
    if (actual.length !== schema.length) throw Error();
    for (const [type, name, ddl] of schema) {
      const row = actual.find(row => row.name === name);
      if (!row || row.type !== type || row.tbl_name !== (type === "index" ? "quota_operations" : name) ||
          typeof row.sql !== "string" || canonicalSql(row.sql) !== canonicalSql(ddl)) throw Error();
    }
    const version = db.prepare("SELECT id,version FROM quota_meta").all();
    if (version.length !== 1 || version[0]?.id !== 1 || version[0]?.version !== 1) throw Error();
  }
  private validate(request: QuotaRequest): void {
    if (!request || !request.identity || !["anonymous", "account"].includes(request.identity.kind) ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(request.identity.subject) ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(request.operationId) || !/^[a-f0-9]{64}$/.test(request.semanticHash)) {
      throw new QuotaLedgerError("invalid_request");
    }
  }
  private transaction<T>(work: (db: DatabaseSync) => T): T {
    try {
      return this.storage.transaction(work, error => error instanceof QuotaLedgerError);
    } catch (error) {
      if (error instanceof QuotaLedgerError) throw error;
      throw new QuotaLedgerError("unavailable");
    }
  }
  private row(db: DatabaseSync, r: QuotaRequest): QuotaOperation | null {
    const row = db.prepare("SELECT * FROM quota_operations WHERE kind=? AND subject=? AND operation_id=?")
      .get(r.identity.kind, r.identity.subject, r.operationId) as Row | undefined;
    if (!row) return null;
    if (row.semantic_hash !== r.semanticHash) throw new QuotaLedgerError("conflict");
    return Object.freeze({ kind: row.kind as string, subject: row.subject as string, operationId: row.operation_id as string,
      semanticHash: row.semantic_hash as string, utcDay: row.utc_day as string, state: row.state as QuotaState,
      resultReference: row.result_reference as string | null });
  }
  reserve(request: QuotaRequest): { created: boolean; operation: QuotaOperation } {
    this.validate(request);
    return this.transaction(db => {
      const old = this.row(db, request);
      if (old) return { created: false, operation: old };
      const now = this.clock();
      if (!Number.isFinite(now.getTime())) throw new QuotaLedgerError("invalid_request");
      const day = now.toISOString().slice(0, 10);
      const used = db.prepare("SELECT count(*) AS n FROM quota_operations WHERE kind=? AND subject=? AND utc_day=? AND state!='RELEASED'")
        .get(request.identity.kind, request.identity.subject, day)?.n;
      if (typeof used !== "number") throw Error();
      if (used >= 3) throw new QuotaLedgerError("limit");
      db.prepare("INSERT INTO quota_operations VALUES(?,?,?,?,?,'RESERVED',NULL)")
        .run(request.identity.kind, request.identity.subject, request.operationId, request.semanticHash, day);
      return { created: true, operation: this.row(db, request)! };
    });
  }
  /** A single-use logical dispatch authorization, not proof of network delivery.
   * This repository alone cannot authorize SDK calls or repair calls.
   */
  authorizeDispatch(request: QuotaRequest): { granted: boolean; operation: QuotaOperation } {
    this.validate(request);
    return this.transaction(db => {
      const row = this.row(db, request);
      if (!row) throw new QuotaLedgerError("invalid_transition");
      if (row.state !== "RESERVED") return { granted: false, operation: row };
      this.update(db, request, "DISPATCH_AUTHORIZED", null);
      return { granted: true, operation: this.row(db, request)! };
    });
  }
  cancelBeforeDispatch(request: QuotaRequest): QuotaOperation {
    this.validate(request);
    return this.transaction(db => {
      const row = this.row(db, request);
      if (!row || !["RESERVED", "RELEASED"].includes(row.state)) throw new QuotaLedgerError("invalid_transition");
      if (row.state === "RESERVED") this.update(db, request, "RELEASED", null);
      return this.row(db, request)!;
    });
  }
  settle(request: QuotaRequest, state: "COMPLETED" | "FAILED_AFTER_DISPATCH" | "OUTCOME_UNKNOWN", resultReference: string | null = null): QuotaOperation {
    this.validate(request);
    if (!["COMPLETED", "FAILED_AFTER_DISPATCH", "OUTCOME_UNKNOWN"].includes(state) ||
        (resultReference !== null && (!/^[A-Za-z0-9_-]{1,128}$/.test(resultReference) || state !== "COMPLETED"))) throw new QuotaLedgerError("invalid_request");
    return this.transaction(db => {
      const row = this.row(db, request);
      if (!row) throw new QuotaLedgerError("invalid_transition");
      if (row.state === state && row.resultReference === resultReference) return row;
      if (row.state !== "DISPATCH_AUTHORIZED") throw new QuotaLedgerError("invalid_transition");
      this.update(db, request, state, resultReference); return this.row(db, request)!;
    });
  }
  private update(db: DatabaseSync, r: QuotaRequest, state: QuotaState, reference: string | null): void {
    db.prepare("UPDATE quota_operations SET state=?,result_reference=? WHERE kind=? AND subject=? AND operation_id=?")
      .run(state, reference, r.identity.kind, r.identity.subject, r.operationId);
  }
  close(): void {
    try { this.storage.close(); } catch { throw new QuotaLedgerError("unavailable"); }
  }
}
