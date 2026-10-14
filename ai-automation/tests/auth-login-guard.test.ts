import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AuthService } from "../src/api/auth/service.js";
import { FileBackedAuthRepository, InMemoryAuthRepository } from "../src/api/auth/repository.js";
import { LoginGuards } from "../src/api/auth/login-guards.js";
import type { VerifiedAppleIdentity } from "../src/api/auth/types.js";

vi.mock("node:fs", async (original) => {
  const actual = await original<typeof import("node:fs")>();
  return { ...actual, renameSync: vi.fn(actual.renameSync) };
});
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
const identity = (subject = "a"): VerifiedAppleIdentity => ({ subject, issuer: "https://appleid.apple.com", audience: "com.aishortcut.AutomationApp", issuedAt: 1, expiresAt: 9_999_999_999 });
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: Error) => void;
  const promise = new Promise<T>((r, j) => { resolve = r; reject = j; });
  return { promise, resolve, reject };
}
function setup() {
  const repo = new InMemoryAuthRepository();
  const user = repo.getOrCreateUser("a", new Date().toISOString());
  const gate = deferred<VerifiedAppleIdentity | null>();
  const auth = new AuthService(repo, { verify: () => gate.promise });
  const login = () => { const c = auth.challenge(); return auth.signIn("synthetic", c.challengeId, c.nonce); };
  return { repo, user, gate, auth, login };
}
describe("RH04 T02B login guards", () => {
  it("B01 rejects pending login after same-subject deletion", async () => {
    const x = setup(); const pending = x.login(); x.repo.deleteUserAndSessions(x.user.id); x.gate.resolve(identity());
    expect(await pending).toBeNull();
  });
  it("B02 permits pending login after unrelated deletion", async () => {
    const x = setup(); const other = x.repo.getOrCreateUser("b", new Date().toISOString()); const pending = x.login();
    x.repo.deleteUserAndSessions(other.id); x.gate.resolve(identity()); expect(await pending).not.toBeNull();
  });
  it("B03 failed persist does not advance generation", () => {
    class Repo extends InMemoryAuthRepository { fail = false; protected override persist() { if (this.fail) throw new Error("test"); } }
    const r = new Repo(); const u = r.getOrCreateUser("a", "now"); const g = r.beginLoginGuard(); r.fail = true;
    expect(() => r.deleteUserAndSessions(u.id)).toThrow(); expect(() => r.validateLoginGuard(g, "a")).not.toThrow(); r.releaseLoginGuard(g);
  });
  it("B04 delayed verification never recreates deleted user", async () => {
    const x = setup(); const create = vi.spyOn(x.repo, "getOrCreateUser"); const pending = x.login();
    x.repo.deleteUserAndSessions(x.user.id); x.gate.resolve(identity()); await pending; expect(create).not.toHaveBeenCalled();
  });
  it("B05 rejects both pending logins", async () => {
    const x = setup(); const a = x.login(); const b = x.login(); x.repo.deleteUserAndSessions(x.user.id); x.gate.resolve(identity());
    expect(await Promise.all([a, b])).toEqual([null, null]);
  });
  it("B06 rejects a guard with evicted history", () => {
    const r = new LoginGuards(); const g = r.begin(); for (let n = 0; n < 1025; n++) r.deleted(r.digest(String(n)));
    expect(() => r.validate(g, "other")).toThrow(); r.release(g);
  });
  it("B07 normal login succeeds", async () => { const x = setup(); const p = x.login(); x.gate.resolve(identity()); expect(await p).not.toBeNull(); });
  it("B08 old session becomes invalid after deletion", async () => {
    const x = setup(); const p = x.login(); x.gate.resolve(identity()); const result = (await p)!;
    x.repo.deleteUserAndSessions(result.userId); expect(x.auth.session(result.sessionToken)).toBeNull();
  });
  it("B09 verifier timeout rejects login and releases capacity", async () => {
    vi.useFakeTimers(); const x = setup(); const p = x.login(); await vi.advanceTimersByTimeAsync(20_000);
    expect(await p).toBeNull(); const guards = Array.from({ length: 64 }, () => x.repo.beginLoginGuard()); guards.forEach(g => x.repo.releaseLoginGuard(g));
  });
  it("B10 late verifier resolution cannot mutate state", async () => {
    vi.useFakeTimers(); const x = setup(); const spy = vi.spyOn(x.repo, "createSession"); const p = x.login();
    await vi.advanceTimersByTimeAsync(20_000); expect(await p).toBeNull(); x.gate.resolve(identity()); await Promise.resolve(); expect(spy).not.toHaveBeenCalled();
  });
  it("B11 late rejection is handled by the timeout race", async () => {
    vi.useFakeTimers(); const x = setup(); const p = x.login(); await vi.advanceTimersByTimeAsync(20_000); expect(await p).toBeNull();
    x.gate.reject(new Error("late verifier failure")); await vi.advanceTimersByTimeAsync(0);
  });
  it("B12 rejects login when guard capacity is full without consuming challenge", async () => {
    const x = setup(); const guards = Array.from({ length: 64 }, () => x.repo.beginLoginGuard()); const consume = vi.spyOn(x.repo, "consumeChallenge");
    expect(await x.login()).toBeNull(); expect(consume).not.toHaveBeenCalled(); guards.forEach(g => x.repo.releaseLoginGuard(g));
  });
  it("B13 rejects at exact guard expiry", () => {
    let time = 0; const r = new LoginGuards(() => time); const g = r.begin(); time = 20_000;
    expect(() => r.validate(g, "a")).toThrow(); r.release(g);
  });
  it("B14 missing deletion produces no event", () => {
    const r = new InMemoryAuthRepository(); const g = r.beginLoginGuard(); expect(r.deleteUserAndSessions("missing")).toBe(false);
    expect(() => r.validateLoginGuard(g, "a")).not.toThrow(); r.releaseLoginGuard(g);
  });
  it("B15 rename failure produces no deletion event", () => {
    const dir = mkdtempSync(join(tmpdir(), "rh04-guard-"));
    try {
      const r = new FileBackedAuthRepository(join(dir, "auth.json")); const u = r.getOrCreateUser("a", "now"); const g = r.beginLoginGuard();
      vi.mocked(renameSync).mockImplementationOnce(() => { throw new Error("rename"); });
      expect(() => r.deleteUserAndSessions(u.id)).toThrow(); expect(() => r.validateLoginGuard(g, "a")).not.toThrow(); r.releaseLoginGuard(g);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("B16 equality at eviction floor remains valid but earlier generation fails", () => {
    const r = new LoginGuards(); const old = r.begin(); r.deleted(r.digest("a")); const equal = r.begin();
    for (let n = 0; n < 1024; n++) r.deleted(r.digest("other"));
    expect(() => r.validate(old, "a")).toThrow(); expect(() => r.validate(equal, "a")).not.toThrow(); r.release(old); r.release(equal);
  });
  it("B17 success and failure release every guard", async () => {
    const r = new InMemoryAuthRepository(); let valid = true;
    const auth = new AuthService(r, { verify: async () => valid ? identity() : null });
    for (let n = 0; n < 70; n++) { valid = n % 2 === 0; const c = auth.challenge(); const result = await auth.signIn("test", c.challengeId, c.nonce); expect(result !== null).toBe(valid); }
    const guards = Array.from({ length: 64 }, () => r.beginLoginGuard()); guards.forEach(g => r.releaseLoginGuard(g));
  });
  it("B18 uses only verified subject, not token text", async () => {
    const x = setup(); const p = x.login(); x.repo.deleteUserAndSessions(x.user.id); x.gate.resolve(identity("verified-b"));
    const result = await p; expect(result).not.toBeNull(); expect(result?.userId).not.toBe(x.user.id);
  });
});
