import { mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthDataIntegrityError, FileBackedAuthRepository, InMemoryAuthRepository } from "../src/api/auth/repository.js";

vi.mock("node:fs", async original => {
  const actual = await original<typeof import("node:fs")>();
  return { ...actual, renameSync: vi.fn(actual.renameSync), writeFileSync: vi.fn(actual.writeFileSync) };
});
afterEach(() => vi.clearAllMocks());
const now = "2026-10-14T00:00:00.000Z";
const input = (id = "s1") => ({ id, tokenHash: id, createdAt: now, expiresAt: "2027-01-01T00:00:00.000Z" });
function disk() { const dir = mkdtempSync(join(tmpdir(), "rh04-create-")); const path = join(dir, "auth.json"); const repo = new FileBackedAuthRepository(path); return { dir, path, repo }; }
describe("RH04 atomic user + initial session", () => {
  it("C01 creates user and session together with one persist", () => {
    const x = disk(); try {
      const r = x.repo.createUserWithInitialSession("a", input()); expect(r.status).toBe("created");
      if (r.status !== "created") throw new Error("expected created");
      expect(x.repo.findSession("s1", now)?.userId).toBe(r.user.id); expect(vi.mocked(renameSync)).toHaveBeenCalledTimes(1);
    } finally { rmSync(x.dir, { recursive: true, force: true }); }
  });
  it("C02 existing subject returns account_exists", () => { const r = new InMemoryAuthRepository(); r.getOrCreateUser("a", now); expect(r.createUserWithInitialSession("a", input())).toEqual({ status: "account_exists" }); });
  it("C03 repeat creation cannot duplicate user", () => { const r = new InMemoryAuthRepository(); r.createUserWithInitialSession("a", input()); expect(r.createUserWithInitialSession("a", input("s2")).status).toBe("account_exists"); expect(r.findSession("s2", now)).toBeNull(); });
  it("C04 scheduled concurrent creation permits one account", async () => { const r = new InMemoryAuthRepository(); const results = await Promise.all([1, 2].map(n => Promise.resolve().then(() => r.createUserWithInitialSession("a", input(`s${n}`))))); expect(results.map(x => x.status)).toEqual(["created", "account_exists"]); });
  it("C05 distinct subjects get distinct users", () => { const r = new InMemoryAuthRepository(); const a = r.createUserWithInitialSession("a", input()); const b = r.createUserWithInitialSession("b", input("s2")); expect(a.status === "created" && b.status === "created" && a.user.id !== b.user.id).toBe(true); });
  it.each(["write", "rename"])("C06/C07 %s failure preserves memory and disk", async stage => {
    const x = disk(); const actual = await vi.importActual<typeof import("node:fs")>("node:fs"); try {
      x.repo.createUserWithInitialSession("existing", input()); const before = readFileSync(x.path, "utf8");
      if (stage === "write") vi.mocked(writeFileSync).mockImplementationOnce(file => { actual.writeFileSync(file, "partial"); throw new Error("write failure"); });
      else vi.mocked(renameSync).mockImplementationOnce(() => { throw new Error("rename failure"); });
      expect(() => x.repo.createUserWithInitialSession("new", input("new"))).toThrow(); expect(x.repo.findSession("new", now)).toBeNull(); expect(readFileSync(x.path, "utf8")).toBe(before);
      expect(x.repo.createUserWithInitialSession("new", input("retry")).status).toBe("created");
    } finally { rmSync(x.dir, { recursive: true, force: true }); }
  });
  it("C08 restart preserves new user and session", () => { const x = disk(); try { x.repo.createUserWithInitialSession("a", input()); const restarted = new FileBackedAuthRepository(x.path); expect(restarted.findSession("s1", now)).not.toBeNull(); expect(restarted.createUserWithInitialSession("a", input("s2")).status).toBe("account_exists"); } finally { rmSync(x.dir, { recursive: true, force: true }); } });
  it("C09 failure then restart preserves old state", () => { const x = disk(); try { x.repo.createUserWithInitialSession("a", input()); vi.mocked(renameSync).mockImplementationOnce(() => { throw new Error("rename"); }); expect(() => x.repo.createUserWithInitialSession("b", input("b"))).toThrow(); const restarted = new FileBackedAuthRepository(x.path); expect(restarted.findSession("b", now)).toBeNull(); expect(restarted.findSession("s1", now)).not.toBeNull(); } finally { rmSync(x.dir, { recursive: true, force: true }); } });
  it("C10 account_exists performs no write or session creation", () => { const x = disk(); try { x.repo.createUserWithInitialSession("a", input()); vi.clearAllMocks(); expect(x.repo.createUserWithInitialSession("a", input("new")).status).toBe("account_exists"); expect(renameSync).not.toHaveBeenCalled(); expect(x.repo.findSession("new", now)).toBeNull(); } finally { rmSync(x.dir, { recursive: true, force: true }); } });
  it("C11 preserves other user's session", () => { const r = new InMemoryAuthRepository(); r.createUserWithInitialSession("a", input()); const before = r.findSession("s1", now); r.createUserWithInitialSession("b", input("b")); expect(r.findSession("s1", now)).toEqual(before); });
  it("C12 duplicate subject file fails closed without changing file", () => { const x = disk(); try { const raw = JSON.stringify({ users: [{ id: "1", appleSubject: "a", createdAt: now }, { id: "2", appleSubject: "a", createdAt: now }], sessions: [], challenges: [] }); writeFileSync(x.path, raw); expect(() => new FileBackedAuthRepository(x.path)).toThrow(AuthDataIntegrityError); expect(readFileSync(x.path, "utf8")).toBe(raw); } finally { rmSync(x.dir, { recursive: true, force: true }); } });
  it("C13 rename failure cleans temporary file", () => { const x = disk(); try { x.repo.createUserWithInitialSession("a", input()); vi.mocked(renameSync).mockImplementationOnce(() => { throw new Error("rename"); }); expect(() => x.repo.createUserWithInitialSession("b", input("b"))).toThrow(); expect(readdirSync(x.dir)).toEqual(["auth.json"]); } finally { rmSync(x.dir, { recursive: true, force: true }); } });
  it("C14 create and other mutations do not lose data", async () => { const x = disk(); try { const a = x.repo.createUserWithInitialSession("a", input()); if (a.status !== "created") throw new Error("expected created"); await Promise.all([Promise.resolve().then(() => x.repo.createUserWithInitialSession("b", input("b"))), Promise.resolve().then(() => x.repo.revokeSession("s1", now)), Promise.resolve().then(() => x.repo.deleteUserAndSessions(a.user.id))]); const restarted = new FileBackedAuthRepository(x.path); expect(restarted.findSession("s1", now)).toBeNull(); expect(restarted.findSession("b", now)).not.toBeNull(); } finally { rmSync(x.dir, { recursive: true, force: true }); } });
});
