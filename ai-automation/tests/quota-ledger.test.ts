type DatabaseSync = import("node:sqlite").DatabaseSync;
import { createRequire } from "node:module";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
import { mkdtempSync, rmSync, writeFileSync, chmodSync, realpathSync, statSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SqliteQuotaLedger, type QuotaRequest } from "../src/quota/sqlite-ledger.js";

vi.mock("node:fs", async original => {
  const fs = await original<typeof import("node:fs")>(); return { ...fs, lstatSync: vi.fn(fs.lstatSync) };
});
const nativeFs = await vi.importActual<typeof import("node:fs")>("node:fs");

const roots: string[] = [], repositories: SqliteQuotaLedger[] = [];
const at = "2026-10-16T23:59:59.000Z";
const req = (id = "one", subject = "verified-subject", kind: "account" | "anonymous" = "account"): QuotaRequest =>
  ({ identity: { kind, subject }, operationId: id, semanticHash: "a".repeat(64) });
const moduleUrl = new URL("../src/quota/sqlite-ledger.ts", import.meta.url).href;
const prefix = `import {SqliteQuotaLedger} from ${JSON.stringify(moduleUrl)};import {DatabaseSync} from 'node:sqlite';`;
function fixture() { const root = mkdtempSync(join(realpathSync(tmpdir()), "p3-quota-")); roots.push(root); return join(root, "quota.sqlite"); }
function open(path: string, clock = () => new Date(at), busyTimeoutMs = 50) {
  const r = new SqliteQuotaLedger(path, { enabled: true, clock, busyTimeoutMs }); repositories.push(r); return r;
}
function child(code: string) {
  return spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", prefix + code], { encoding: "utf8", timeout: 10000 });
}
afterEach(() => {
  vi.restoreAllMocks(); vi.mocked(lstatSync).mockImplementation(nativeFs.lstatSync); for (const r of repositories.splice(0)) r.close();
  // Only isolated test-owned directories are disposable.
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("P3 real SQLite DELETE/EXTRA quota persistence (not production activation)", () => {
  it("is disabled by default and does not create a DB", () => {
    const p = fixture(); expect(() => new SqliteQuotaLedger(p)).toThrow("disabled");
    expect(() => new DatabaseSync(p, { readOnly: true })).toThrow();
  });
  it("enforces three creations, persists restart and keeps identities separate", () => {
    const p = fixture(), r = open(p);
    for (let i = 0; i < 3; i++) expect(r.reserve(req(String(i))).created).toBe(true);
    expect(() => r.reserve(req("four"))).toThrow("limit"); r.close();
    const again = open(p); expect(() => again.reserve(req("four"))).toThrow("limit");
    expect(again.reserve(req("four", "other")).created).toBe(true);
    expect(again.reserve(req("four", "verified-subject", "anonymous")).created).toBe(true);
  });
  it("same operation is idempotent across UTC midnight; same semantics/new IDs are separate", () => {
    let now = new Date(at); const r = open(fixture(), () => now);
    const a = r.reserve(req()); now = new Date("2026-10-17T00:00:01Z");
    expect(r.reserve(req())).toEqual({ created: false, operation: a.operation });
    for (let i = 0; i < 3; i++) expect(r.reserve(req(`next-${i}`)).created).toBe(true);
    expect(() => r.reserve(req("next-4"))).toThrow("limit");
    expect(() => r.reserve({ ...req(), semanticHash: "b".repeat(64) })).toThrow("conflict");
  });
  it("grants dispatch once across connections, not again after settlement/restart", () => {
    const p = fixture(), a = open(p), b = open(p); a.reserve(req());
    expect(a.authorizeDispatch(req()).granted).toBe(true);
    expect(b.authorizeDispatch(req()).granted).toBe(false);
    expect(b.settle(req(), "COMPLETED", "result-opaque").resultReference).toBe("result-opaque");
    expect(a.settle(req(), "COMPLETED", "result-opaque").state).toBe("COMPLETED");
    expect(() => a.settle(req(), "FAILED_AFTER_DISPATCH")).toThrow("invalid_transition");
    a.close(); b.close(); expect(open(p).authorizeDispatch(req()).granted).toBe(false);
  });
  it.each(["FAILED_AFTER_DISPATCH", "OUTCOME_UNKNOWN"] as const)("%s never refunds or resends", state => {
    const r = open(fixture()); r.reserve(req()); r.authorizeDispatch(req()); r.settle(req(), state);
    expect(r.authorizeDispatch(req()).granted).toBe(false);
    expect(() => r.cancelBeforeDispatch(req())).toThrow("invalid_transition");
    r.reserve(req("two")); r.reserve(req("three")); expect(() => r.reserve(req("four"))).toThrow("limit");
  });
  it("only confirmed pre-dispatch cancellation releases; cancelled operation cannot be revived", () => {
    const r = open(fixture()); r.reserve(req()); r.cancelBeforeDispatch(req());
    expect(r.cancelBeforeDispatch(req()).state).toBe("RELEASED");
    expect(r.reserve(req()).created).toBe(false); expect(r.authorizeDispatch(req()).granted).toBe(false);
    for (let i = 0; i < 3; i++) r.reserve(req(`new-${i}`));
    expect(() => r.reserve(req("four"))).toThrow("limit");
  });
  it("rejects settlement without dispatch and malformed identity/hash/operation", () => {
    const r = open(fixture()); expect(() => r.authorizeDispatch(req())).toThrow("invalid_transition");
    r.reserve(req()); expect(() => r.settle(req(), "COMPLETED")).toThrow("invalid_transition");
    for (const v of [{ ...req(), semanticHash: "not-a-hash" }, req(""), req("ok", "contains space")]) expect(() => r.reserve(v)).toThrow("invalid_request");
  });
  it("has actual DELETE/EXTRA/FK settings and private database permissions", () => {
    const p = fixture(); open(p); expect(statSync(p).mode & 0o777).toBe(0o600); const db = new DatabaseSync(p);
    // synchronous and FK are connection scoped; inspect the repository connection
    // via the native prepare call rather than assuming a second connection inherits them.
    expect(db.prepare("PRAGMA journal_mode").get()?.journal_mode).toBe("delete"); db.close();
    const seen: string[] = []; const original = DatabaseSync.prototype.prepare;
    vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (this: DatabaseSync, sql: string) { seen.push(sql); return original.call(this, sql); });
    open(p).reserve(req()); expect(seen).toContain("PRAGMA synchronous"); expect(seen).toContain("PRAGMA foreign_keys");
  });
  it.each(["journal_mode=DELETE", "synchronous=EXTRA", "foreign_keys=ON"])("rejects ineffective configuration %s", setting => {
    const original = DatabaseSync.prototype.exec;
    vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (this: DatabaseSync, sql: string) {
      const replacement = setting.startsWith("journal") ? "journal_mode=MEMORY" : setting.startsWith("synchronous") ? "synchronous=OFF" : "foreign_keys=OFF";
      return original.call(this, sql.replace(setting, replacement));
    });
    expect(() => open(fixture())).toThrow("unavailable");
  });
  it("fails closed for unavailable path, corrupt file and publicly readable DB", () => {
    expect(() => open(join(fixture(), "missing.sqlite"))).toThrow("unavailable");
    const corrupt = fixture(); writeFileSync(corrupt, "not a SQLite database", { mode: 0o600 }); expect(() => open(corrupt)).toThrow("unavailable");
    const publicFile = fixture(); writeFileSync(publicFile, ""); chmodSync(publicFile, 0o644); expect(() => open(publicFile)).toThrow("unavailable");
    expect(() => open(":memory:")).toThrow("unavailable");
  });
  it("rejects group/other-writable parent directories", () => {
    const p = fixture(), parent = join(p, ".."); chmodSync(parent, 0o770);
    expect(() => open(p)).toThrow("unavailable"); chmodSync(parent, 0o700);
  });
  it.each(["parent", "file"])("rejects foreign UID ownership of %s", target => {
    const p = fixture(); open(p).close();
    vi.mocked(lstatSync).mockImplementation((path, options) => {
      const stat = nativeFs.lstatSync(path, options as never);
      if ((target === "file") === (String(path) === p)) return Object.assign(stat, { uid: (process.getuid?.() ?? 0) + 1 });
      return stat;
    });
    expect(() => open(p)).toThrow("unavailable");
  });
  it.each(["primary key", "not null", "strict", "state constraint", "kind constraint", "column type", "trigger"])("rejects altered V1 schema: %s", change => {
    const p = fixture(); open(p).close(); const db = new DatabaseSync(p);
    if (change === "trigger") db.exec("CREATE TRIGGER unexpected AFTER INSERT ON quota_operations BEGIN DELETE FROM quota_operations; END");
    else {
      const original = String(db.prepare("SELECT sql FROM sqlite_schema WHERE name='quota_operations'").get()?.sql);
      const changed = change === "primary key" ? original.replace(", PRIMARY KEY(kind,subject,operation_id)", "")
        : change === "not null" ? original.replace("subject TEXT NOT NULL", "subject TEXT")
        : change === "strict" ? original.replace(/STRICT$/, "")
        : change === "state constraint" ? original.replace("'OUTCOME_UNKNOWN'", "'OTHER'")
        : change === "kind constraint" ? original.replace("'anonymous'", "'guest'")
        : original.replace("subject TEXT", "subject BLOB");
      expect(changed).not.toBe(original); db.exec("DROP TABLE quota_operations"); db.exec(changed);
      db.exec("CREATE INDEX quota_daily ON quota_operations(kind,subject,utc_day,state)");
    }
    expect(db.prepare("PRAGMA quick_check").get()?.quick_check).toBe("ok"); db.close();
    expect(() => open(p)).toThrow("unavailable");
  });
  it("accepts V1 whitespace/case formatting differences without weakening quoted constraints", () => {
    const p = fixture(); open(p).close(); const db = new DatabaseSync(p);
    const original = String(db.prepare("SELECT sql FROM sqlite_schema WHERE name='quota_operations'").get()?.sql);
    db.exec("DROP TABLE quota_operations"); db.exec(original.replace("CREATE TABLE", "create   table").replace("subject TEXT", "subject\nTEXT"));
    db.exec("CREATE INDEX quota_daily ON quota_operations(kind,subject,utc_day,state)"); db.close();
    expect(open(p).reserve(req()).created).toBe(true);
  });
  it("BUSY is bounded, latches failure and never grants a reservation", () => {
    const p = fixture(), r = open(p, undefined, 20), blocker = new DatabaseSync(p);
    blocker.exec("BEGIN IMMEDIATE"); const start = performance.now();
    try { expect(() => r.reserve(req())).toThrow("unavailable"); expect(performance.now() - start).toBeLessThan(1000); }
    finally { blocker.exec("ROLLBACK"); blocker.close(); }
    expect(() => r.reserve(req())).toThrow("unavailable"); expect(open(p).reserve(req()).created).toBe(true);
  });
  it.each([false, true])("separate processes preserve quota and reservation uniqueness (shared operation=%s)", async shared => {
    const p = fixture(); open(p).close();
    const children = Array.from({ length: 8 }, (_, i) => spawn(process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", prefix + `const r=new SqliteQuotaLedger(${JSON.stringify(p)},{enabled:true,busyTimeoutMs:1000});process.send('ready');process.on('message',()=>{try{process.send({created:r.reserve(${JSON.stringify(req(shared ? "same" : String(i)))}).created})}catch(e){process.send({code:e.code})}r.close();process.exit(0)})`],
      { stdio: ["ignore", "ignore", "pipe", "ipc"] }));
    const ready = children.map(c => new Promise<void>((resolve, reject) => { c.once("message", () => resolve()); c.once("error", reject); c.once("exit", code => { if (code) reject(Error(`child startup ${code}`)); }); }));
    try {
      await Promise.all(ready);
      const results = children.map(c => new Promise<{created?: boolean; code?: string}>((resolve, reject) => { c.once("message", x => resolve(x as {created?: boolean;code?:string})); c.once("error", reject); }));
      for (const c of children) c.send("go");
      const values = await Promise.all(results); expect(values.filter(x => x.created).length).toBe(shared ? 1 : 3);
      expect(values.filter(x => x.code === "limit").length).toBe(shared ? 0 : 5);
    } finally { await Promise.all(children.map(c => c.exitCode !== null ? Promise.resolve() : new Promise<void>(resolve => { c.once("exit", () => resolve()); c.kill(); }))); }
  }, 20000);
  it("separate processes racing one operation obtain exactly one dispatch authorization", async () => {
    const p = fixture(); open(p).reserve(req());
    // Each child independently opens and commits against the same on-disk PK/state.
    const run = () => new Promise<boolean>((resolve, reject) => {
      const c = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", prefix + `const r=new SqliteQuotaLedger(${JSON.stringify(p)},{enabled:true,busyTimeoutMs:1000});console.log(r.authorizeDispatch(${JSON.stringify(req())}).granted);r.close();`]);
      let out = "", err = ""; c.stdout.on("data", b => out += b); c.stderr.on("data", b => err += b); c.once("error", reject);
      c.once("exit", code => code === 0 ? resolve(out.trim() === "true") : reject(Error(err)));
    });
    expect((await Promise.all(Array.from({ length: 5 }, run))).filter(Boolean)).toHaveLength(1);
  }, 20000);
  it("real process exit before COMMIT rolls back an uncommitted reservation", () => {
    const p = fixture(); open(p).close();
    const result = child(`const db=new DatabaseSync(${JSON.stringify(p)});db.exec("PRAGMA journal_mode=DELETE;PRAGMA synchronous=EXTRA;BEGIN IMMEDIATE;INSERT INTO quota_operations VALUES('account','verified-subject','one','${"a".repeat(64)}','2026-10-16','RESERVED',NULL)");process.exit(71);`);
    expect(result.status, result.stderr).toBe(71); expect(open(p).reserve(req()).created).toBe(true);
  });
  it.each([false, true])("real exit after reserve/dispatch commit survives reopen (dispatch=%s)", dispatch => {
    const p = fixture(); open(p).close();
    const result = child(`const r=new SqliteQuotaLedger(${JSON.stringify(p)},{enabled:true,clock:()=>new Date(${JSON.stringify(at)})});r.reserve(${JSON.stringify(req())});${dispatch ? `r.authorizeDispatch(${JSON.stringify(req())});` : ""}process.exit(72);`);
    expect(result.status, result.stderr).toBe(72); const r = open(p);
    expect(r.reserve(req()).operation.state).toBe(dispatch ? "DISPATCH_AUTHORIZED" : "RESERVED");
    r.reserve(req("two")); r.reserve(req("three")); expect(() => r.reserve(req("four"))).toThrow("limit");
    if (dispatch) expect(r.authorizeDispatch(req()).granted).toBe(false);
  });
  it("reports synchronous transaction latency as local measurement, not network capacity", () => {
    const r = open(fixture()); const samples: number[] = [];
    for (let i = 0; i < 30; i++) { const start = performance.now(); r.reserve(req(`op-${i}`, `subject-${i}`)); samples.push(performance.now() - start); }
    samples.sort((a,b) => a-b); console.info("P3 local synchronous transaction ms", { mean: samples.reduce((a,b)=>a+b,0)/samples.length, p95: samples[Math.ceil(samples.length*0.95)-1] });
    expect(samples.every(Number.isFinite)).toBe(true);
  });
  it("a lost COMMIT acknowledgement latches failure without a second reservation/dispatch", () => {
    const p = fixture(), r = open(p), original = DatabaseSync.prototype.exec;
    let fail = true;
    vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function(this: DatabaseSync, sql: string) {
      const result = original.call(this, sql);
      if (sql === "COMMIT" && fail) { fail = false; throw Error("synthetic acknowledgement lost"); }
      return result;
    });
    expect(() => r.reserve(req())).toThrow("unavailable");
    expect(() => r.authorizeDispatch(req())).toThrow("unavailable");
    vi.restoreAllMocks(); const reopened = open(p);
    expect(reopened.reserve(req()).created).toBe(false);
    expect(reopened.authorizeDispatch(req()).granted).toBe(true);
    expect(reopened.authorizeDispatch(req()).granted).toBe(false);
  });
  it("a transaction exception before COMMIT rolls back and produces no successful result", () => {
    const p = fixture(), r = open(p), original = DatabaseSync.prototype.exec;
    vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function(this: DatabaseSync, sql: string) {
      if (sql === "COMMIT") throw Error("synthetic precommit failure");
      return original.call(this, sql);
    });
    expect(() => r.reserve(req())).toThrow("unavailable"); vi.restoreAllMocks();
    expect(open(p).reserve(req()).created).toBe(true);
  });
  it("lost dispatch COMMIT acknowledgement cannot reauthorize after restart", () => {
    const p = fixture(), r = open(p); r.reserve(req());
    const original = DatabaseSync.prototype.exec;
    vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function(this: DatabaseSync, sql: string) {
      const value = original.call(this, sql);
      if (sql === "COMMIT") throw Error("synthetic lost dispatch acknowledgement");
      return value;
    });
    expect(() => r.authorizeDispatch(req())).toThrow("unavailable"); vi.restoreAllMocks();
    const reopened = open(p); expect(reopened.authorizeDispatch(req()).granted).toBe(false);
    expect(() => reopened.cancelBeforeDispatch(req())).toThrow("invalid_transition");
  });
  it("measures actual timer delay caused by synchronous work without claiming throughput", async () => {
    const r = open(fixture()); const start = performance.now();
    const timer = new Promise<number>(resolve => setTimeout(() => resolve(performance.now() - start), 0));
    for (let i=0;i<30;i++) r.reserve(req(`event-${i}`, `timer-${i}`));
    const blocking = performance.now()-start, delay = await timer;
    console.info("P3 local event-loop blocking ms", { synchronousBatch: blocking, timerDelay: delay });
    expect(delay).toBeGreaterThanOrEqual(blocking);
  });
});
