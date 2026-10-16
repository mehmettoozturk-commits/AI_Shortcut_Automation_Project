type DatabaseSync = import("node:sqlite").DatabaseSync;
import { createRequire } from "node:module";
// Vite 5's builtin list predates node:sqlite. Native Node resolution avoids
// transforming this builtin into a package import; no third-party adapter.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
import { closeSync, fsyncSync, lstatSync, openSync, realpathSync, statfsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

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
  private db: DatabaseSync | undefined;
  private failed = false;
  constructor(path: string, options: { enabled?: boolean; busyTimeoutMs?: number; clock?: () => Date } = {}) {
    this.clock = options.clock ?? (() => new Date());
    if (options.enabled !== true) throw new QuotaLedgerError("disabled");
    try {
      if (!isAbsolute(path) || path.includes("\0") || path !== resolve(path)) throw Error();
      // Existing, operator-owned parent only. Do not manufacture directories or
      // silently open a memory database, URI or remote mount.
      const parent = dirname(path);
      if (realpathSync(parent) !== parent) throw Error();
      const uid = process.getuid?.();
      const parentStat = lstatSync(parent);
      if (uid === undefined || !parentStat.isDirectory() || parentStat.uid !== uid || (parentStat.mode & 0o022) !== 0) throw Error();
      // Explicitly supported local mount types: macOS APFS/HFS, Linux ext,
      // tmpfs and overlay. Unknown/network filesystem types fail closed.
      if (![0x1a, 0x11, 0xef53, 0x01021994, 0x794c7630].includes(statfsSync(parent).type)) throw Error();
      let fd: number;
      try { fd = openSync(path, "wx", 0o600); }
      catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        const stat = lstatSync(path);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== uid || (stat.mode & 0o077) !== 0 || stat.nlink !== 1) throw Error();
        fd = openSync(path, "r+");
      }
      try { fsyncSync(fd); } finally { closeSync(fd); }
      const parentFd = openSync(parent, "r");
      try { fsyncSync(parentFd); } finally { closeSync(parentFd); }
      const timeout = options.busyTimeoutMs ?? 50;
      if (!Number.isInteger(timeout) || timeout < 0 || timeout > 1000) throw Error();
      this.db = new DatabaseSync(path, { timeout, allowExtension: false });
      this.db.exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=EXTRA; PRAGMA foreign_keys=ON;");
      this.configuration();
      this.db.exec("BEGIN IMMEDIATE");
      const objects = this.db.prepare("SELECT name FROM sqlite_schema WHERE sql IS NOT NULL").all();
      if (objects.length === 0) {
        for (const [, , ddl] of schema) this.db.exec(ddl);
        this.db.exec("INSERT INTO quota_meta VALUES(1,1)");
      }
      this.verifySchema();
      this.db.exec("COMMIT");
      if (this.db.prepare("PRAGMA quick_check").get()?.quick_check !== "ok" || this.db.prepare("SELECT version FROM quota_meta WHERE id=1").get()?.version !== 1) throw Error();
    } catch {
      try { this.db?.close(); } catch { /* Never grant after open/recovery failure. */ }
      this.db = undefined; this.failed = true; throw new QuotaLedgerError("unavailable");
    }
  }
  private readonly clock: () => Date;
  private verifySchema(): void {
    const actual = this.db!.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL").all();
    if (actual.length !== schema.length) throw Error();
    for (const [type, name, ddl] of schema) {
      const row = actual.find(row => row.name === name);
      if (!row || row.type !== type || row.tbl_name !== (type === "index" ? "quota_operations" : name) ||
          typeof row.sql !== "string" || canonicalSql(row.sql) !== canonicalSql(ddl)) throw Error();
    }
    const version = this.db!.prepare("SELECT id,version FROM quota_meta").all();
    if (version.length !== 1 || version[0]?.id !== 1 || version[0]?.version !== 1) throw Error();
  }
  private configuration(): void {
    const db = this.db!;
    if (db.prepare("PRAGMA journal_mode").get()?.journal_mode !== "delete" ||
        db.prepare("PRAGMA synchronous").get()?.synchronous !== 3 ||
        db.prepare("PRAGMA foreign_keys").get()?.foreign_keys !== 1) throw Error();
  }
  private validate(request: QuotaRequest): void {
    if (!request || !request.identity || !["anonymous", "account"].includes(request.identity.kind) ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(request.identity.subject) ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(request.operationId) || !/^[a-f0-9]{64}$/.test(request.semanticHash)) {
      throw new QuotaLedgerError("invalid_request");
    }
  }
  private transaction<T>(work: (db: DatabaseSync) => T): T {
    if (!this.db || this.failed) throw new QuotaLedgerError("unavailable");
    const db = this.db;
    try {
      this.configuration(); db.exec("BEGIN IMMEDIATE");
      const value = work(db); db.exec("COMMIT"); return value;
    } catch (error) {
      try { if (db.isTransaction) db.exec("ROLLBACK"); } catch { this.failed = true; }
      if (error instanceof QuotaLedgerError) throw error;
      // Includes BUSY, corruption, I/O and ambiguous COMMIT acknowledgement.
      // Conservatively require reopening/reconciliation after any DB error.
      this.failed = true; throw new QuotaLedgerError("unavailable");
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
    const db = this.db; this.db = undefined;
    try { db?.close(); } catch { this.failed = true; throw new QuotaLedgerError("unavailable"); }
  }
}
