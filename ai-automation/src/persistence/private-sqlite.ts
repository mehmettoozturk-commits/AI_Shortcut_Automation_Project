import { createRequire } from "node:module";
import { closeSync, fsyncSync, lstatSync, openSync, realpathSync, statfsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
export type SqliteConnection = import("node:sqlite").DatabaseSync;
export class PrivateSqliteUnavailable extends Error {
  constructor() { super("Private storage unavailable"); }
}
/** Local single-host storage, not independent backup/rollback protection.
 * tmpfs/overlay support is for tests, NOT proof of a persistent production volume.
 * Assumes trusted local operator; ownership checks do not eliminate all TOCTOU.
 */
export class PrivateSqlite {
  private db: SqliteConnection | undefined;
  private failed = false;
  constructor(path: string, initialize: (db: SqliteConnection) => void, busyTimeoutMs = 50) {
    try {
      // Disabled HTTP/quota paths must not eagerly load an experimental builtin.
      const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
      if (!isAbsolute(path) || path.includes("\0") || path !== resolve(path)) throw Error();
      const parent = dirname(path), uid = process.getuid?.(), stat = lstatSync(parent);
      if (realpathSync(parent) !== parent || uid === undefined || !stat.isDirectory() || stat.uid !== uid || (stat.mode & 0o022) !== 0) throw Error();
      if (![0x1a, 0x11, 0xef53, 0x01021994, 0x794c7630].includes(statfsSync(parent).type)) throw Error();
      let fd: number;
      try { fd = openSync(path, "wx", 0o600); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const file = lstatSync(path);
        if (!file.isFile() || file.isSymbolicLink() || file.uid !== uid || (file.mode & 0o077) !== 0 || file.nlink !== 1) throw Error();
        fd = openSync(path, "r+");
      }
      try { fsyncSync(fd); } finally { closeSync(fd); }
      const dir = openSync(parent, "r"); try { fsyncSync(dir); } finally { closeSync(dir); }
      if (!Number.isInteger(busyTimeoutMs) || busyTimeoutMs < 0 || busyTimeoutMs > 1000) throw Error();
      this.db = new DatabaseSync(path, { timeout: busyTimeoutMs, allowExtension: false });
      this.db.exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=EXTRA; PRAGMA foreign_keys=ON;");
      this.transaction(initialize);
      if (this.db.prepare("PRAGMA quick_check").get()?.quick_check !== "ok") throw Error();
    } catch {
      try { this.db?.close(); } catch { /* Original uncertainty remains failure. */ }
      this.db = undefined; this.failed = true; throw new PrivateSqliteUnavailable();
    }
  }
  private configuration(db: SqliteConnection): void {
    if (db.prepare("PRAGMA journal_mode").get()?.journal_mode !== "delete" ||
        db.prepare("PRAGMA synchronous").get()?.synchronous !== 3 || db.prepare("PRAGMA foreign_keys").get()?.foreign_keys !== 1) throw Error();
  }
  transaction<T>(work: (db: SqliteConnection) => T, controlled: (error: unknown) => boolean = () => false): T {
    if (!this.db || this.failed) throw new PrivateSqliteUnavailable();
    const db = this.db;
    try {
      this.configuration(db); db.exec("BEGIN IMMEDIATE");
      const value = work(db); db.exec("COMMIT"); return value;
    } catch (error) {
      try { if (db.isTransaction) db.exec("ROLLBACK"); } catch { this.failed = true; }
      if (controlled(error)) throw error;
      this.failed = true; throw new PrivateSqliteUnavailable();
    }
  }
  close(): void {
    const db = this.db; this.db = undefined;
    try { db?.close(); } catch { this.failed = true; throw new PrivateSqliteUnavailable(); }
  }
}
