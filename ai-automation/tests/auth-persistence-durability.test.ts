import { closeSync, fsyncSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthPersistenceIndeterminateError, AuthPersistenceNotCommittedError, FileBackedAuthRepository } from "../src/api/auth/repository.js";
import { AuthService } from "../src/api/auth/service.js";

vi.mock("node:fs", async original => {
  const fs = await original<typeof import("node:fs")>();
  return { ...fs, openSync: vi.fn(fs.openSync), closeSync: vi.fn(fs.closeSync), fsyncSync: vi.fn(fs.fsyncSync),
    mkdirSync: vi.fn(fs.mkdirSync), writeFileSync: vi.fn(fs.writeFileSync), renameSync: vi.fn(fs.renameSync) };
});
const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
const roots: string[] = [];
const now = "2026-10-16T00:00:00.000Z";
const expiry = "2027-01-01T00:00:00.000Z";
function fixture(nested = false) {
  const root = mkdtempSync(join(tmpdir(), "rh07-durable-")); roots.push(root);
  const path = nested ? join(root, "new", "deep", "auth.json") : join(root, "auth.json");
  const repo = new FileBackedAuthRepository(path);
  return { root, path, repo };
}
function seed(repo: FileBackedAuthRepository) {
  const user = repo.getOrCreateUser("synthetic-subject", now);
  repo.createSession({ id: "session", userId: user.id, tokenHash: "synthetic-token-hash", createdAt: now, expiresAt: expiry });
  return user;
}
afterEach(() => {
  vi.mocked(openSync).mockReset().mockImplementation(actual.openSync);
  vi.mocked(closeSync).mockReset().mockImplementation(actual.closeSync);
  vi.mocked(fsyncSync).mockReset().mockImplementation(actual.fsyncSync);
  vi.mocked(mkdirSync).mockReset().mockImplementation(actual.mkdirSync);
  vi.mocked(writeFileSync).mockReset().mockImplementation(actual.writeFileSync);
  vi.mocked(renameSync).mockReset().mockImplementation(actual.renameSync);
  for (const root of roots.splice(0)) actual.rmSync(root, { recursive: true, force: true });
});

describe("RH-07 auth durable-persist ordering and fail-closed recovery", () => {
  it("syncs file, closes it, renames, then syncs parent before reporting success", () => {
    const { root, path, repo } = fixture(); const events: string[] = []; const kinds = new Map<number, string>();
    vi.mocked(openSync).mockImplementation((p, flags, mode) => { const fd = actual.openSync(p, flags, mode); kinds.set(fd, String(p) === root ? "dir" : "file"); events.push(`open_${kinds.get(fd)}`); return fd; });
    vi.mocked(writeFileSync).mockImplementation((p, data) => { events.push("write_file"); actual.writeFileSync(p, data); });
    vi.mocked(fsyncSync).mockImplementation(fd => { events.push(`sync_${kinds.get(fd)}`); actual.fsyncSync(fd); });
    vi.mocked(closeSync).mockImplementation(fd => { events.push(`close_${kinds.get(fd)}`); actual.closeSync(fd); });
    vi.mocked(renameSync).mockImplementation((a, b) => { events.push("rename"); actual.renameSync(a, b); });
    const user = repo.getOrCreateUser("synthetic", now);
    expect(events).toEqual(["open_file", "write_file", "sync_file", "close_file", "rename", "open_dir", "sync_dir", "close_dir"]);
    expect(new FileBackedAuthRepository(path).findUserById(user.id)?.appleSubject).toBe("synthetic");
    const [p, flags, mode] = vi.mocked(openSync).mock.calls[0]!;
    expect(String(p)).toMatch(/auth\.json\..+\.tmp$/); expect(flags).toBe("wx"); expect(mode).toBe(0o600);
  });
  it.each(["write", "file_fsync", "file_close", "rename"] as const)("%s failure is NotCommitted and preserves RAM/disk/restart", stage => {
    const { root, path, repo } = fixture(); const user = seed(repo); const before = readFileSync(path);
    if (stage === "write") vi.mocked(writeFileSync).mockImplementationOnce(fd => { actual.writeFileSync(fd, "partial"); throw Error("synthetic write"); });
    if (stage === "file_fsync") vi.mocked(fsyncSync).mockImplementationOnce(() => { throw Error("synthetic file sync"); });
    if (stage === "file_close") vi.mocked(closeSync).mockImplementationOnce(fd => { actual.closeSync(fd); throw Error("synthetic close acknowledgement"); });
    if (stage === "rename") vi.mocked(renameSync).mockImplementationOnce(() => { throw Error("synthetic rename"); });
    expect(() => repo.deleteUserAndSessions(user.id)).toThrow(AuthPersistenceNotCommittedError);
    expect(repo.findSession("synthetic-token-hash", now)?.userId).toBe(user.id);
    expect(readFileSync(path)).toEqual(before); expect(readdirSync(root)).toEqual(["auth.json"]);
    expect(new FileBackedAuthRepository(path).findUserById(user.id)?.id).toBe(user.id);
  });
  it.each(["getOrCreateUser", "revokeSession"])("%s does not mutate RAM before confirmed persistence", operation => {
    const { path, repo } = fixture(); const user = seed(repo); const before = readFileSync(path);
    vi.mocked(fsyncSync).mockImplementationOnce(() => { throw Error("synthetic file sync"); });
    expect(() => operation === "getOrCreateUser" ? repo.getOrCreateUser("new-subject", now) : repo.revokeSession("synthetic-token-hash", now)).toThrow(AuthPersistenceNotCommittedError);
    expect(repo.findUserBySubject("new-subject")).toBeNull(); expect(repo.findSession("synthetic-token-hash", now)?.userId).toBe(user.id);
    expect(readFileSync(path)).toEqual(before);
  });
  it("directory fsync failure after rename is Indeterminate, not a retryable precommit failure", () => {
    const { path, repo } = fixture(); const user = seed(repo); const before = readFileSync(path);
    let calls = 0; vi.mocked(fsyncSync).mockImplementation(fd => { if (++calls === 2) throw Error("synthetic directory sync"); actual.fsyncSync(fd); });
    let error: unknown; try { repo.deleteUserAndSessions(user.id); } catch (e) { error = e; }
    expect(error).toBeInstanceOf(AuthPersistenceIndeterminateError); expect(error).not.toBeInstanceOf(AuthPersistenceNotCommittedError);
    expect(readFileSync(path)).not.toEqual(before); expect(JSON.parse(readFileSync(path, "utf8")).users).toEqual([]);
    expect(() => repo.findSession("synthetic-token-hash", now)).toThrow(AuthPersistenceIndeterminateError);
  });
  it.each(["open", "close"])("post-rename directory %s error also latches recovery", stage => {
    const { root, path, repo } = fixture(); const user = seed(repo);
    if (stage === "open") vi.mocked(openSync).mockImplementation((p, flags, mode) => {
      if (String(p) === root) throw Error("synthetic parent open"); return actual.openSync(p, flags, mode);
    });
    else vi.mocked(closeSync).mockImplementation(fd => {
      const directory = actual.fstatSync(fd).isDirectory(); actual.closeSync(fd);
      if (directory) throw Error("synthetic directory close acknowledgement");
    });
    expect(() => repo.deleteUserAndSessions(user.id)).toThrow(AuthPersistenceIndeterminateError);
    expect(() => repo.findUserById(user.id)).toThrow(AuthPersistenceIndeterminateError);
    expect(JSON.parse(readFileSync(path, "utf8")).users).toEqual([]);
  });
  it("all public auth-data paths fail closed after latch; cleanup-only release remains safe", () => {
    const { repo } = fixture(); const user = seed(repo); const guard = repo.beginLoginGuard(); const checkpoint = repo.deletionCheckpoint();
    let calls = 0; vi.mocked(fsyncSync).mockImplementation(fd => { if (++calls === 2) throw Error("synthetic directory sync"); actual.fsyncSync(fd); });
    expect(() => repo.deleteUserAndSessions(user.id)).toThrow(AuthPersistenceIndeterminateError);
    const operations = [
      () => repo.beginLoginGuard(), () => repo.validateLoginGuard(guard, "synthetic-subject"), () => repo.deletionCheckpoint(),
      () => repo.validateDeletionCheckpoint(checkpoint, "synthetic-subject"), () => repo.findUserBySubject("synthetic-subject"),
      () => repo.findUserById(user.id), () => repo.findSession("synthetic-token-hash", now), () => repo.getOrCreateUser("new", now),
      () => repo.createUserWithInitialSession("new", { id: "x", tokenHash: "hash", createdAt: now, expiresAt: expiry }),
      () => repo.deleteUserAndSessions(user.id), () => repo.pruneDeletionReceipts(now), () => repo.findDeletionReceipt("receipt", now),
      () => repo.updateRevocationStatus("receipt", "succeeded", now), () => repo.createChallenge("c", "n", expiry),
      () => repo.consumeChallenge("c", "n", now), () => repo.createSession({ id: "x", userId: user.id, tokenHash: "x", createdAt: now, expiresAt: expiry }),
      () => repo.revokeSession("synthetic-token-hash", now),
    ];
    const writes = vi.mocked(writeFileSync).mock.calls.length;
    for (const operation of operations) expect(operation).toThrow(AuthPersistenceIndeterminateError);
    expect(vi.mocked(writeFileSync).mock.calls).toHaveLength(writes);
    expect(() => repo.releaseLoginGuard(guard)).not.toThrow(); // no read, mutation, or grant of auth data
  });
  it("new nested directories and first existing ancestor are synced bottom-up before file write", () => {
    const { root, path, repo } = fixture(true); const directories: string[] = []; const descriptors = new Map<number, string>(); const events: string[] = [];
    vi.mocked(openSync).mockImplementation((p, flags, mode) => { const fd = actual.openSync(p, flags, mode); descriptors.set(fd, String(p)); return fd; });
    vi.mocked(fsyncSync).mockImplementation(fd => { const p = descriptors.get(fd)!; events.push(p); if (actual.fstatSync(fd).isDirectory()) directories.push(p); actual.fsyncSync(fd); });
    vi.mocked(writeFileSync).mockImplementation((p, data) => { events.push("write"); actual.writeFileSync(p, data); });
    repo.getOrCreateUser("nested", now);
    expect(directories).toEqual([dirname(path), join(root, "new"), root, dirname(path)]);
    expect(events.indexOf("write")).toBe(3);
  });
  it.each(["mkdir", "new_directory_fsync"])("%s failure never creates a target snapshot", stage => {
    const { path, repo } = fixture(true);
    if (stage === "mkdir") vi.mocked(mkdirSync).mockImplementationOnce(() => { throw Error("synthetic mkdir"); });
    else vi.mocked(fsyncSync).mockImplementationOnce(() => { throw Error("synthetic new-directory sync"); });
    expect(() => repo.getOrCreateUser("not-created", now)).toThrow(AuthPersistenceNotCommittedError);
    expect(actual.existsSync(path)).toBe(false); expect(repo.findUserBySubject("not-created")).toBeNull();
  });
  it("unreliable recursive mkdir boundary is rejected instead of assuming durable creation", () => {
    const { path, repo } = fixture(true);
    vi.mocked(mkdirSync).mockImplementationOnce((p, options) => { actual.mkdirSync(p, options); return join(tmpdir(), "unrelated-directory-boundary"); });
    expect(() => repo.getOrCreateUser("not-created", now)).toThrow(AuthPersistenceNotCommittedError);
    expect(actual.existsSync(path)).toBe(false); expect(repo.findUserBySubject("not-created")).toBeNull();
  });
  it("does not unlink a temporary file it failed to own", () => {
    const { root, repo } = fixture(); let collision = "";
    vi.mocked(openSync).mockImplementationOnce(p => {
      collision = String(p); actual.writeFileSync(collision, "other-owner-synthetic");
      throw Object.assign(Error("synthetic collision"), { code: "EEXIST" });
    });
    expect(() => repo.getOrCreateUser("not-created", now)).toThrow(AuthPersistenceNotCommittedError);
    expect(readFileSync(collision, "utf8")).toBe("other-owner-synthetic"); expect(readdirSync(root)).toHaveLength(1);
  });
  it("normal account creation, session revocation and deletion retain their semantics across restart", () => {
    const { path, repo } = fixture(); const result = repo.createUserWithInitialSession("synthetic", { id: "s", tokenHash: "h", createdAt: now, expiresAt: expiry });
    expect(result.status).toBe("created"); if (result.status !== "created") throw Error("fixture");
    expect(repo.revokeSession("h", now)).toBe(true); expect(new FileBackedAuthRepository(path).findSession("h", now)).toBeNull();
    expect(repo.deleteUserAndSessions(result.user.id)).toBe(true); expect(new FileBackedAuthRepository(path).findUserById(result.user.id)).toBeNull();
  });
  it("scheduled operations on one instance remain serialized", async () => {
    const { path, repo } = fixture(); const user = seed(repo);
    await Promise.all([Promise.resolve().then(() => repo.revokeSession("synthetic-token-hash", now)),
      Promise.resolve().then(() => repo.getOrCreateUser("other", now)), Promise.resolve().then(() => repo.deleteUserAndSessions(user.id))]);
    const next = new FileBackedAuthRepository(path); expect(next.findUserById(user.id)).toBeNull();
    expect(next.findUserBySubject("other")).not.toBeNull();
  });
  it.each(["before", "after"])("real process exit %s rename leaves one complete target snapshot", phase => {
    const { path, repo } = fixture(); const user = seed(repo); const before = readFileSync(path);
    const moduleUrl = new URL("../src/api/auth/repository.ts", import.meta.url).href;
    const script = `import fs from "node:fs";import {syncBuiltinESMExports} from "node:module";
      const original=fs.renameSync;fs.renameSync=(...args)=>{if(process.argv[2]==="before")process.exit(73);original(...args);process.exit(74);};
      syncBuiltinESMExports();const {FileBackedAuthRepository}=await import(${JSON.stringify(moduleUrl)});
      new FileBackedAuthRepository(process.argv[1]).getOrCreateUser("child-synthetic",${JSON.stringify(now)});`;
    const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script, path, phase], { encoding: "utf8", timeout: 10_000 });
    expect(result.error).toBeUndefined(); expect(result.status).toBe(phase === "before" ? 73 : 74);
    const next = new FileBackedAuthRepository(path); expect(next.findUserById(user.id)).not.toBeNull();
    if (phase === "before") { expect(readFileSync(path)).toEqual(before); expect(next.findUserBySubject("child-synthetic")).toBeNull(); }
    else expect(next.findUserBySubject("child-synthetic")).not.toBeNull();
    // This is a process-exit/rename boundary test, not physical power-loss testing.
  });
  it("AuthService deletion reports recovery_required after directory sync uncertainty, not success", async () => {
    const { path, repo } = fixture(); const user = repo.getOrCreateUser("synthetic-subject", now);
    const token = "synthetic-bearer-token"; const tokenHash = createHash("sha256").update(token).digest("hex");
    repo.createSession({ id: "s", userId: user.id, tokenHash, createdAt: now, expiresAt: expiry });
    const service = new AuthService(repo, { verify: async () => {
      let calls = 0; vi.mocked(fsyncSync).mockImplementation(fd => { if (++calls === 2) throw Error("synthetic post-rename"); actual.fsyncSync(fd); });
      return { subject: "synthetic-subject", issuer: "https://appleid.apple.com", audience: "com.aishortcut.AutomationApp", issuedAt: 1, expiresAt: 9_999_999_999 };
    } }, () => Date.parse(now));
    const challenge = service.deletionChallenge(token, "request")!;
    const result = await service.deleteAccount(token, "request", { identityToken: "synthetic-proof", challengeId: challenge.challengeId, nonce: challenge.nonce });
    expect(result).toEqual({ status: "recovery_required" });
    expect(() => service.challenge()).toThrow("recovery required");
    expect(JSON.parse(readFileSync(path, "utf8")).users).toEqual([]);
  });
});
