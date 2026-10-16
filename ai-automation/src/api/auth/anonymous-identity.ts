import { createHash, randomBytes } from "node:crypto";
import { PrivateSqlite, type SqliteConnection } from "../../persistence/private-sqlite.js";

const TTL = 30 * 24 * 60 * 60_000;
const ddl = [
  "CREATE TABLE anonymous_meta (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL CHECK(version=1)) STRICT",
  `CREATE TABLE anonymous_credentials (
    token_hash TEXT PRIMARY KEY NOT NULL, subject TEXT UNIQUE NOT NULL,
    issued_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER,
    CHECK(expires_at=issued_at+2592000000)
  ) STRICT`,
];
const canonical = (sql: string) => (sql.match(/'(?:''|[^'])*'|[^']+/g) ?? []).map(p => p.startsWith("'") ? p : p.replace(/\s+/g, "").toLowerCase()).join("");
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
export const validAnonymousToken = (value: unknown): value is string => typeof value === "string" &&
  /^[A-Za-z0-9_-]{43}$/.test(value) && Buffer.from(value, "base64url").toString("base64url") === value;
export class AnonymousStorageUnavailable extends Error {
  constructor() { super("Anonymous identity storage unavailable"); }
}
export type VerifiedAnonymousIdentity = Readonly<{ subject: string }>;
/** Server-issued identity, not a person/device guarantee, entitlement or quota.
 * No renewal or retention cleanup; expiry is credential lifetime only.
 */
export class AnonymousIdentityService {
  private readonly storage: PrivateSqlite;
  constructor(path: string, private readonly clock: () => number = Date.now) {
    try {
      this.storage = new PrivateSqlite(path, db => {
        const rows = db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL").all();
        if (rows.length === 0) {
          for (const sql of ddl) db.exec(sql);
          db.exec("INSERT INTO anonymous_meta VALUES(1,1)");
        }
        const actual = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL").all();
        if (actual.length !== 2) throw Error();
        for (const [i, name] of ["anonymous_meta", "anonymous_credentials"].entries()) {
          const row = actual.find(r => r.name === name);
          if (!row || row.type !== "table" || row.tbl_name !== name || typeof row.sql !== "string" || canonical(row.sql) !== canonical(ddl[i]!)) throw Error();
        }
        const version = db.prepare("SELECT id,version FROM anonymous_meta").all();
        if (version.length !== 1 || version[0]?.id !== 1 || version[0]?.version !== 1) throw Error();
      });
    } catch { throw new AnonymousStorageUnavailable(); }
  }
  private now(): number {
    const now = this.clock(); if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(now + TTL)) throw new AnonymousStorageUnavailable(); return now;
  }
  private transaction<T>(work: (db: SqliteConnection) => T): T {
    try { return this.storage.transaction(work); } catch { throw new AnonymousStorageUnavailable(); }
  }
  issue(): Readonly<{ token: string; expiresAt: string }> {
    const token = randomBytes(32).toString("base64url"), subject = randomBytes(24).toString("base64url");
    const now = this.now(), expires = now + TTL;
    return this.transaction(db => {
      db.prepare("INSERT INTO anonymous_credentials VALUES(?,?,?,?,NULL)").run(hash(token), subject, now, expires);
      return Object.freeze({ token, expiresAt: new Date(expires).toISOString() });
    }); // Result escapes ONLY after COMMIT acknowledgement.
  }
  verify(token: string): VerifiedAnonymousIdentity | null {
    if (!validAnonymousToken(token)) return null;
    return this.transaction(db => {
      const row = db.prepare("SELECT subject,expires_at,revoked_at FROM anonymous_credentials WHERE token_hash=?").get(hash(token));
      return row && row.revoked_at === null && typeof row.expires_at === "number" && row.expires_at > this.now() && typeof row.subject === "string"
        ? Object.freeze({ subject: row.subject }) : null;
    });
  }
  revoke(token: string): boolean {
    if (!validAnonymousToken(token)) return false;
    return this.transaction(db => {
      const now = this.now();
      return db.prepare("UPDATE anonymous_credentials SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL AND expires_at>?").run(now, hash(token), now).changes === 1;
    });
  }
  close(): void { try { this.storage.close(); } catch { throw new AnonymousStorageUnavailable(); } }
}
