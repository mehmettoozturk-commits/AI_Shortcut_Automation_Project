import { mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileBackedAuthRepository, InMemoryAuthRepository } from "../src/api/auth/repository.js";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, writeFileSync: vi.fn(actual.writeFileSync), renameSync: vi.fn(actual.renameSync) };
});
afterEach(() => vi.clearAllMocks());

const now = "2026-10-14T00:00:00.000Z";
function seed(repo: InMemoryAuthRepository) {
  const user = repo.getOrCreateUser("synthetic-a", now);
  const other = repo.getOrCreateUser("synthetic-b", now);
  for (const [id, userId] of [["a1", user.id], ["a2", user.id], ["b1", other.id]]) {
    repo.createSession({ id: id!, userId: userId!, tokenHash: id!, createdAt: now, expiresAt: "2027-01-01T00:00:00.000Z" });
  }
  return { user, other };
}
describe("RH04 repository deletion", () => {
  it.each(["write", "rename"])("preserves memory, disk and restart on %s failure and removes temp data", async (stage) => {
    const dir = mkdtempSync(join(tmpdir(), "rh04-fault-")); const path = join(dir, "auth.json");
    const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
    try {
      const repo = new FileBackedAuthRepository(path); const { user } = seed(repo);
      const before = readFileSync(path, "utf8");
      if (stage === "write") {
        vi.mocked(writeFileSync).mockImplementationOnce((file) => {
          actual.writeFileSync(file, "partial synthetic data");
          throw new Error("synthetic write failure");
        });
      } else vi.mocked(renameSync).mockImplementationOnce(() => { throw new Error("synthetic rename failure"); });
      expect(() => repo.deleteUserAndSessions(user.id)).toThrow();
      expect(repo.findSession("a1", now)?.userId).toBe(user.id);
      expect(readFileSync(path, "utf8")).toBe(before);
      expect(new FileBackedAuthRepository(path).findSession("a1", now)?.userId).toBe(user.id);
      expect(readdirSync(dir)).toEqual(["auth.json"]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("serializes scheduled delete, create, revoke and repeat delete on one instance", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rh04-scheduled-")); const path = join(dir, "auth.json");
    try {
      const repo = new FileBackedAuthRepository(path); const { user, other } = seed(repo);
      const results = await Promise.all([
        Promise.resolve().then(() => repo.deleteUserAndSessions(user.id)),
        Promise.resolve().then(() => repo.createSession({ id: "b2", userId: other.id, tokenHash: "b2", createdAt: now, expiresAt: "2027-01-01T00:00:00.000Z" })),
        Promise.resolve().then(() => repo.revokeSession("b1", now)),
        Promise.resolve().then(() => repo.getOrCreateUser("synthetic-c", now)),
        Promise.resolve().then(() => repo.deleteUserAndSessions(user.id)),
      ]);
      expect(results[0]).toBe(true); expect(results[2]).toBe(true); expect(results[4]).toBe(false);
      const restarted = new FileBackedAuthRepository(path);
      expect(restarted.findSession("a1", now)).toBeNull();
      expect(restarted.findSession("b1", now)).toBeNull();
      expect(restarted.findSession("b2", now)?.userId).toBe(other.id);
      expect(JSON.parse(readFileSync(path, "utf8")).users).toHaveLength(2);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("removes all user sessions and preserves the other user", () => {
    const repo = new InMemoryAuthRepository(); const { user, other } = seed(repo);
    expect(repo.deleteUserAndSessions(user.id)).toBe(true);
    expect(repo.findSession("a1", now)).toBeNull(); expect(repo.findSession("a2", now)).toBeNull();
    expect(repo.findSession("b1", now)?.userId).toBe(other.id);
    expect(repo.getOrCreateUser("synthetic-b", now).id).toBe(other.id);
  });
  it("returns false for missing or already deleted users", () => {
    const repo = new InMemoryAuthRepository(); const { user } = seed(repo);
    expect(repo.deleteUserAndSessions("missing")).toBe(false);
    repo.deleteUserAndSessions(user.id);
    expect(repo.deleteUserAndSessions(user.id)).toBe(false);
  });
  it("preserves memory on persistence failure", () => {
    class Failing extends InMemoryAuthRepository {
      fail = false;
      protected override persist() { if (this.fail) throw new Error("synthetic write failure"); }
    }
    const repo = new Failing(); const { user } = seed(repo); repo.fail = true;
    expect(() => repo.deleteUserAndSessions(user.id)).toThrow();
    expect(repo.findSession("a1", now)?.userId).toBe(user.id);
    expect(repo.getOrCreateUser("synthetic-a", now).id).toBe(user.id);
  });
  it("persists deletion across restart", () => {
    const dir = mkdtempSync(join(tmpdir(), "rh04-delete-")); const path = join(dir, "auth.json");
    try {
      const repo = new FileBackedAuthRepository(path); const { user, other } = seed(repo);
      repo.deleteUserAndSessions(user.id);
      const restarted = new FileBackedAuthRepository(path);
      expect(restarted.findSession("a1", now)).toBeNull();
      expect(restarted.findSession("b1", now)?.userId).toBe(other.id);
      expect(readFileSync(path, "utf8")).not.toContain("synthetic-a");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
